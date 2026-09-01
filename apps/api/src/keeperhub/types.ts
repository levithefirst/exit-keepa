/**
 * Types for the subset of the KeeperHub REST API that is documented at
 * https://docs.keeperhub.com/api and confirmed via KeeperHub's own public
 * README (https://github.com/KeeperHub/keeperhub). See
 * docs/keeperhub-integration.md for the full research trail, what is
 * verified vs. still open, and why nothing beyond this subset is wired up
 * yet.
 *
 * Do not add fields/endpoints here speculatively - if it isn't confirmed
 * against KeeperHub's docs or dashboard response shapes, it doesn't belong
 * in this client.
 */

export interface KeeperHubWorkflow {
  id: string;
  name: string;
  status: string;
  chainId?: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface KeeperHubExecution {
  id: string;
  workflowId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface CreateWorkflowRequest {
  name: string;
  /**
   * Opaque workflow definition as accepted by KeeperHub's workflow builder
   * schema. Not modeled field-by-field here because that schema is not
   * fully published; callers must supply a definition built/verified
   * against the live KeeperHub dashboard or API response before use.
   */
  definition: Record<string, unknown>;
}

/**
 * GET /chains response item. LIVE-VERIFIED on 2026-08-29 by calling the
 * real KeeperHub API (Bearer kh_... auth) from a Railway-hosted deployment
 * of this service - see docs/keeperhub-integration.md for the full
 * request/response record. Response is a flat JSON array of these, no
 * envelope or pagination.
 */
export interface KeeperHubChain {
  id: string;
  chainId: number;
  name: string;
  symbol: string;
  // eslint-disable-next-line @typescript-eslint/ban-types -- `string & {}` is the standard TS idiom for "known literals, but any string is still allowed" (keeps autocomplete without narrowing the type)
  chainType: "evm" | "solana" | (string & {});
  explorerUrl: string;
  explorerAddressPath: string;
  explorerApiUrl: string;
  explorerApiType: string;
  isTestnet: boolean;
  isEnabled: boolean;
  usePrivateMempoolRpc: boolean;
}

/**
 * POST /execute/contract-call request body.
 *
 * LIVE-VERIFIED on 2026-08-30 for these cases only:
 * 1. A zero-argument, pure/view function (decimals() on Base's WETH9
 *    predeploy).
 * 2. A single-argument, pure/view function (balanceOf(address), same
 *    contract, queried against the zero address).
 * 3. A zero-argument, Safe-specific view function (getThreshold() on
 *    Safe's own canonical v1.4.1 singleton contract on Base).
 *
 * And confirmed NOT to work for:
 * 4. isValidSignature(bytes32,bytes) on that same Safe singleton -
 *    rejected with `{"error":"Function 'isValidSignature' not found in
 *    ABI","field":"functionName"}`. Since (3) succeeded on the identical
 *    contract address, this rules out "the address wasn't recognized" -
 *    KeeperHub resolves function calls against some internal, apparently
 *    per-contract-type ABI that is NOT the contract's full real ABI, and
 *    does not include every function real Safe contracts implement.
 *
 * Verified by iteratively probing KeeperHub's own validation/execution
 * errors (never by guessing) from a Railway-hosted deployment - see
 * docs/keeperhub-integration.md for the full round-by-round record and
 * the exact captured requests/responses.
 *
 * Confirmed required fields: contractAddress, chainId, functionName.
 * Confirmed for passing arguments: `functionArgs` - and this is the
 * counterintuitive part - MUST be a JSON-*stringified* array
 * (`JSON.stringify([...])`), not a native JSON array nested in the
 * request body. Sending a native array under `functionArgs` is silently
 * ignored (KeeperHub falls back to treating the call as zero-argument
 * and the underlying ethers.js Interface lookup then fails to match a
 * fragment); sending it under `args` is also silently ignored the same
 * way. Only the JSON-string-under-`functionArgs` form was accepted.
 *
 * `simulate` is accepted but had NO observable effect on any verified
 * call (same response with or without it) - its effect on a
 * state-changing call is UNVERIFIED.
 *
 * NOT verified and intentionally not modeled here:
 * - Argument encoding for a `bytes` (variable-length calldata) argument
 *   - untested, because isValidSignature (the case that would have
 *     tested it) failed at ABI resolution before argument encoding was
 *     ever exercised. Only a plain `address` value has been verified
 *     inside `functionArgs`.
 * - Whether the Zodiac Roles Modifier contract/interface is recognized
 *   at all - untested (explicitly out of scope for this round). Given
 *   that even isValidSignature (a real EIP-1271 standard function) isn't
 *   in whatever ABI KeeperHub uses for a recognized Safe contract, there
 *   is no basis to assume a Zodiac-specific function like
 *   execTransactionWithRole would be.
 * - `value` (sending native currency) - never sent, never required.
 * - Any field controlling which account/wallet executes the call.
 * - Idempotency-key behavior - no such header was sent or needed for
 *   this read-only call.
 * - The request/response shape for an actual state-changing call, or
 *   whether one goes through this same endpoint at all.
 *
 * Do not extend this type or the client method that uses it to support
 * a `bytes` argument or state-changing calls without live-verifying the
 * real behavior the same way - guessing here is exactly what this
 * project forbids.
 */
export interface ContractCallRequest {
  contractAddress: string;
  chainId: number;
  functionName: string;
  /**
   * A JSON-*stringified* array of argument values, e.g.
   * `JSON.stringify(["0x000...000"])`. Live-verified only for a single
   * `address`-typed argument passed as a hex string. Do not assume this
   * works for a `bytes` argument without live-verifying it the same way.
   */
  functionArgs?: string;
  simulate?: boolean;
}

/**
 * POST /execute/contract-call response body for the verified cases
 * above: a flat, synchronous result - no execution ID, no status field,
 * no envelope. Whether a state-changing call returns this same shape
 * (vs. an execution ID requiring polling) is UNVERIFIED.
 */
export interface ContractCallResult {
  result: string;
}

/**
 * POST /execute/contract-call pre-flight validation error shape,
 * live-verified across five separate responses on 2026-08-30. The API
 * reports exactly one missing/invalid field per response, distinct from
 * ContractCallExecutionError below.
 */
export interface ContractCallValidationError {
  error: string;
  field: string;
  details: string;
}

/**
 * POST /execute/contract-call execution-time error shape, live-verified
 * on 2026-08-30 by calling balanceOf with zero and then two arguments
 * (it takes exactly one). This is a DIFFERENT shape from
 * ContractCallValidationError: it fires after the request passes
 * pre-flight field validation, when KeeperHub's underlying ethers.js
 * Interface can't match a function fragment for the given name + args
 * (or, presumably, when the RPC call itself fails for another reason -
 * unverified). The literal message format ("no matching fragment",
 * "code=UNSUPPORTED_OPERATION", "Primary: ... Fallback: ...") is
 * ethers.js's own error format, confirming KeeperHub uses ethers.js
 * internally with primary+fallback RPC endpoints per chain.
 */
export interface ContractCallExecutionError {
  error: string;
}

/**
 * POST /execute/contract-call "function not recognized" error shape,
 * live-verified on 2026-08-30 by calling isValidSignature(bytes32,bytes)
 * on Safe's own v1.4.1 singleton contract - a contract KeeperHub DOES
 * otherwise recognize (getThreshold() on the identical address
 * succeeded in the same session). This is a THIRD distinct error shape,
 * different from both ContractCallValidationError (missing/invalid
 * top-level field) and ContractCallExecutionError (ethers.js fragment
 * mismatch after an argument-count/type error): it fires when
 * KeeperHub's internal, apparently per-contract-type ABI simply does not
 * define the requested function name at all, even for an
 * otherwise-recognized contract.
 */
export interface ContractCallFunctionNotFoundError {
  error: string;
  field: "functionName";
}

/**
 * POST /execute/contract-call response shape for `execTransactionWithRole`
 * calls specifically - a different, richer shape than the plain
 * ContractCallResult above. LIVE-VERIFIED twice this session: once against
 * a foreign Roles instance (docs/zodiac-verification-evidence.md, the
 * "NotAuthorized" round) and once against this project's own controlled
 * Roles Modifier (ConditionViolation(2,...) on a scoped-out target). Both
 * captures agree on this shape for a REVERTING simulated call.
 *
 * NOT verified: the exact shape for a simulated call that WOULD succeed
 * (wouldRevert: false), or for a real broadcast (simulate: false). Treat
 * `transactionHash` on a broadcast response as unconfirmed until it has
 * been independently validated as a real, minable 66-character hash - see
 * execution/executor.ts, which never trusts an unvalidated hash.
 */
export interface ExecTransactionWithRoleResult {
  success: boolean;
  status: string;
  from?: string;
  to?: string;
  value?: string;
  wouldRevert: boolean;
  failureKind?: string;
  revertReason?: string;
  error?: string;
  transactionHash?: string;
  /**
   * KeeperHub's own execution id for this write (e.g. `"direct_123"`),
   * present on a real broadcast response - live-verified 2026-08-31
   * (`docs/keeperhub-integration.md`, tx
   * 0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b:
   * `{status:"completed", executionId:"u9zr4vzbfurjvzgwz687g",
   * transactionHash, transactionLink}`). This is the id to persist as
   * `keeperhub_executions.keeperhub_execution_id` and poll via
   * `GET /api/execute/{executionId}/status` - see
   * KeeperHubClient.getDirectExecutionStatus.
   */
  executionId?: string;
  /**
   * Set to `true` only when this response is a replay of a previously
   * stored outcome for the same Idempotency-Key, per
   * https://docs.keeperhub.com/api/direct-execution#idempotency. Absent
   * (not `false`) on a fresh response - never assume its absence means
   * "false", only check for `=== true`. A replayed failure carries the
   * *original* error, so a caller that retried expecting a fresh attempt
   * must check this before concluding "still failing" - the retry itself
   * was never sent.
   */
  idempotentReplay?: boolean;
  [key: string]: unknown;
}

/**
 * `GET /api/execute/{executionId}/status` response body, per
 * https://docs.keeperhub.com/api/direct-execution#get-execution-status.
 * Not yet live-verified against a real polled execution by this project
 * (the one confirmed broadcast to date settled synchronously with a
 * verifiable hash on the initial response) - modeled directly from
 * KeeperHub's own documented shape rather than guessed. Treat `receipts`
 * as the authoritative source for whether an execution actually
 * succeeded on-chain; `transactionHash`/`transactionLink` are
 * self-reported by the write path per the same doc section.
 */
export interface DirectExecutionReceipt {
  hash: string;
  chainId: number;
  /** Whether this hash positively confirmed on-chain - re-fetched from the chain, not self-reported. */
  verified: boolean;
  /**
   * `success` | `reverted` | `safe_inner_failure` (outer tx succeeded, a
   * wrapped inner call failed) | `not_found` | `timeout`. The last two
   * mean verification could not reach a definitive answer within its
   * budget - documented to fail the execution closed rather than
   * optimistically settle it. Treat as an open string set, not a closed
   * enum - the docs explicitly warn future statuses may be added.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types -- known literals plus "any string" per docs' "treat as a lower bound" guidance
  receiptStatus: "success" | "reverted" | "safe_inner_failure" | "not_found" | "timeout" | (string & {});
  blockNumber?: number;
  /** Gas units used, read from the fetched receipt - not self-reported by the write path. */
  gasUsed?: string;
  verifiedAt?: string;
}

export interface DirectExecutionStatusResponse {
  executionId: string;
  /**
   * Documented values: `pending`, `running`, `unconfirmed` (broadcast,
   * receipt not yet conclusively read - non-terminal, keep polling),
   * `completed`, `failed`. Treat as a lower bound, not a closed set -
   * decide terminality from `X-Poll-Interval-Hint` (0 = terminal), not
   * from this string, per KeeperHub's own guidance.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types -- see receiptStatus above
  status: "pending" | "running" | "unconfirmed" | "completed" | "failed" | (string & {});
  type?: string;
  /** The chain identifier the original request supplied, stored verbatim as a string. */
  network?: string;
  transactionHash?: string;
  transactionLink?: string;
  /** True when gas-sponsored/relayer-broadcast - the tx won't appear against the org's own EOA. */
  sponsored?: boolean;
  retryCount?: number;
  /** One entry per transaction hash this execution claimed. Empty for read calls and simulations. */
  receipts: DirectExecutionReceipt[];
  gasUsedWei?: string;
  gasPriceWei?: string;
  estimatedCostUsd?: string | null;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  completedAt?: string;
  [key: string]: unknown;
}

/**
 * `POST /api/execute/*` 409 idempotency error body -
 * https://docs.keeperhub.com/api/direct-execution#idempotency. Two
 * distinct codes share this shape: `idempotency_conflict` (same key,
 * different request body - `retryable: false`, never rotate the key for
 * a retry of the same intent, see the doc's "A stable key does not by
 * itself produce a replay") and `idempotency_in_progress` (a duplicate
 * arrived while the first request is still running - `retryable: true`,
 * back off and re-send the *same* key).
 */
export interface IdempotencyErrorBody {
  error: string;
  code: "idempotency_conflict" | "idempotency_in_progress";
  retryable: boolean;
  /** Only present on `idempotency_conflict`, and nullable even then per the docs. */
  originalExecutionId?: string | null;
}
