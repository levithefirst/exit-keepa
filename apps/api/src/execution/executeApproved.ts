import { and, eq } from "drizzle-orm";
import { resolveWithdrawAmount, type ExitAction } from "@exit-keepa/shared";
import { db } from "../db";
import { agentDecisions, auditEvents, exitStrategies, keeperhubExecutions, safeAccounts } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";
import { checkAmountExceeded, checkStaleIntent, readAaveUsdcPositionBalance } from "../agent/broadcastGuards";
import { buildExitTransaction } from "./buildTransaction";
import { broadcastWithIdempotencyRetry, isAmbiguousKeeperHubError, pollDirectExecutionStatus } from "./executor";
import { deriveExecutionOutcomeFromStatus } from "./statusOutcome";
import { decideBroadcast } from "./stateMachine";
import { KeeperHubIdempotencyConflictError, KeeperHubIdempotencyInProgressError } from "../keeperhub/client";

type ExecutionRow = typeof keeperhubExecutions.$inferSelect;

/**
 * What actually happened to the execution. Every caller maps this to its
 * own surface (an HTTP status in routes/executions.ts, a log line and a
 * receipt in agent/guardian.ts) - the decision itself is made here, once,
 * so an autonomous run and a manual/admin recovery run can never disagree
 * about what "succeeded" means.
 */
export type ExecuteApprovedKind =
  /** Already broadcast (a hash exists, or the row is already `succeeded`) - nothing was re-sent. */
  | "already_broadcast"
  /** Not in a state that may be broadcast at all (not `simulated`, or someone else claimed it first). */
  | "not_broadcastable"
  /** A pre-broadcast guard (stale intent / live amount) stopped it before KeeperHub was ever called. */
  | "blocked"
  /** Real broadcast, authoritatively confirmed on-chain. */
  | "succeeded"
  /** Demo sandbox: the full lifecycle ran deterministically, nothing was sent to any chain. */
  | "demo_completed"
  /** Confirmed failure - KeeperHub answered and said no, or a receipt reverted. */
  | "failed"
  /** Sent, outcome not yet authoritative (poll budget ran out, receipts still unverified). */
  | "unconfirmed"
  /** KeeperHub still processing this Idempotency-Key - NOT a failure. */
  | "in_progress"
  /** Idempotency-Key bound to a different body - fail-closed, never rotated to a new key. */
  | "conflict";

export interface ExecuteApprovedResult {
  kind: ExecuteApprovedKind;
  /** The execution row as it stands after this attempt. Null only when the row vanished. */
  row: ExecutionRow | null;
  /** Human-readable reason - always set for `not_broadcastable` and `blocked`. */
  reason?: string;
}

export class ExecutionNotFoundError extends Error {}

/**
 * The one canonical answer to "execute this already-approved Exit Keepa
 * transaction safely."
 *
 * Called by both the autonomous Exit Guardian (agent/guardian.ts, straight
 * after a clean simulation) and the manual/admin recovery route
 * (routes/executions.ts's broadcast endpoint). Neither of them
 * re-implements any part of the sequence below, so there is exactly one
 * broadcast lifecycle in this codebase and exactly one definition of every
 * guard on it.
 *
 * Everything it acts on is re-read from the database here, at the moment of
 * the one irreversible step, rather than taken from the caller: the
 * execution row, the strategy, the Safe, and the transaction itself (which
 * is deterministically rebuilt by buildExitTransaction from stored,
 * validated fields - a caller can never supply a target, selector, or
 * calldata). A strategy edited, or a position drained, between approval and
 * this call is therefore still caught.
 *
 * `approvedAt` is when the authority to broadcast was established. The
 * Guardian passes the instant it read live state; the manual route passes
 * nothing and the approving agent decision's own `createdAt` is used, so a
 * row left `simulated` for an hour and then broadcast by hand is still
 * stale-checked exactly as before.
 */
export async function executeApprovedExecution(input: {
  executionId: string;
  strategyId: string;
  approvedAt?: Date | null;
}): Promise<ExecuteApprovedResult> {
  const [execution] = await db
    .select()
    .from(keeperhubExecutions)
    .where(
      and(eq(keeperhubExecutions.id, input.executionId), eq(keeperhubExecutions.exitStrategyId, input.strategyId)),
    )
    .limit(1);
  if (!execution) throw new ExecutionNotFoundError(`Execution ${input.executionId} not found`);

  const [strategy] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, input.strategyId)).limit(1);
  if (!strategy) throw new ExecutionNotFoundError(`Exit strategy ${input.strategyId} not found`);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, strategy.safeId)).limit(1);
  if (!safe) throw new ExecutionNotFoundError(`Safe account ${strategy.safeId} not found`);

  const decision = decideBroadcast({ status: execution.status, txHash: execution.txHash });
  if (decision.action === "already_broadcast") {
    return { kind: "already_broadcast", row: execution };
  }
  if (decision.action === "reject") {
    return { kind: "not_broadcastable", row: execution, reason: decision.reason };
  }

  // Stale-intent and amount-exceeded checks run against live state
  // (strategy.updatedAt, the approving decision's own age, the Safe's
  // current Aave position) right before the one irreversible step, not at
  // decision time - so an execution approved minutes ago against
  // conditions that have since changed is blocked here instead of
  // broadcasting on stale authority.
  let decisionCreatedAt: Date | null;
  if (input.approvedAt !== undefined) {
    decisionCreatedAt = input.approvedAt;
  } else {
    // At most one decision ever links to a given executionId (it's set once,
    // at creation, and never reassigned - see agent/guardian.ts), so this
    // needs no ordering.
    const [linkedDecision] = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.executionId, execution.id))
      .limit(1);
    decisionCreatedAt = linkedDecision?.createdAt ?? null;
  }

  const staleness = checkStaleIntent({
    decisionCreatedAt,
    strategyUpdatedAt: strategy.updatedAt,
    now: new Date(),
    maxAgeMs: env.AGENT_DECISION_MAX_AGE_MS,
  });

  const action = strategy.action as ExitAction;
  let amountGuard: { blocked: boolean; reason?: string } = { blocked: false };
  // A sandbox Safe has a synthetic address that holds no aUSDC on any real
  // chain, so a live-position read for one would always answer 0 and block
  // every demo - the same reason simulate.ts never sends a sandbox Safe to
  // KeeperHub. Skipped only for sandbox; every real Safe is still checked,
  // and still fails closed if the read itself fails.
  if (action.amount !== "max" && !safe.isSandbox) {
    try {
      const [livePosition, configuredAmount] = await Promise.all([
        readAaveUsdcPositionBalance(safe.safeAddress),
        Promise.resolve(resolveWithdrawAmount(action.amount)),
      ]);
      amountGuard = checkAmountExceeded(configuredAmount, livePosition);
    } catch (err) {
      // Can't confirm the live position - fail closed rather than assume
      // the configured amount is still safe to withdraw.
      amountGuard = {
        blocked: true,
        reason: `Could not verify the live Aave position before broadcast: ${(err as Error).message}`,
      };
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
      logger.warn(
        { executionId: execution.id, reason: guardResult.reason },
        "Broadcast blocked before reaching KeeperHub",
      );
      return { kind: "blocked", row: blocked, reason: guardResult.reason };
    }
    // Lost the race to another request that already moved this row past
    // `simulated` - fall through to the normal broadcast path below, which
    // will itself see the execution is no longer `simulated` and reject.
  }

  // Conditional UPDATE makes the "proceed" decision race-safe: only the
  // caller that actually flips status simulated -> executing gets to
  // broadcast, so two concurrent attempts (two poll ticks, a poll tick and
  // a manual recovery click) can never both submit.
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
    return {
      kind: "not_broadcastable",
      row: current ?? execution,
      reason: `Execution is ${current?.status} - can only broadcast an execution that has just been successfully simulated`,
    };
  }

  const tx = buildExitTransaction(strategy.action as ExitAction, safe);

  if (safe.isSandbox) {
    return completeSandboxDemoExecution(execution, tx.rolesModifierAddress);
  }

  try {
    // Safe First-Write Sequence steps 3-4
    // (https://docs.keeperhub.com/api/direct-execution#safe-first-write-sequence):
    // send the exact simulated body once more with `simulate` removed
    // and an Idempotency-Key attached - sourced from this row's own
    // stable `idempotencyKey` column (set once at creation, never
    // regenerated), not minted fresh per attempt, so a retried request
    // replays instead of double-broadcasting. Retried automatically,
    // same key, only for the documented `idempotency_in_progress` case.
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
          "Direct execution status poll failed after broadcast - leaving execution non-terminal for follow-up",
        );
        return null;
      });
      outcome = poll
        ? deriveExecutionOutcomeFromStatus(poll.status, result.txHash)
        : { status: "executing", txHash: result.txHash, errorMessage: null };
    } else {
      // KeeperHub returned no executionId to poll at all - fall back to
      // the synchronous broadcast response rather than blocking on
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

    return {
      kind: outcome.status === "succeeded" ? "succeeded" : outcome.status === "failed" ? "failed" : "unconfirmed",
      row: updated,
      reason: outcome.errorMessage ?? undefined,
    };
  } catch (err) {
    // Per https://docs.keeperhub.com/api/direct-execution#idempotency,
    // `idempotency_in_progress` means KeeperHub is still processing the
    // original request under this key even after broadcastWithIdempotencyRetry's
    // own retries were exhausted - this is NOT a failure, and marking it
    // `failed` would misreport an execution that may yet succeed. Leave
    // the row `executing`; a later status check against this same
    // executionId resolves it. `decideBroadcast` already refuses to let
    // any non-`simulated` row broadcast again, so this can never silently
    // double-fire.
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
      logger.warn(
        { executionId: execution.id },
        "KeeperHub broadcast still in progress under this Idempotency-Key after retries",
      );
      return { kind: "in_progress", row: inProgress, reason: message };
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
      return { kind: "conflict", row: conflicted, reason: message };
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
    // nothing happened. Fail-closed: this path never retries with a fresh
    // Idempotency-Key for the same intent, since that is exactly what
    // could double-broadcast.
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
    return { kind: "failed", row: failed, reason: errorMessage };
  }
}

/**
 * A demo session's own sandbox Safe (see routes/auth.ts's POST
 * /api/auth/demo-session) has a synthetic safeAddress and Roles Modifier
 * that exist on no chain - there is nothing to broadcast to, and no real
 * transaction can ever result. Rather than dead-ending the demo at
 * "simulated" (which left the product's whole point unexercised), the
 * lifecycle runs to completion here deterministically: the same
 * decideBroadcast gate, the same stale-intent check, the same atomic
 * simulated -> executing claim, and then this terminal state.
 *
 * `demo_completed` is its own status precisely so it can never be confused
 * with `succeeded`. txHash stays null - no hash is invented, and the
 * response payload says in words that nothing was sent to any chain, so
 * neither the API, the UI, nor an audit reader can mistake this for a real
 * onchain execution.
 */
async function completeSandboxDemoExecution(
  execution: ExecutionRow,
  rolesModifierAddress: string,
): Promise<ExecuteApprovedResult> {
  const note =
    "Demo execution completed in Exit Keepa's sandbox. Every step of the real lifecycle ran - trigger, policy check, " +
    "simulation, broadcast claim, status resolution - but nothing was sent to any blockchain, because this sandbox " +
    "Safe exists only in this demo session. There is no transaction hash because there is no transaction.";

  const [updated] = await db
    .update(keeperhubExecutions)
    .set({
      status: "demo_completed",
      txHash: null,
      broadcastAt: null,
      responsePayload: { sandbox: true, demo: true, rolesModifierAddress, note },
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(keeperhubExecutions.id, execution.id))
    .returning();

  await db.insert(auditEvents).values({
    entityType: "keeperhub_execution",
    entityId: execution.id,
    eventType: "execution.demo_completed",
    payload: { sandbox: true, note },
  });

  logger.info({ executionId: execution.id }, "Sandbox demo execution completed - nothing broadcast to any chain");
  return { kind: "demo_completed", row: updated, reason: note };
}
