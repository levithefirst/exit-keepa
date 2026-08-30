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
 * LIVE-VERIFIED on 2026-08-30 for two cases only:
 * 1. A zero-argument, pure/view function (decimals() on Base's WETH9
 *    predeploy).
 * 2. A single-argument, pure/view function (balanceOf(address), same
 *    contract, queried against the zero address).
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
 * `simulate` is accepted but had NO observable effect on either verified
 * call (same response with or without it) - its effect on a
 * state-changing call is UNVERIFIED.
 *
 * NOT verified and intentionally not modeled here:
 * - Argument encoding for non-address, non-fixed-size types - in
 *   particular a `bytes` (variable-length calldata) argument, which the
 *   Zodiac Roles Modifier's execTransactionWithRole would require. Only
 *   a plain `address` value has been verified inside `functionArgs`.
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
