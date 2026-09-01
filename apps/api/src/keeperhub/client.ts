import { env } from "../env";
import { logger } from "../logger";
import type {
  ContractCallRequest,
  ContractCallResult,
  CreateWorkflowRequest,
  DirectExecutionStatusResponse,
  IdempotencyErrorBody,
  KeeperHubChain,
  KeeperHubExecution,
  KeeperHubWorkflow,
} from "./types";

/**
 * Thrown when KeeperHub itself responded with a non-2xx status - i.e. the
 * request definitely reached KeeperHub and it definitely rejected it.
 * Distinct from a network/timeout failure (plain fetch throw, no HTTP
 * response at all), where whether KeeperHub received and acted on the
 * request is unknown. Callers that need to tell "confirmed rejection"
 * apart from "ambiguous, outcome unconfirmed" - see
 * execution/executor.ts and routes/executions.ts - must check
 * `instanceof KeeperHubApiError` rather than parsing the error message.
 */
export class KeeperHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`KeeperHub API error ${status}: ${body}`);
    this.name = "KeeperHubApiError";
  }
}

/**
 * A confirmed `409 idempotency_conflict` - the Idempotency-Key was reused
 * with a request body that hashes differently from the one it was first
 * bound to. Per https://docs.keeperhub.com/api/direct-execution#idempotency
 * this is `retryable: false` and must NEVER be handled by rotating to a
 * fresh key for what the caller believes is the same intent - that is
 * precisely the case that can double-broadcast. Callers should either
 * canonicalize the request to match the original (see the doc's "Choosing
 * a stable key"), or - if the work is genuinely different - deliberately
 * mint a new key for new work. `originalExecutionId` (nullable) is the
 * execution the key is actually bound to; poll its status instead of
 * guessing what happened.
 */
export class KeeperHubIdempotencyConflictError extends KeeperHubApiError {
  constructor(
    status: number,
    body: string,
    public readonly originalExecutionId: string | null,
  ) {
    super(status, body);
    this.name = "KeeperHubIdempotencyConflictError";
  }
}

/**
 * A confirmed `409 idempotency_in_progress` - a duplicate request arrived
 * while the original attempt under this key is still running.
 * `retryable: true`: the caller should back off and retry with the SAME
 * key, never rotate it (rotating escapes the in-progress guard and risks
 * a second broadcast for a request that may already be executing).
 */
export class KeeperHubIdempotencyInProgressError extends KeeperHubApiError {
  constructor(status: number, body: string) {
    super(status, body);
    this.name = "KeeperHubIdempotencyInProgressError";
  }
}

/**
 * Thin client for KeeperHub's REST API (https://docs.keeperhub.com/api).
 *
 * IMPORTANT - scope of what's implemented:
 * This client only wraps the generic workflow/execution endpoints that are
 * confirmed in KeeperHub's own documentation and public README:
 *   - POST   /workflows
 *   - GET    /workflows/:id
 *   - POST   /workflows/:id/execute
 *   - GET    /workflows/:id/executions
 *   - GET    /executions/:id
 *
 * `listChains()` (GET /chains) is LIVE-VERIFIED - a real request from a
 * Railway-hosted deployment of this service, with a real KeeperHub API
 * key, returned HTTP 200 and the chain list on 2026-08-29. Base
 * (chainId 8453) is present with isEnabled: true. Full request/response
 * record: docs/keeperhub-integration.md.
 *
 * `callContractFunction()` (POST /execute/contract-call) is LIVE-VERIFIED
 * on 2026-08-30 for a zero-argument, a single-address-argument, and a
 * Safe-specific zero-argument pure/view function call (the address-arg
 * case requires `functionArgs` to be a JSON-*stringified* array, a
 * genuinely counterintuitive encoding this session would never have
 * guessed). Also live-verified: KeeperHub resolves function calls
 * against some internal per-contract-type ABI that is NOT necessarily
 * the contract's full real ABI - isValidSignature(bytes32,bytes) FAILED
 * with "not found in ABI" on a Safe contract where getThreshold()
 * SUCCEEDED. See the ContractCallRequest doc comment in ./types.ts
 * before using this for anything else, especially a `bytes` argument, a
 * Zodiac contract, or a state-changing call.
 *
 * KeeperHub also advertises first-class Safe support (pending-transaction
 * monitoring, signature tracking, simulation) and an MCP server, but the
 * exact endpoint paths / MCP tool names / request-response shapes for the
 * Safe-specific flows are NOT yet live-verified - see
 * docs/keeperhub-integration.md.
 *
 * Rather than guessing at those shapes, the Safe-specific methods below are
 * intentionally left unimplemented. Wire them up once each contract has
 * been confirmed the same way listChains() was - do not fill them in from
 * assumption.
 *
 * `Idempotency-Key` support on `callContractFunction()` and
 * `getDirectExecutionStatus()` (GET /execute/:id/status) were added
 * directly from KeeperHub's own published Direct Execution API reference
 * (https://docs.keeperhub.com/api/direct-execution, captured 2026-09-01
 * - see docs/keeperhub-integration.md) rather than live experimentation,
 * since the documented request/response shapes and the previously
 * live-verified broadcast response (the real
 * 0xc8a00cc2...49fd8b tx, which already carried the `executionId` this
 * status endpoint expects) agree byte-for-byte. Both are exercised by
 * this project's Safe First-Write Sequence - see
 * execution/executor.ts and routes/executions.ts.
 */
export class KeeperHubClient {
  constructor(
    private readonly baseUrl: string = env.KEEPERHUB_API_BASE_URL,
    private readonly apiKey: string = env.KEEPERHUB_API_KEY,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ url, status: response.status, body }, "KeeperHub API request failed");
      throw new KeeperHubApiError(response.status, body);
    }

    return (await response.json()) as T;
  }

  createWorkflow(input: CreateWorkflowRequest): Promise<KeeperHubWorkflow> {
    return this.request<KeeperHubWorkflow>("/workflows", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getWorkflow(workflowId: string): Promise<KeeperHubWorkflow> {
    return this.request<KeeperHubWorkflow>(`/workflows/${workflowId}`);
  }

  /**
   * Triggers a direct execution of an existing workflow. Whether this
   * performs simulation-then-execution or execution only is defined by the
   * workflow's own configuration in KeeperHub, not by this client -
   * confirm the workflow's simulate/execute behavior in the KeeperHub
   * dashboard before relying on it.
   */
  executeWorkflow(workflowId: string, payload: Record<string, unknown> = {}): Promise<KeeperHubExecution> {
    return this.request<KeeperHubExecution>(`/workflows/${workflowId}/execute`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  listExecutions(workflowId: string): Promise<KeeperHubExecution[]> {
    return this.request<KeeperHubExecution[]>(`/workflows/${workflowId}/executions`);
  }

  getExecution(executionId: string): Promise<KeeperHubExecution> {
    return this.request<KeeperHubExecution>(`/executions/${executionId}`);
  }

  /** Live-verified 2026-08-29 - see class-level doc comment. */
  listChains(): Promise<KeeperHubChain[]> {
    return this.request<KeeperHubChain[]>("/chains");
  }

  async isChainSupported(chainId: number): Promise<boolean> {
    const chains = await this.listChains();
    return chains.some((chain) => chain.chainId === chainId && chain.isEnabled);
  }

  /**
   * Calls a contract function via POST /execute/contract-call.
   *
   * LIVE-VERIFIED 2026-08-30 for:
   * - A zero-argument, pure/view function (decimals() on Base's WETH9
   *   predeploy).
   * - A single-argument, pure/view function (balanceOf(address), same
   *   contract) - requires `functionArgs` to be a JSON-stringified array
   *   (`JSON.stringify([...])`), NOT a native array. Only an `address`
   *   argument has been verified this way.
   * - A zero-argument, Safe-specific view function (getThreshold() on
   *   Safe's canonical v1.4.1 singleton on Base).
   *
   * LIVE-VERIFIED to FAIL: isValidSignature(bytes32,bytes) on that same
   * Safe singleton, with `{"error":"Function 'isValidSignature' not
   * found in ABI","field":"functionName"}` - even though getThreshold()
   * succeeded on the identical contractAddress. This means KeeperHub's
   * function resolution is not "any function real bytecode has" - it's
   * bounded by some internal per-contract-type ABI that doesn't
   * necessarily match the contract's actual full ABI. There is no
   * evidence this extends to non-Safe, non-ERC20 contract types (e.g. a
   * Zodiac Roles Modifier) at all.
   *
   * See the ContractCallRequest doc comment and
   * docs/keeperhub-integration.md for the full round-by-round
   * verification record, including all captured error shapes.
   *
   * DO NOT call this with a `bytes`-typed argument, a Zodiac contract, or
   * a state-changing function: none of these has been verified, and
   * whether `simulate: true` actually prevents a real state-changing
   * broadcast is unverified (it had zero observable effect on any
   * read-only call tested). Using this beyond the confirmed cases would
   * be exactly the kind of unverified execution this project forbids.
   *
   * HTTP 400 handling: KeeperHub uses HTTP 400 for two genuinely different
   * things (verified in docs/zodiac-verification-evidence.md) - a
   * pre-flight validation error (missing/invalid field, function not
   * found in its ABI), and "the simulated call would revert" for
   * execTransactionWithRole, which is a normal, informative result
   * (`{success:false, wouldRevert:true, revertReason:"..."}`), not a
   * request failure. Only the shape without `wouldRevert` is a real
   * error and still throws; a `wouldRevert`-shaped 400 body is returned
   * as data so callers (see execution/executor.ts) can tell "the
   * permission doesn't allow this yet" apart from "KeeperHub is down."
   *
   * `options.idempotencyKey`, when supplied, is sent as the
   * `Idempotency-Key` header per
   * https://docs.keeperhub.com/api/direct-execution#idempotency. Per the
   * docs, "Read-only and dry-run (simulate: true) requests are not
   * affected" - callers should only supply this for a real broadcast
   * (`simulate: false`), not for a simulation, and the key must identify
   * the *work* (stable across a retry of the same attempt), never a
   * fresh value minted per HTTP call - see execution/executor.ts, which
   * sources it from the execution row's own `idempotencyKey` column
   * rather than generating one here.
   *
   * A `409` response is parsed into one of two typed errors rather than
   * the generic `KeeperHubApiError` when its body carries a recognized
   * idempotency `code` - see `KeeperHubIdempotencyConflictError` /
   * `KeeperHubIdempotencyInProgressError`. Any other non-2xx (including a
   * `409` without that shape) still throws the plain `KeeperHubApiError`.
   */
  async callContractFunction(
    request: ContractCallRequest,
    options: { idempotencyKey?: string } = {},
  ): Promise<ContractCallResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/execute/contract-call`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(request),
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      if (response.status === 409 && body !== null && typeof body === "object" && "code" in body) {
        const idempotencyBody = body as IdempotencyErrorBody;
        if (idempotencyBody.code === "idempotency_conflict") {
          throw new KeeperHubIdempotencyConflictError(
            response.status,
            text,
            idempotencyBody.originalExecutionId ?? null,
          );
        }
        if (idempotencyBody.code === "idempotency_in_progress") {
          throw new KeeperHubIdempotencyInProgressError(response.status, text);
        }
      }

      const isSimulatedRevertResult =
        response.status === 400 && body !== null && typeof body === "object" && "wouldRevert" in body;
      if (!isSimulatedRevertResult) {
        logger.error({ url, status: response.status, body: text }, "KeeperHub API request failed");
        throw new KeeperHubApiError(response.status, text);
      }
    }

    return body as ContractCallResult;
  }

  /**
   * `GET /api/execute/{executionId}/status` -
   * https://docs.keeperhub.com/api/direct-execution#get-execution-status.
   * Returns the parsed status body alongside the `X-Poll-Interval-Hint`
   * response header (seconds to wait before the next poll; `0` means the
   * execution reached a terminal state - `completed` or `failed`). Per
   * the docs, decide terminality from this header, not by string-
   * matching `status` - see execution/executor.ts's poll loop, which
   * treats an unrecognized/unhinted status as still non-terminal rather
   * than guessing.
   *
   * NOT yet live-verified against a real polled execution (see the doc
   * comment on `DirectExecutionStatusResponse`) - modeled directly from
   * KeeperHub's documented shape, not guessed.
   */
  async getDirectExecutionStatus(
    executionId: string,
  ): Promise<{ status: DirectExecutionStatusResponse; pollIntervalHintSeconds: number | null }> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/execute/${encodeURIComponent(executionId)}/status`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      logger.error({ url, status: response.status, body: text }, "KeeperHub API request failed");
      throw new KeeperHubApiError(response.status, text);
    }

    const hintHeader = response.headers.get("x-poll-interval-hint");
    const parsedHint = hintHeader !== null && hintHeader !== "" ? Number(hintHeader) : null;

    return {
      status: body as DirectExecutionStatusResponse,
      pollIntervalHintSeconds: parsedHint !== null && Number.isFinite(parsedHint) ? parsedHint : null,
    };
  }

  /**
   * Performs a raw, unauthenticated-response-shape-agnostic GET against the
   * KeeperHub API and returns status + response headers + parsed body
   * verbatim, without throwing on non-2xx. Not intended for application
   * logic - prefer the typed methods above once a shape is confirmed.
   *
   * Never logs or returns the request Authorization header.
   */
  async rawGet(path: string): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Response wasn't JSON - return the raw text so nothing is hidden.
    }

    return { status: response.status, headers, body };
  }

  /**
   * NOT IMPLEMENTED: Safe transaction simulation via KeeperHub.
   * KeeperHub's marketing/docs surface mentions Safe transaction
   * preparation and simulation, but no confirmed endpoint path or payload
   * shape was available to this session. Implement only after verifying
   * the real contract (dashboard network trace, authenticated MCP call, or
   * direct doc confirmation), and update docs/keeperhub-integration.md
   * with the source.
   */
  simulateSafeTransaction(..._args: never[]): never {
    throw new Error(
      "KeeperHubClient.simulateSafeTransaction is not implemented - the Safe simulation " +
        "endpoint has not been verified against KeeperHub's API. See docs/keeperhub-integration.md.",
    );
  }
}

export const keeperHubClient = new KeeperHubClient();
