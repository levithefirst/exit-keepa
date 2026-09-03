import { Router } from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type ExitAction, type RateCondition } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, exitStrategies, keeperhubExecutions, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { buildExitTransaction } from "../execution/buildTransaction";
import { pollDirectExecutionStatus } from "../execution/executor";
import {
  executeApprovedExecution,
  ExecutionNotFoundError,
  type ExecuteApprovedResult,
} from "../execution/executeApproved";
import { simulatePendingExecution } from "../execution/simulate";
import { deriveExecutionOutcomeFromStatus } from "../execution/statusOutcome";
import { evaluateRateCondition } from "../execution/evaluateCondition";
import { requireSafeOwnership, requireSession } from "../auth/session";

export const executionsRouter = Router();

/** Postgres error code 23505 = unique_violation. neon-http surfaces the
 * driver error with `.code` set the same way node-postgres does. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

async function loadStrategyAndSafe(strategyId: string, address: string) {
  const [strategy] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, strategyId)).limit(1);
  if (!strategy) throw new HttpError(404, `Exit strategy ${strategyId} not found`);

  await requireSafeOwnership(strategy.safeId, address);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, strategy.safeId)).limit(1);
  if (!safe) throw new HttpError(404, `Safe account ${strategy.safeId} not found`);

  return { strategy, safe };
}

executionsRouter.get("/exit-strategies/:id/executions", async (req, res) => {
  const address = await requireSession(req);
  await loadStrategyAndSafe(req.params.id, address);

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
  const address = await requireSession(req);
  const { currentRateBps } = createExecutionSchema.parse(req.body);
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id, address);

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

  let row: typeof keeperhubExecutions.$inferSelect;
  try {
    [row] = await db
      .insert(keeperhubExecutions)
      .values({
        id: executionId,
        exitStrategyId: strategy.id,
        idempotencyKey: executionId,
        createdVia: "manual",
        status: "pending",
        requestPayload: { tx, currentRateBps },
      })
      .returning();
  } catch (err) {
    // Belt-and-suspenders against the read-then-write race above: two
    // concurrent requests can both pass the "no in-flight execution" check
    // before either has inserted, and both attempt to insert. The DB-level
    // partial unique index (one non-terminal execution per strategy - see
    // migration 0003) is what actually prevents two rows from existing; a
    // unique-violation here means we lost that race, not that the request
    // failed, so return whichever row won instead of erroring.
    if (isUniqueViolation(err)) {
      const rows = await db
        .select()
        .from(keeperhubExecutions)
        .where(eq(keeperhubExecutions.exitStrategyId, strategy.id));
      const winningRow = rows.find((e) =>
        (["pending", "simulating", "simulated", "executing"] as string[]).includes(e.status),
      );
      if (winningRow) {
        res.status(200).json(winningRow);
        return;
      }
      // Extremely unlikely (the winning row would have to already be
      // terminal by the time we look), but fail loudly rather than silently
      // swallow an unexplained constraint violation.
      throw new HttpError(409, "Another execution attempt for this strategy is already in flight");
    }
    throw err;
  }

  await db.insert(auditEvents).values({
    entityType: "keeperhub_execution",
    entityId: row.id,
    eventType: "execution.created",
    payload: { tx, currentRateBps },
  });

  res.status(201).json(row);
});

executionsRouter.post("/exit-strategies/:id/executions/:executionId/simulate", async (req, res) => {
  const address = await requireSession(req);
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id, address);
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
  const outcome = await simulatePendingExecution(execution.id, tx, safe.chainId, safe.isSandbox);
  res.status(outcome.callFailed ? 502 : 200).json(outcome.row);
});

/**
 * Manual/admin recovery: run the canonical execution service against an
 * execution that is sitting `simulated`. The autonomous Exit Guardian
 * normally does this itself the instant it approves and simulates cleanly
 * (see agent/guardian.ts) - this endpoint exists for the cases the
 * autonomous path deliberately leaves open: a row left non-terminal by an
 * `idempotency_in_progress` response, an execution created through the
 * older manual create+simulate endpoints, or an operator re-driving one by
 * hand.
 *
 * It implements none of the lifecycle itself. Every guard, the atomic
 * simulated -> executing claim, the deterministic transaction rebuild, the
 * stable Idempotency-Key, the status poll and all of the failure branches
 * live in execution/executeApproved.ts, so a manual recovery and an
 * autonomous run cannot diverge - this handler only maps the result onto
 * an HTTP status code.
 */
executionsRouter.post("/exit-strategies/:id/executions/:executionId/broadcast", async (req, res) => {
  const address = await requireSession(req);
  const { strategy } = await loadStrategyAndSafe(req.params.id, address);

  let result: ExecuteApprovedResult;
  try {
    result = await executeApprovedExecution({
      executionId: req.params.executionId,
      strategyId: strategy.id,
    });
  } catch (err) {
    if (err instanceof ExecutionNotFoundError) throw new HttpError(404, "Execution not found");
    throw err;
  }

  if (result.kind === "not_broadcastable") {
    throw new HttpError(409, result.reason ?? "This execution cannot be broadcast in its current state");
  }

  res.status(EXECUTE_RESULT_HTTP_STATUS[result.kind]).json(result.row);
});

/**
 * How each canonical-service outcome maps onto HTTP. Unchanged from when
 * this route implemented the lifecycle inline: 202 for
 * `idempotency_in_progress` (not lost, not failed), 502 for a confirmed
 * failure or key conflict, 200 for everything a caller should simply read
 * off the returned row - including `unconfirmed`, which is deliberately
 * not an error because the transaction may still land.
 */
const EXECUTE_RESULT_HTTP_STATUS: Record<Exclude<ExecuteApprovedResult["kind"], "not_broadcastable">, number> = {
  already_broadcast: 200,
  blocked: 200,
  succeeded: 200,
  demo_completed: 200,
  unconfirmed: 200,
  in_progress: 202,
  failed: 502,
  conflict: 502,
};

/**
 * Re-checks a non-terminal execution's status against KeeperHub directly
 * (`GET /api/execute/{executionId}/status`), independent of the poll
 * already attempted inline during broadcast - for the case where that
 * poll's bounded budget ran out, or the row was left `executing` after
 * an `idempotency_in_progress` response. A no-op for a row with no
 * `keeperhubExecutionId` yet (nothing to poll) or one already terminal
 * (`succeeded`/`failed`) - returns the row as-is rather than erroring,
 * so a client can poll this on an interval without special-casing state.
 */
executionsRouter.post("/exit-strategies/:id/executions/:executionId/refresh-status", async (req, res) => {
  const address = await requireSession(req);
  const { strategy } = await loadStrategyAndSafe(req.params.id, address);
  const [execution] = await db
    .select()
    .from(keeperhubExecutions)
    .where(
      and(eq(keeperhubExecutions.id, req.params.executionId), eq(keeperhubExecutions.exitStrategyId, strategy.id)),
    )
    .limit(1);
  if (!execution) throw new HttpError(404, "Execution not found");

  // `demo_completed` is terminal too, and has no KeeperHub execution to
  // poll - listed explicitly rather than relying on the null-id check
  // alone, so the terminal set stays readable in one place.
  const terminal = ["succeeded", "failed", "demo_completed"];
  if (!execution.keeperhubExecutionId || terminal.includes(execution.status)) {
    res.status(200).json(execution);
    return;
  }

  const poll = await pollDirectExecutionStatus(execution.keeperhubExecutionId, { budgetMs: 15_000 }).catch((pollErr) => {
    logger.error(
      { err: pollErr, executionId: execution.id, keeperhubExecutionId: execution.keeperhubExecutionId },
      "Direct execution status refresh failed",
    );
    return null;
  });

  if (!poll) {
    res.status(200).json(execution);
    return;
  }

  const outcome = deriveExecutionOutcomeFromStatus(poll.status, execution.txHash);
  const [updated] = await db
    .update(keeperhubExecutions)
    .set({
      status: outcome.status,
      txHash: outcome.txHash ?? execution.txHash,
      broadcastAt: outcome.status === "succeeded" ? (execution.broadcastAt ?? new Date()) : execution.broadcastAt,
      errorMessage: outcome.errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(keeperhubExecutions.id, execution.id))
    .returning();

  if (outcome.status !== execution.status) {
    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: execution.id,
      eventType:
        outcome.status === "succeeded" ? "execution.status_confirmed" : outcome.status === "failed" ? "execution.status_failed" : "execution.status_still_pending",
      payload: { status: poll.status, terminal: poll.terminal, timedOut: poll.timedOut },
    });
  }

  res.status(200).json(updated);
});
