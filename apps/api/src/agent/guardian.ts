import crypto, { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ExitAction, RateCondition } from "@exit-keepa/shared";
import { db } from "../db";
import { agentDecisions, auditEvents, exitStrategies, keeperhubExecutions, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { buildExitTransaction, type BuiltTransaction } from "../execution/buildTransaction";
import { evaluateRateCondition } from "../execution/evaluateCondition";
import { simulatePendingExecution } from "../execution/simulate";
import { executeApprovedExecution } from "../execution/executeApproved";
import { readAaveUsdcRate, type AaveRateSnapshot } from "./aaveRateOracle";
import { nextAgentDecision, type AgentState, type AgentDecisionKind } from "./decisionStateMachine";
import { checkPolicy } from "./policy";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type DecisionSource = "poller" | "manual";

export interface GuardianReceipt {
  decisionId: string;
  strategyId: string;
  executionId: string | null;
  source: DecisionSource;
  agentStateBefore: AgentState;
  agentStateAfter: AgentState;
  decision: AgentDecisionKind;
  observation: AaveRateSnapshot;
  condition: RateCondition;
  conditionMet: boolean;
  policy: Record<string, boolean> | null;
  policyPassed: boolean | null;
  refusalReasons: string[];
  intentHash: string;
  receiptHash: string;
  execution: typeof keeperhubExecutions.$inferSelect | null;
  createdAt: string;
}

interface RecordDecisionInput {
  strategyId: string;
  source: DecisionSource;
  agentStateBefore: AgentState;
  agentStateAfter: AgentState;
  decision: AgentDecisionKind;
  observation: AaveRateSnapshot;
  condition: RateCondition;
  conditionMet: boolean;
  policy: Record<string, boolean> | null;
  policyPassed: boolean | null;
  refusalReasons: string[];
  intentHash: string;
  executionId: string | null;
  execution: typeof keeperhubExecutions.$inferSelect | null;
}

async function recordDecision(input: RecordDecisionInput): Promise<GuardianReceipt> {
  const receiptHash = hash({
    strategyId: input.strategyId,
    decision: input.decision,
    observation: input.observation,
    conditionMet: input.conditionMet,
    policy: input.policy,
    intentHash: input.intentHash,
    executionId: input.executionId,
  });

  const [row] = await db
    .insert(agentDecisions)
    .values({
      strategyId: input.strategyId,
      executionId: input.executionId,
      source: input.source,
      agentStateBefore: input.agentStateBefore,
      agentStateAfter: input.agentStateAfter,
      decision: input.decision,
      observation: input.observation,
      conditionMet: input.conditionMet,
      policy: input.policy,
      policyPassed: input.policyPassed,
      refusalReasons: input.refusalReasons,
      intentHash: input.intentHash,
      receiptHash,
    })
    .returning();

  return {
    decisionId: row.id,
    strategyId: input.strategyId,
    executionId: input.executionId,
    source: input.source,
    agentStateBefore: input.agentStateBefore,
    agentStateAfter: input.agentStateAfter,
    decision: input.decision,
    observation: input.observation,
    condition: input.condition,
    conditionMet: input.conditionMet,
    policy: input.policy,
    policyPassed: input.policyPassed,
    refusalReasons: input.refusalReasons,
    intentHash: input.intentHash,
    receiptHash,
    execution: input.execution,
    createdAt: row.createdAt.toISOString(),
  };
}

const NO_INTENT_HASH = hash({ noAttempt: true });

/**
 * The one place that observes the live chain, decides whether to act, acts,
 * and records what happened - used by both the on-demand API route
 * (routes/agent.ts) and the autonomous poller (agent/poller.ts), so there
 * is exactly one decision path regardless of what triggered this tick.
 *
 * "Acts" means the whole way to the chain, unattended. On a genuine edge
 * crossing this claims the trigger atomically (so exactly one attempt
 * happens per crossing, however many pollers are running), builds the
 * transaction deterministically, runs the policy check, simulates, and -
 * if and only if the simulation comes back clean - hands the execution to
 * execution/executeApproved.ts, which broadcasts it, verifies the outcome
 * against KeeperHub's own status endpoint, and persists the final result.
 * The returned receipt therefore describes a finished lifecycle, not a
 * transaction still waiting for someone to press a button.
 *
 * Nothing is broadcast when the policy check refuses, or when the
 * simulation says the transaction would not succeed - both are terminal,
 * recorded, and reported as such.
 *
 * Never sends a strategy's target/selector/calldata anywhere it wasn't
 * already deterministically rebuilt by execution/buildTransaction.ts - the
 * caller here never supplies any of that, same as every other execution
 * path in this codebase.
 */
export async function evaluateStrategy(
  strategyId: string,
  source: DecisionSource,
  /**
   * A rate snapshot already read for this tick. The rate is a market-wide
   * value - every strategy watching aave-v3-base supply_apr observes the
   * identical number - so the poller reads it once per tick and passes it
   * to each strategy rather than making one RPC call per strategy. Left
   * undefined by the on-demand route, which reads fresh.
   *
   * It is only ever accepted for the metric this strategy actually
   * watches (checked below); a mismatched snapshot is ignored and a fresh
   * read is done, so a caller can never make a strategy evaluate against
   * the wrong market's number.
   */
  preReadObservation?: AaveRateSnapshot,
): Promise<GuardianReceipt> {
  const [strategy] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, strategyId)).limit(1);
  if (!strategy) throw new HttpError(404, `Exit strategy ${strategyId} not found`);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, strategy.safeId)).limit(1);
  if (!safe) throw new HttpError(404, `Safe account ${strategy.safeId} not found`);

  if (strategy.status !== "active") {
    throw new HttpError(409, `Strategy is ${strategy.status}, not active - Exit Guardian only monitors active strategies`);
  }

  const condition = strategy.condition as RateCondition;
  if (condition.market !== "aave-v3-base" || !["supply_apr", "borrow_apr"].includes(condition.metric)) {
    throw new HttpError(422, "Exit Guardian currently monitors Aave v3 Base supply_apr and borrow_apr only");
  }

  // The instant this tick's authority to act was established. Passed to
  // executeApprovedExecution as `approvedAt` so the stale-intent guard
  // measures the real age of this decision at the moment of broadcast.
  const observedAt = new Date();
  const metric = condition.metric as "supply_apr" | "borrow_apr";
  const observation =
    preReadObservation && preReadObservation.metric === metric
      ? preReadObservation
      : await readAaveUsdcRate(metric);
  const conditionMet = evaluateRateCondition(condition, observation.rateBps);
  const agentStateBefore = strategy.agentState as AgentState;
  const transition = nextAgentDecision(agentStateBefore, conditionMet);

  if (!transition.shouldAttempt) {
    if (transition.nextState !== agentStateBefore) {
      await db
        .update(exitStrategies)
        .set({ agentState: transition.nextState, agentStateUpdatedAt: new Date() })
        .where(and(eq(exitStrategies.id, strategy.id), eq(exitStrategies.agentState, agentStateBefore)))
        .returning();
    }
    return recordDecision({
      strategyId: strategy.id,
      source,
      agentStateBefore,
      agentStateAfter: transition.nextState,
      decision: transition.decision,
      observation,
      condition,
      conditionMet,
      policy: null,
      policyPassed: null,
      refusalReasons: [],
      intentHash: NO_INTENT_HASH,
      executionId: null,
      execution: null,
    });
  }

  // Edge-triggered: claim the normal -> held transition atomically. Two
  // concurrent ticks (an on-demand call landing mid-poll, or two poller
  // runs overlapping) can never both win this UPDATE, so only one of them
  // proceeds to make an attempt - the other falls through to "someone else
  // already claimed this crossing" below.
  const [claimed] = await db
    .update(exitStrategies)
    .set({ agentState: "held", agentStateUpdatedAt: new Date() })
    .where(and(eq(exitStrategies.id, strategy.id), eq(exitStrategies.agentState, "normal")))
    .returning();

  if (!claimed) {
    return recordDecision({
      strategyId: strategy.id,
      source,
      agentStateBefore,
      agentStateAfter: "held",
      decision: "held",
      observation,
      condition,
      conditionMet,
      policy: null,
      policyPassed: null,
      refusalReasons: [],
      intentHash: NO_INTENT_HASH,
      executionId: null,
      execution: null,
    });
  }

  // --- exactly one attempt happens below ---

  let tx: BuiltTransaction | null = null;
  let txBuildError: string | null = null;
  try {
    tx = buildExitTransaction(strategy.action as ExitAction, safe);
  } catch (err) {
    // Missing/invalid Roles config throws here (see buildTransaction.ts).
    // That's a real refusal reason ("missing permission"), not a route
    // failure - caught so it still gets a proper receipt instead of
    // aborting the whole evaluation with no record of what happened.
    txBuildError = (err as Error).message;
  }

  const { policy, policyPassed, refusalReasons } = checkPolicy(tx, safe, txBuildError);

  const intent = {
    strategyId: strategy.id,
    safeId: safe.id,
    safeAddress: safe.safeAddress,
    chainId: safe.chainId,
    condition,
    action: strategy.action,
    target: tx?.to ?? null,
    calldata: tx?.data ?? null,
  };
  const intentHash = hash(intent);
  const executionId = crypto.randomUUID();
  let execution: typeof keeperhubExecutions.$inferSelect;

  if (!policyPassed || !tx) {
    [execution] = await db
      .insert(keeperhubExecutions)
      .values({
        id: executionId,
        exitStrategyId: strategy.id,
        idempotencyKey: executionId,
        createdVia: "guardian",
        status: "refused",
        requestPayload: { observation, policy, intent, source },
        errorMessage: refusalReasons.join("; ") || "Refused by Exit Guardian policy check",
      })
      .returning();

    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: executionId,
      eventType: "agent.execution_refused",
      payload: { observation, policy, refusalReasons, source },
    });

    logger.warn({ strategyId: strategy.id, executionId, refusalReasons }, "Exit Guardian refused execution");
  } else {
    [execution] = await db
      .insert(keeperhubExecutions)
      .values({
        id: executionId,
        exitStrategyId: strategy.id,
        idempotencyKey: executionId,
        createdVia: "guardian",
        status: "pending",
        requestPayload: { tx, observation, source },
      })
      .returning();

    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: executionId,
      eventType: "agent.execution_approved",
      payload: { tx, observation, source },
    });

    const simOutcome = await simulatePendingExecution(executionId, tx, safe.chainId, safe.isSandbox);
    execution = simOutcome.row;

    if (execution.status !== "simulated") {
      // Simulation said this transaction would not succeed (or the
      // simulate call itself failed). That is a hard stop: nothing is
      // broadcast, the row is already terminal `failed`, and the receipt
      // below reports exactly that. Never fall through to execution on an
      // unclean simulation.
      logger.warn(
        { strategyId: strategy.id, executionId, status: execution.status, error: execution.errorMessage },
        "Exit Guardian stopped at simulation - nothing broadcast",
      );
    } else {
      // The whole point of the product: a clean simulation is immediately
      // executed, autonomously, without anyone clicking anything. This is
      // the same canonical service the manual/admin recovery route calls
      // (execution/executeApproved.ts) - the Guardian implements no part
      // of the broadcast lifecycle itself, so there is exactly one
      // definition of every guard on the way to the chain.
      //
      // `approvedAt: observedAt` is the instant this tick read live state.
      // The service re-reads the strategy at broadcast time and compares,
      // so a strategy edited in the window between that read and the
      // irreversible step is still caught by the stale-intent check.
      const executed = await executeApprovedExecution({
        executionId,
        strategyId: strategy.id,
        approvedAt: observedAt,
      });
      if (executed.row) execution = executed.row;

      const detail = { strategyId: strategy.id, executionId, outcome: executed.kind, status: execution.status };
      if (executed.kind === "succeeded" || executed.kind === "demo_completed") {
        logger.info(detail, "Exit Guardian executed the approved exit autonomously");
      } else {
        logger.warn(detail, "Exit Guardian executed the approved exit but the outcome was not a clean success");
      }
    }
  }

  return recordDecision({
    strategyId: strategy.id,
    source,
    agentStateBefore,
    agentStateAfter: "held",
    decision: "triggered",
    observation,
    condition,
    conditionMet,
    policy,
    policyPassed,
    refusalReasons,
    intentHash,
    executionId,
    execution,
  });
}
