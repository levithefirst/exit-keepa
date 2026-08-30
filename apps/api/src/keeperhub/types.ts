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
 * LIVE-VERIFIED on 2026-08-30, but ONLY for this exact case: a
 * zero-argument, pure/view function (decimals() on Base's WETH9
 * predeploy). Verified by iteratively probing KeeperHub's own field-by-
 * field validation errors (never by guessing), from a Railway-hosted
 * deployment - see docs/keeperhub-integration.md for the full
 * round-by-round record and the exact captured requests/responses.
 *
 * Confirmed required fields: contractAddress, chainId, functionName.
 * `simulate` is accepted but had NO observable effect on this call (same
 * response with or without it) - its effect on a state-changing call is
 * UNVERIFIED.
 *
 * NOT verified and intentionally not modeled here:
 * - How to pass arguments to a function that takes any (no `args`/
 *   `params`/similar field name has been confirmed).
 * - `value` (sending native currency) - never sent, never required.
 * - Any field controlling which account/wallet executes the call.
 * - Idempotency-key behavior - no such header was sent or needed for
 *   this read-only call.
 * - The request/response shape for an actual state-changing call, or
 *   whether one goes through this same endpoint at all.
 *
 * Do not extend this type or the client method that uses it to support
 * arguments or state-changing calls without live-verifying the real
 * field names the same way - guessing here is exactly what this project
 * forbids.
 */
export interface ContractCallRequest {
  contractAddress: string;
  chainId: number;
  functionName: string;
  simulate?: boolean;
}

/**
 * POST /execute/contract-call response body for the verified case above:
 * a flat, synchronous result - no execution ID, no status field, no
 * envelope. Whether a state-changing call returns this same shape (vs.
 * an execution ID requiring polling) is UNVERIFIED.
 */
export interface ContractCallResult {
  result: string;
}

/**
 * POST /execute/contract-call validation error shape, live-verified
 * across four separate missing-field responses on 2026-08-30. The API
 * reports exactly one missing/invalid field per response.
 */
export interface ContractCallValidationError {
  error: string;
  field: string;
  details: string;
}
