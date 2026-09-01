import { keeperHubClient, KeeperHubApiError, KeeperHubIdempotencyInProgressError } from "../keeperhub/client";
import type { DirectExecutionStatusResponse, ExecTransactionWithRoleResult } from "../keeperhub/types";
import type { BuiltTransaction } from "./buildTransaction";
import { logger } from "../logger";

const VALID_TX_HASH = /^0x[a-fA-F0-9]{64}$/;

export interface ExecTransactionCallResult {
  request: Record<string, unknown>;
  raw: unknown;
  parsed: ExecTransactionWithRoleResult | null;
}

function buildRequest(tx: BuiltTransaction, chainId: number, simulate: boolean) {
  return {
    contractAddress: tx.rolesModifierAddress,
    chainId,
    functionName: "execTransactionWithRole",
    functionArgs: JSON.stringify([tx.to, tx.value, tx.data, String(tx.operation), tx.roleKey, true]),
    simulate,
  };
}

async function callExecTransactionWithRole(
  tx: BuiltTransaction,
  chainId: number,
  simulate: boolean,
  idempotencyKey?: string,
): Promise<ExecTransactionCallResult> {
  const request = buildRequest(tx, chainId, simulate);
  // Per https://docs.keeperhub.com/api/direct-execution#idempotency,
  // "Read-only and dry-run (simulate: true) requests are not affected" -
  // only ever attach the header on a real broadcast, never a simulation.
  const raw = await keeperHubClient.callContractFunction(
    request,
    !simulate && idempotencyKey ? { idempotencyKey } : undefined,
  );
  // The real response for execTransactionWithRole is a richer shape than
  // the plain-read ContractCallResult the client is typed to return (see
  // ExecTransactionWithRoleResult's doc comment) - re-read it defensively
  // rather than trusting the narrower compile-time type.
  const parsed =
    raw && typeof raw === "object" && "wouldRevert" in (raw as unknown as Record<string, unknown>)
      ? (raw as unknown as ExecTransactionWithRoleResult)
      : null;
  return { request, raw, parsed };
}

/** Simulates the transaction (simulate: true). Never broadcasts. */
export function simulateExitTransaction(tx: BuiltTransaction, chainId: number) {
  return callExecTransactionWithRole(tx, chainId, true);
}

/**
 * Extracts a transaction hash from a KeeperHub broadcast response,
 * checking every field name/nesting actually observed across this
 * project's live broadcasts, plus the common aliases other KeeperHub
 * response shapes could plausibly use. LIVE-VERIFIED response shape for a
 * successful broadcast (2026-08-31,
 * tx 0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b):
 * `{ status: "completed", executionId, transactionHash, transactionLink }`
 * - no `wouldRevert` key, so it does NOT parse as
 * ExecTransactionWithRoleResult. The original implementation only
 * checked `parsed?.transactionHash` (gated on `wouldRevert` being
 * present) and a top-level `result` string, so it missed this exact
 * shape and reported a real, successful, on-chain broadcast as failed.
 * Never invents a hash - only returns one that was actually present in
 * the response.
 */
function extractTransactionHash(raw: unknown, parsed: ExecTransactionWithRoleResult | null): string | undefined {
  if (parsed?.transactionHash) return parsed.transactionHash;
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;
  const nested = [body, body.result, body.data].filter(
    (candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object",
  );
  for (const candidate of nested) {
    for (const key of ["transactionHash", "txHash", "hash"]) {
      const value = candidate[key];
      if (typeof value === "string") return value;
    }
  }
  // `result` itself as a bare string (the shape used by a plain read call).
  if (typeof body.result === "string") return body.result;
  return undefined;
}

/**
 * Extracts KeeperHub's own execution id (e.g. `"direct_123"`) from a
 * broadcast response, the same defensive way extractTransactionHash()
 * does - checked at the top level and the same nested locations, never
 * invented. This is the id routes/executions.ts persists as
 * `keeperhub_executions.keeperhub_execution_id` and polls via
 * `KeeperHubClient.getDirectExecutionStatus` for the Safe First-Write
 * Sequence's status step.
 */
function extractKeeperHubExecutionId(raw: unknown, parsed: ExecTransactionWithRoleResult | null): string | undefined {
  if (parsed?.executionId) return parsed.executionId;
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;
  const nested = [body, body.result, body.data].filter(
    (candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object",
  );
  for (const candidate of nested) {
    const value = candidate.executionId;
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Broadcasts the transaction for real (simulate: false). Only ever call
 * this after a successful simulation and after confirming no prior
 * broadcast exists for this execution row - see routes/executions.ts.
 *
 * A transaction hash is only ever trusted, stored, or reported to the
 * user if it matches a well-formed 66-character 0x hash - anything else
 * is treated as "broadcast attempted, hash unconfirmed" rather than
 * fabricated or guessed at.
 *
 * `idempotencyKey` is required, not optional: per the Safe First-Write
 * Sequence (https://docs.keeperhub.com/api/direct-execution#safe-first-write-sequence)
 * every broadcast must carry one, and it must identify the work (this
 * execution row's own id - see routes/executions.ts) rather than being
 * minted fresh per HTTP attempt, so a retried request replays instead of
 * double-broadcasting.
 */
export async function broadcastExitTransaction(tx: BuiltTransaction, chainId: number, idempotencyKey: string) {
  const result = await callExecTransactionWithRole(tx, chainId, false, idempotencyKey);

  const candidateHash = extractTransactionHash(result.raw, result.parsed);
  const txHash = candidateHash && VALID_TX_HASH.test(candidateHash) ? candidateHash : null;

  if (candidateHash && !txHash) {
    logger.warn(
      { candidateHash },
      "Broadcast response contained a hash-like field that failed validation - not trusting it",
    );
  }

  const keeperhubExecutionId = extractKeeperHubExecutionId(result.raw, result.parsed);
  // Checked on `raw` too, not just `parsed` - the real successful-broadcast
  // shape (no `wouldRevert` key, see extractTransactionHash's doc comment)
  // never parses as ExecTransactionWithRoleResult, so `parsed` is null for
  // exactly the response shape a replay is most likely to arrive in.
  const idempotentReplay =
    result.parsed?.idempotentReplay === true ||
    (result.raw !== null && typeof result.raw === "object" && (result.raw as Record<string, unknown>).idempotentReplay === true);

  return { ...result, txHash, keeperhubExecutionId, idempotentReplay };
}

/**
 * `broadcastExitTransaction`, retrying automatically (same Idempotency-Key,
 * per https://docs.keeperhub.com/api/direct-execution#when-to-reuse-a-key-and-when-to-rotate-it:
 * "Reuse the same key whenever you do not hold a definite outcome... it
 * returns the in-progress guard while the first request is still
 * running, and the real outcome as a replay once it finishes") only for
 * `idempotency_in_progress` - the one documented case where retrying is
 * explicitly safe. Any other error (including
 * `KeeperHubIdempotencyConflictError`, or a plain network/ambiguous
 * failure) is never retried here and propagates immediately - see
 * `isAmbiguousKeeperHubError` and routes/executions.ts for how the
 * caller then fails closed.
 */
export async function broadcastWithIdempotencyRetry(
  tx: BuiltTransaction,
  chainId: number,
  idempotencyKey: string,
  options: { maxAttempts?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt++) {
    try {
      return await broadcastExitTransaction(tx, chainId, idempotencyKey);
    } catch (err) {
      if (!(err instanceof KeeperHubIdempotencyInProgressError) || attempt >= maxAttempts) {
        throw err;
      }
      logger.warn(
        { idempotencyKey, attempt, maxAttempts },
        "KeeperHub reported this Idempotency-Key still in progress - retrying the same key shortly",
      );
      await sleep(retryDelayMs);
    }
  }
}

const DEFAULT_POLL_MIN_INTERVAL_MS = 1_000;
const DEFAULT_POLL_MAX_INTERVAL_MS = 5_000;
const DEFAULT_POLL_BUDGET_MS = 20_000;

export interface PollDirectExecutionStatusResult {
  status: DirectExecutionStatusResponse;
  /** True once a poll answered with `X-Poll-Interval-Hint: 0` (a terminal state). */
  terminal: boolean;
  /** True if the poll budget ran out before a terminal state was reached. */
  timedOut: boolean;
}

/**
 * Polls `GET /api/execute/{executionId}/status` with backoff until the
 * response's `X-Poll-Interval-Hint` header says the execution reached a
 * terminal state (`0`), or until `budgetMs` elapses - see
 * https://docs.keeperhub.com/api/direct-execution#get-execution-status.
 * Bounded (default 20s) because this runs synchronously inside the
 * broadcast HTTP request; when the budget runs out the caller gets back
 * the last-seen non-terminal status rather than blocking indefinitely -
 * routes/executions.ts leaves the execution row `executing` in that case
 * so a later poll (not yet wired to a background job) can still resolve
 * it, and never fabricates `succeeded`/`failed` from an incomplete poll.
 *
 * A poll call that itself throws (network error, non-2xx) ends the loop
 * immediately rather than being silently retried - an ambiguous status
 * check must never turn into an unbounded retry loop against a
 * fund-moving execution.
 */
export async function pollDirectExecutionStatus(
  executionId: string,
  options: { budgetMs?: number; minIntervalMs?: number; maxIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PollDirectExecutionStatusResult> {
  const budgetMs = options.budgetMs ?? DEFAULT_POLL_BUDGET_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_POLL_MIN_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_POLL_MAX_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const deadline = Date.now() + budgetMs;

  for (;;) {
    const { status, pollIntervalHintSeconds } = await keeperHubClient.getDirectExecutionStatus(executionId);

    if (pollIntervalHintSeconds === 0) {
      return { status, terminal: true, timedOut: false };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { status, terminal: false, timedOut: true };
    }

    const hintMs = pollIntervalHintSeconds !== null ? pollIntervalHintSeconds * 1000 : minIntervalMs;
    const waitMs = Math.max(minIntervalMs, Math.min(hintMs, maxIntervalMs, remainingMs));
    await sleep(waitMs);
  }
}

/**
 * True only for a genuinely ambiguous outcome - a network/timeout error
 * with no HTTP response at all, where whether KeeperHub processed the
 * request is unknown. A confirmed KeeperHubApiError (KeeperHub answered
 * and rejected) is NOT ambiguous, even though it's still an error - see
 * KeeperHubApiError's own doc comment.
 */
export function isAmbiguousKeeperHubError(err: unknown): boolean {
  return !(err instanceof KeeperHubApiError);
}
