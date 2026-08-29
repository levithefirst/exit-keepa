import { env } from "../env";
import { logger } from "../logger";
import type { CreateWorkflowRequest, KeeperHubChain, KeeperHubExecution, KeeperHubWorkflow } from "./types";

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
 * KeeperHub also advertises first-class Safe support (pending-transaction
 * monitoring, signature tracking, simulation) and an MCP server, but the
 * exact endpoint paths / MCP tool names / request-response shapes for the
 * Safe-specific flows, and for POST /execute/contract-call, are NOT yet
 * live-verified - see docs/keeperhub-integration.md.
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
