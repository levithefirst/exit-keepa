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
 * The one place that observes the live chain, decides whether to act, and
 * records what happened - used by both the on-demand API route
 * (routes/agent.ts) and the autonomous poller (agent/poller.ts), so there
 * is exactly one decision path regardless of what triggered this tick.
 *
 * Never sends a strategy's target/selector/calldata anywhere it wasn't
 * already deterministically rebuilt by execution/buildTransaction.ts - the
 * caller here never supplies any of that, same as every other execution
 * path in this codebase.
 */
export async function evaluateStrategy(strategyId: string, source: DecisionSource): Promise<GuardianReceipt> {
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

  const observation = await readAaveUsdcRate(condition.metric as "supply_apr" | "borrow_apr");
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
    logger.info(
      { strategyId: strategy.id, executionId, status: execution.status },
      "Exit Guardian approved and auto-simulated execution",
    );
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
