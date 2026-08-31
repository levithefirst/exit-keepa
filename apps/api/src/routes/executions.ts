import { Router } from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveWithdrawAmount, type ExitAction, type RateCondition } from "@exit-keepa/shared";
import { db } from "../db";
import { agentDecisions, auditEvents, exitStrategies, keeperhubExecutions, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { env } from "../env";
import { buildExitTransaction } from "../execution/buildTransaction";
import { broadcastExitTransaction } from "../execution/executor";
import { simulatePendingExecution } from "../execution/simulate";
import { KeeperHubApiError } from "../keeperhub/client";
import { evaluateRateCondition } from "../execution/evaluateCondition";
import { decideBroadcast } from "../execution/stateMachine";
import { checkAmountExceeded, checkStaleIntent, readAaveUsdcPositionBalance } from "../agent/broadcastGuards";

export const executionsRouter = Router();

async function loadStrategyAndSafe(strategyId: string) {
  const [strategy] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, strategyId)).limit(1);
  if (!strategy) throw new HttpError(404, `Exit strategy ${strategyId} not found`);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, strategy.safeId)).limit(1);
  if (!safe) throw new HttpError(404, `Safe account ${strategy.safeId} not found`);

  return { strategy, safe };
}

executionsRouter.get("/exit-strategies/:id/executions", async (req, res) => {
  const rows = await db
    .select()
    .from(keeperhubExecutions)
    .where(eq(keeperhubExecutions.exitStrategyId, req.params.id));
  res.json(rows);
});

/**
 * Step 1: create an execution attempt. Requires the caller to assert the
 * condition is currently true (currentRateBps) - re-verified server-side
 * against the strategy's own stored condition, never trusted blindly, and
 * the strategy must be `active`. Stores the deterministically-rebuilt
 * transaction in requestPayload for audit before anything is sent to
 * KeeperHub.
 */
const createExecutionSchema = z.object({ currentRateBps: z.number().int() });

executionsRouter.post("/exit-strategies/:id/executions", async (req, res) => {
  const { currentRateBps } = createExecutionSchema.parse(req.body);
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id);

  if (strategy.status !== "active") {
    throw new HttpError(409, `Strategy is ${strategy.status}, not active - cannot execute`);
  }

  const conditionMet = evaluateRateCondition(strategy.condition as RateCondition, currentRateBps);
  if (!conditionMet) {
    throw new HttpError(422, "Trigger condition is not currently satisfied");
  }

  // Idempotency at the trigger-occurrence level, not just per-row: if an
  // attempt for this strategy is already in flight (not yet succeeded or
  // failed), return it instead of opening a second one. Without this, a
  // duplicate/double-clicked request could create two independently
  // simulatable-and-broadcastable executions for the same withdrawal.
  const existing = await db
    .select()
    .from(keeperhubExecutions)
    .where(eq(keeperhubExecutions.exitStrategyId, strategy.id));
  const inFlight = existing.find((e) =>
    (["pending", "simulating", "simulated", "executing"] as string[]).includes(e.status),
  );
  if (inFlight) {
    res.status(200).json(inFlight);
    return;
  }

  const tx = buildExitTransaction(strategy.action as ExitAction, safe);

  // The execution's own id doubles as its idempotency key - every later
  // operation on this row is a no-op-or-reject once it has already
  // succeeded, rather than a fresh attempt. Generated up front so it can
  // be set on the same insert as `id`.
  const executionId = crypto.randomUUID();

  const [row] = await db
    .insert(keeperhubExecutions)
    .values({
      id: executionId,
      exitStrategyId: strategy.id,
      idempotencyKey: executionId,
      status: "pending",
      requestPayload: { tx, currentRateBps },
    })
    .returning();

  await db.insert(auditEvents).values({
    entityType: "keeperhub_execution",
    entityId: row.id,
    eventType: "execution.created",
    payload: { tx, currentRateBps },
  });

  res.status(201).json(row);
});

executionsRouter.post("/exit-strategies/:id/executions/:executionId/simulate", async (req, res) => {
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id);
  const [execution] = await db
    .select()
    .from(keeperhubExecutions)
    .where(
      and(eq(keeperhubExecutions.id, req.params.executionId), eq(keeperhubExecutions.exitStrategyId, strategy.id)),
    )
    .limit(1);
  if (!execution) throw new HttpError(404, "Execution not found");

  if (execution.txHash) {
    // Already broadcast - simulating again is pointless and could confuse
    // the recorded state, so just return what already happened.
    res.status(200).json(execution);
    return;
  }

  const tx = buildExitTransaction(strategy.action as ExitAction, safe);
  const outcome = await simulatePendingExecution(execution.id, tx, safe.chainId);
  res.status(outcome.callFailed ? 502 : 200).json(outcome.row);
});

/**
 * Step 3: real broadcast (simulate: false). Idempotent by construction:
 * the conditional UPDATE below only transitions a row out of `simulated`
 * once, atomically - a retried/duplicate request against a row that's
 * already `executing`, `succeeded`, or `failed` is rejected or short-
 * circuited rather than causing a second broadcast.
 */
executionsRouter.post("/exit-strategies/:id/executions/:executionId/broadcast", async (req, res) => {
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id);
  const [execution] = await db
    .select()
    .from(keeperhubExecutions)
    .where(
      and(eq(keeperhubExecutions.id, req.params.executionId), eq(keeperhubExecutions.exitStrategyId, strategy.id)),
    )
    .limit(1);
  if (!execution) throw new HttpError(404, "Execution not found");

  const decision = decideBroadcast({ status: execution.status, txHash: execution.txHash });
  if (decision.action === "already_broadcast") {
    res.status(200).json(execution);
    return;
  }
  if (decision.action === "reject") {
    throw new HttpError(409, decision.reason);
  }

  // Stale-intent and amount-exceeded checks run against live state
  // (strategy.updatedAt, the Guardian decision's own age, the Safe's
  // current Aave position) right before the one irreversible step, not at
  // decision time - so an execution approved minutes ago against
  // conditions that have since changed is blocked here instead of
  // broadcasting on stale authority.
  // At most one decision ever links to a given executionId (it's set once,
  // at creation, and never reassigned - see agent/guardian.ts), so this
  // needs no ordering.
  const [linkedDecision] = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.executionId, execution.id))
    .limit(1);

  const staleness = checkStaleIntent({
    decisionCreatedAt: linkedDecision?.createdAt ?? null,
    strategyUpdatedAt: strategy.updatedAt,
    now: new Date(),
    maxAgeMs: env.AGENT_DECISION_MAX_AGE_MS,
  });

  const action = strategy.action as ExitAction;
  let amountGuard: { blocked: boolean; reason?: string } = { blocked: false };
  if (action.amount !== "max") {
    try {
      const [livePosition, configuredAmount] = await Promise.all([
        readAaveUsdcPositionBalance(safe.safeAddress),
        Promise.resolve(resolveWithdrawAmount(action.amount)),
      ]);
      amountGuard = checkAmountExceeded(configuredAmount, livePosition);
    } catch (err) {
      // Can't confirm the live position - fail closed rather than assume
      // the configured amount is still safe to withdraw.
      amountGuard = { blocked: true, reason: `Could not verify the live Aave position before broadcast: ${(err as Error).message}` };
    }
  }

  const guardResult = staleness.blocked ? staleness : amountGuard;
  if (guardResult.blocked) {
    const [blocked] = await db
      .update(keeperhubExecutions)
      .set({ status: "blocked", errorMessage: guardResult.reason, updatedAt: new Date() })
      .where(and(eq(keeperhubExecutions.id, execution.id), eq(keeperhubExecutions.status, "simulated")))
      .returning();

    if (blocked) {
      await db.insert(auditEvents).values({
        entityType: "keeperhub_execution",
        entityId: execution.id,
        eventType: "execution.broadcast_blocked",
        payload: { reason: guardResult.reason },
      });
      logger.warn({ executionId: execution.id, reason: guardResult.reason }, "Broadcast blocked before reaching KeeperHub");
      res.status(200).json(blocked);
      return;
    }
    // Lost the race to another request that already moved this row past
    // `simulated` - fall through to the normal broadcast path below, which
    // will itself see the execution is no longer `simulated` and reject.
  }

  // Conditional UPDATE makes the "proceed" decision race-safe: only the
  // request that actually flips status simulated -> executing gets to
  // broadcast, so two concurrent requests can never both submit.
  const [claimed] = await db
    .update(keeperhubExecutions)
    .set({ status: "executing", updatedAt: new Date() })
    .where(and(eq(keeperhubExecutions.id, execution.id), eq(keeperhubExecutions.status, "simulated")))
    .returning();

  if (!claimed) {
    const [current] = await db
      .select()
      .from(keeperhubExecutions)
      .where(eq(keeperhubExecutions.id, execution.id))
      .limit(1);
    throw new HttpError(
      409,
      `Execution is ${current?.status} - can only broadcast an execution that has just been successfully simulated`,
    );
  }

  const tx = buildExitTransaction(strategy.action as ExitAction, safe);

  try {
    const result = await broadcastExitTransaction(tx, safe.chainId);

    const [updated] = await db
      .update(keeperhubExecutions)
      .set({
        status: result.txHash ? "succeeded" : "failed",
        txHash: result.txHash,
        broadcastAt: result.txHash ? new Date() : null,
        responsePayload: result.raw as object,
        errorMessage: result.txHash
          ? null
          : "Broadcast response did not contain a verifiable transaction hash - needs manual verification, not reported as executed",
        updatedAt: new Date(),
      })
      .where(eq(keeperhubExecutions.id, execution.id))
      .returning();

    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: execution.id,
      eventType: result.txHash ? "execution.broadcast_succeeded" : "execution.broadcast_unconfirmed",
      payload: { txHash: result.txHash, result },
    });

    res.status(200).json(updated);
  } catch (err) {
    // A confirmed rejection (KeeperHubApiError - the request reached
    // KeeperHub and it explicitly said no) is reported as a plain
    // failure. Anything else - a network error, timeout, or other
    // exception with no HTTP response at all - means we genuinely do not
    // know whether KeeperHub received and broadcast this transaction.
    // The row is still marked `failed` (there is no "unknown" status,
    // and `decideBroadcast` must never let a `failed` row be retried
    // through this same execution automatically), but the message makes
    // the ambiguity explicit so a human checks the chain before assuming
    // nothing happened and creating a fresh execution.
    const confirmed = err instanceof KeeperHubApiError;
    const errorMessage = confirmed
      ? (err as Error).message
      : `Broadcast outcome could not be confirmed - KeeperHub may or may not have received this request. ` +
        `Verify on BaseScan / the Safe's transaction history for Roles Modifier ${tx.rolesModifierAddress} ` +
        `before creating a new execution for this strategy. Underlying error: ${(err as Error).message}`;

    const [failed] = await db
      .update(keeperhubExecutions)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(eq(keeperhubExecutions.id, execution.id))
      .returning();

    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: execution.id,
      eventType: confirmed ? "execution.broadcast_rejected" : "execution.broadcast_ambiguous",
      payload: { message: errorMessage },
    });

    logger.error({ err, executionId: execution.id, confirmed }, "KeeperHub broadcast call failed");
    res.status(502).json(failed);
  }
});
