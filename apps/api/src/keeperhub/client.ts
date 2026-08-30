import { env } from "../env";
import { logger } from "../logger";
import type {
  ContractCallRequest,
  ContractCallResult,
  CreateWorkflowRequest,
  KeeperHubChain,
  KeeperHubExecution,
  KeeperHubWorkflow,
} from "./types";

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
 * on 2026-08-30 for a zero-argument AND a single-address-argument
 * pure/view function call (the latter requires `functionArgs` to be a
 * JSON-*stringified* array, a genuinely counterintuitive encoding this
 * session would never have guessed) - see the ContractCallRequest doc
 * comment in ./types.ts before using it for anything else, especially a
 * `bytes` argument or a state-changing call.
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
      throw new Error(`KeeperHub API error ${response.status}: ${body}`);
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
   *
   * See the ContractCallRequest doc comment and
   * docs/keeperhub-integration.md for the full round-by-round
   * verification record, including the exact error shapes for missing
   * fields and for malformed/mismatched arguments.
   *
   * DO NOT call this with a `bytes`-typed argument or a state-changing
   * function: neither has been verified, and whether `simulate: true`
   * actually prevents a real state-changing broadcast is unverified (it
   * had zero observable effect on either read-only call tested). Using
   * this beyond the two confirmed cases would be exactly the kind of
   * unverified execution this project forbids.
   */
  callContractFunction(request: ContractCallRequest): Promise<ContractCallResult> {
    return this.request<ContractCallResult>("/execute/contract-call", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Performs a raw, unauthenticated-response-shape-agnostic GET against the
   * KeeperHub API and returns status + response headers + parsed body
   * verbatim, without throwing on non-2xx. Used exclusively by the
   * temporary diagnostics route (see routes/diagnostics.ts) to capture and
   * verify real API behavior - not intended for application logic, which
   * should use the typed methods above once their shapes are confirmed.
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
