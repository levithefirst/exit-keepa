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
import { broadcastWithIdempotencyRetry, isAmbiguousKeeperHubError, pollDirectExecutionStatus } from "../execution/executor";
import { simulatePendingExecution } from "../execution/simulate";
import { deriveExecutionOutcomeFromStatus } from "../execution/statusOutcome";
import { KeeperHubIdempotencyConflictError, KeeperHubIdempotencyInProgressError } from "../keeperhub/client";
import { evaluateRateCondition } from "../execution/evaluateCondition";
import { decideBroadcast } from "../execution/stateMachine";
import { checkAmountExceeded, checkStaleIntent, readAaveUsdcPositionBalance } from "../agent/broadcastGuards";
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
 * Step 3: real broadcast (simulate: false). Idempotent by construction:
 * the conditional UPDATE below only transitions a row out of `simulated`
 * once, atomically - a retried/duplicate request against a row that's
 * already `executing`, `succeeded`, or `failed` is rejected or short-
 * circuited rather than causing a second broadcast.
 */
executionsRouter.post("/exit-strategies/:id/executions/:executionId/broadcast", async (req, res) => {
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

  if (safe.isSandbox) {
    throw new HttpError(
      409,
      "This is a demo sandbox Safe - it isn't deployed on any real chain, so there's nothing real to broadcast to. Connect a real wallet and Safe to actually execute a strategy.",
    );
  }

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
    // Safe First-Write Sequence steps 3-4
    // (https://docs.keeperhub.com/api/direct-execution#safe-first-write-sequence):
    // send the exact simulated body once more with `simulate` removed
    // and an Idempotency-Key attached - sourced from this row's own
    // stable `idempotencyKey` column (set once at creation, never
    // regenerated), not minted fresh per HTTP attempt, so a retried
    // request replays instead of double-broadcasting. Retried
    // automatically, same key, only for the documented
    // `idempotency_in_progress` case.
    const result = await broadcastWithIdempotencyRetry(tx, safe.chainId, execution.idempotencyKey);

    // Step 5-6: persist KeeperHub's own executionId as soon as it's
    // known, then poll GET /execute/{executionId}/status and treat its
    // receipts as authoritative - never the self-reported txHash/status
    // alone. A poll failure (network error, timeout budget exhausted)
    // leaves the row `executing` rather than guessing success/failure.
    let outcome: ReturnType<typeof deriveExecutionOutcomeFromStatus>;
    if (result.keeperhubExecutionId) {
      const poll = await pollDirectExecutionStatus(result.keeperhubExecutionId).catch((pollErr) => {
        logger.error(
          { err: pollErr, executionId: execution.id, keeperhubExecutionId: result.keeperhubExecutionId },
          "Direct execution status poll failed after broadcast - leaving execution non-terminal for manual follow-up",
        );
        return null;
      });
      outcome = poll
        ? deriveExecutionOutcomeFromStatus(poll.status, result.txHash)
        : { status: "executing", txHash: result.txHash, errorMessage: null };
    } else {
      // KeeperHub returned no executionId to poll at all - fall back to
      // the synchronous broadcast response the same way this route
      // worked before status polling existed, rather than blocking on
      // nothing.
      outcome = {
        status: result.txHash ? "succeeded" : "failed",
        txHash: result.txHash,
        errorMessage: result.txHash
          ? null
          : "Broadcast response did not contain a verifiable transaction hash - needs manual verification, not reported as executed",
      };
    }

    const [updated] = await db
      .update(keeperhubExecutions)
      .set({
        status: outcome.status,
        txHash: outcome.txHash,
        keeperhubExecutionId: result.keeperhubExecutionId ?? execution.keeperhubExecutionId,
        broadcastAt: outcome.status === "succeeded" ? new Date() : null,
        responsePayload: result.raw as object,
        errorMessage: outcome.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(keeperhubExecutions.id, execution.id))
      .returning();

    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: execution.id,
      eventType:
        outcome.status === "succeeded"
          ? "execution.broadcast_succeeded"
          : outcome.status === "failed"
            ? "execution.broadcast_failed"
            : "execution.broadcast_unconfirmed",
      payload: {
        txHash: outcome.txHash,
        keeperhubExecutionId: result.keeperhubExecutionId,
        idempotentReplay: result.idempotentReplay,
        result,
      },
    });

    res.status(outcome.status === "failed" ? 502 : 200).json(updated);
  } catch (err) {
    // Per https://docs.keeperhub.com/api/direct-execution#idempotency,
    // `idempotency_in_progress` means KeeperHub is still processing the
    // original request under this key even after broadcastWithIdempotencyRetry's
    // own retries were exhausted - this is NOT a failure, and marking it
    // `failed` would misreport an execution that may yet succeed. Leave
    // the row `executing`; a human (or a later status check against this
    // same executionId) resolves it. `decideBroadcast` already refuses
    // to let any non-`simulated` row broadcast again, so this can never
    // silently double-fire.
    if (err instanceof KeeperHubIdempotencyInProgressError) {
      const message =
        `KeeperHub is still processing this execution under Idempotency-Key ${execution.idempotencyKey} - ` +
        `the request was not lost. Check back shortly rather than creating a new execution for this strategy.`;
      const [inProgress] = await db
        .update(keeperhubExecutions)
        .set({ errorMessage: message, updatedAt: new Date() })
        .where(eq(keeperhubExecutions.id, execution.id))
        .returning();
      await db.insert(auditEvents).values({
        entityType: "keeperhub_execution",
        entityId: execution.id,
        eventType: "execution.broadcast_idempotency_in_progress",
        payload: { message },
      });
      logger.warn({ executionId: execution.id }, "KeeperHub broadcast still in progress under this Idempotency-Key after retries");
      res.status(202).json(inProgress);
      return;
    }

    // A confirmed `409 idempotency_conflict` means KeeperHub bound this
    // key to a request body that doesn't match the one just sent. This
    // project's request body is deterministically rebuilt from the same
    // DB-stored strategy/Safe fields every time for a given execution
    // row, so this should never legitimately happen - treat it as a
    // hard, fail-closed bug signal rather than something to work around
    // by rotating to a new key (which is exactly the documented unsafe
    // move: https://docs.keeperhub.com/api/direct-execution#a-stable-key-does-not-by-itself-produce-a-replay).
    if (err instanceof KeeperHubIdempotencyConflictError) {
      const message =
        `KeeperHub rejected this broadcast as an Idempotency-Key conflict (409 idempotency_conflict): the key ` +
        `${execution.idempotencyKey} is already bound to a different request body. This should never happen for ` +
        `a deterministically-rebuilt transaction and indicates a bug, not a transient failure - not retried with ` +
        `a new key.` +
        (err.originalExecutionId ? ` KeeperHub's original execution under this key: ${err.originalExecutionId}.` : "");
      const [conflicted] = await db
        .update(keeperhubExecutions)
        .set({
          status: "failed",
          errorMessage: message,
          keeperhubExecutionId: err.originalExecutionId ?? execution.keeperhubExecutionId,
          updatedAt: new Date(),
        })
        .where(eq(keeperhubExecutions.id, execution.id))
        .returning();
      await db.insert(auditEvents).values({
        entityType: "keeperhub_execution",
        entityId: execution.id,
        eventType: "execution.broadcast_idempotency_conflict",
        payload: { message, originalExecutionId: err.originalExecutionId },
      });
      logger.error(
        { executionId: execution.id, originalExecutionId: err.originalExecutionId },
        "KeeperHub Idempotency-Key conflict on broadcast",
      );
      res.status(502).json(conflicted);
      return;
    }

    // A confirmed rejection (KeeperHubApiError - the request reached
    // KeeperHub and it explicitly said no) is reported as a plain
    // failure. Anything else - a network error, timeout, or other
    // exception with no HTTP response at all - means we genuinely do not
    // know whether KeeperHub received and broadcast this transaction.
    // The row is still marked `failed` (there is no "unknown" status,
    // and `decideBroadcast` must never let a `failed` row be retried
    // through this same execution automatically), but the message makes
    // the ambiguity explicit so a human checks the chain before assuming
    // nothing happened and creating a fresh execution. Fail-closed: this
    // path never retries with a fresh Idempotency-Key for the same
    // intent, since that is exactly what could double-broadcast.
    const confirmed = !isAmbiguousKeeperHubError(err);
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

  if (!execution.keeperhubExecutionId || execution.status === "succeeded" || execution.status === "failed") {
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
