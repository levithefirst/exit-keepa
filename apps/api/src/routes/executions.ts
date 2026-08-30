import { Router } from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ExitAction, RateCondition } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, exitStrategies, keeperhubExecutions, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { buildExitTransaction } from "../execution/buildTransaction";
import { broadcastExitTransaction, simulateExitTransaction } from "../execution/executor";
import { evaluateRateCondition } from "../execution/evaluateCondition";
import { decideBroadcast } from "../execution/stateMachine";

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

  let result;
  try {
    result = await simulateExitTransaction(tx, safe.chainId);
  } catch (err) {
    const [failed] = await db
      .update(keeperhubExecutions)
      .set({ status: "failed", errorMessage: (err as Error).message, updatedAt: new Date() })
      .where(eq(keeperhubExecutions.id, execution.id))
      .returning();
    logger.error({ err, executionId: execution.id }, "KeeperHub simulation call failed");
    res.status(502).json(failed);
    return;
  }

  const wouldSucceed = result.parsed?.wouldRevert === false;
  const [updated] = await db
    .update(keeperhubExecutions)
    .set({
      status: wouldSucceed ? "simulated" : "failed",
      requestPayload: result.request,
      responsePayload: result.raw as object,
      errorMessage: wouldSucceed ? null : (result.parsed?.revertReason ?? "Simulation failed"),
      updatedAt: new Date(),
    })
    .where(eq(keeperhubExecutions.id, execution.id))
    .returning();

  await db.insert(auditEvents).values({
    entityType: "keeperhub_execution",
    entityId: execution.id,
    eventType: "execution.simulated",
    payload: { wouldSucceed, result },
  });

  res.status(200).json(updated);
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
    const [failed] = await db
      .update(keeperhubExecutions)
      .set({ status: "failed", errorMessage: (err as Error).message, updatedAt: new Date() })
      .where(eq(keeperhubExecutions.id, execution.id))
      .returning();
    logger.error({ err, executionId: execution.id }, "KeeperHub broadcast call failed");
    res.status(502).json(failed);
  }
});
