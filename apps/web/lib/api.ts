import { clientEnv } from "./env";

// Set by lib/wallet.tsx once a sign-in (or demo-session) completes.
// Module-level rather than passed through every call site so every page's
// existing api.* calls stay untouched by the auth rollout - this is the
// one place that knows "who is calling right now."
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

// A stalled network request (a dropped mobile connection, a proxy that never
// answers) must never leave the UI waiting forever - every call fails clean
// after this, so a caller's try/finally always gets to run and re-enable
// whatever button was disabled for it.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${clientEnv.NEXT_PUBLIC_API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw new Error("Could not reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body && (body.message || body.error)) || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  // Sign-in: request a nonce, sign it with the wallet, exchange the
  // signature for a session token - see lib/wallet.tsx for the full flow.
  authNonce: (address: string) =>
    request<{ nonce: string; message: string; expiresAt: string }>("/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ address }),
    }),
  authVerify: (address: string, signature: string) =>
    request<{ token: string; address: string; expiresAt: string }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address, signature }),
    }),
  authDemoSession: () =>
    request<{ token: string; address: string; expiresAt: string }>("/api/auth/demo-session", { method: "POST" }),
  authSignup: (username: string, password: string) =>
    request<{ token: string; address: string; expiresAt: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  authLogin: (username: string, password: string) =>
    request<{ token: string; address: string; expiresAt: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  createSafeAccount: (input: unknown) => request("/api/safe-accounts", { method: "POST", body: JSON.stringify(input) }),
  listMySafeAccounts: () => request<any[]>("/api/safe-accounts"),
  getSafeAccount: (id: string) => request(`/api/safe-accounts/${id}`),
  getSafeBalances: (id: string) => request(`/api/safe-accounts/${id}/balances`),
  // Can Exit Keepa execute this Safe's exit yet, and if not what's left?
  // Answered from chain state plus a dry run of the real transaction - see
  // apps/api/src/safe/authorizationStatus.ts. This is what onboarding
  // renders from; the UI never decides authorization for itself.
  getSafeAuthorization: (id: string) => request<any>(`/api/safe-accounts/${id}/authorization`),

  listStrategies: (safeId?: string) =>
    request<any[]>(`/api/exit-strategies${safeId ? `?safeId=${encodeURIComponent(safeId)}` : ""}`),
  getStrategy: (id: string) => request<any>(`/api/exit-strategies/${id}`),
  createStrategy: (input: unknown) => request("/api/exit-strategies", { method: "POST", body: JSON.stringify(input) }),
  previewStrategy: (id: string) => request<any>(`/api/exit-strategies/${id}/preview`),
  activateStrategy: (id: string) => request(`/api/exit-strategies/${id}/activate`, { method: "POST" }),
  pauseStrategy: (id: string) => request(`/api/exit-strategies/${id}/pause`, { method: "POST" }),

  listExecutions: (strategyId: string) => request<any[]>(`/api/exit-strategies/${strategyId}/executions`),
  createExecution: (strategyId: string, currentRateBps: number) =>
    request(`/api/exit-strategies/${strategyId}/executions`, {
      method: "POST",
      body: JSON.stringify({ currentRateBps }),
    }),
  simulateExecution: (strategyId: string, executionId: string) =>
    request(`/api/exit-strategies/${strategyId}/executions/${executionId}/simulate`, { method: "POST" }),
  broadcastExecution: (strategyId: string, executionId: string) =>
    request(`/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`, { method: "POST" }),
  // Re-checks KeeperHub's GET /api/execute/{executionId}/status directly
  // (the Safe First-Write Sequence's status step) for an execution left
  // non-terminal after broadcast - a bounded inline poll already runs
  // during broadcast itself; this lets the UI continue checking without
  // re-broadcasting.
  refreshExecutionStatus: (strategyId: string, executionId: string) =>
    request(`/api/exit-strategies/${strategyId}/executions/${executionId}/refresh-status`, { method: "POST" }),

  // Exit Guardian: the autonomous decision layer. evaluateAgent runs the
  // same observe -> decide -> (refuse | approve+simulate) path the
  // background poller runs on its own interval - this is an on-demand,
  // same-code-path check, not a separate/fake "demo" action.
  evaluateAgent: (strategyId: string) =>
    request<any>(`/api/exit-strategies/${strategyId}/agent/evaluate`, { method: "POST" }),
  listAgentDecisions: (strategyId: string) => request<any[]>(`/api/exit-strategies/${strategyId}/agent/decisions`),
  getAgentReceipt: (decisionId: string) => request<any>(`/api/agent/decisions/${decisionId}`),
};
