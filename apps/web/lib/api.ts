import { clientEnv } from "./env";

let authToken: string | null = null;
export function setAuthToken(token: string | null) { authToken = token; }
const REQUEST_TIMEOUT_MS = 15_000;
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try { response = await fetch(`${clientEnv.NEXT_PUBLIC_API_URL}${path}`, { ...init, signal: controller.signal, headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...init?.headers } }); }
  catch (err) { if ((err as Error).name === "AbortError") throw new Error("Request timed out. Check your connection and try again."); throw new Error("Could not reach the server. Check your connection and try again."); }
  finally { clearTimeout(timeout); }
  const body = await response.json().catch(() => null); if (!response.ok) throw new Error((body && (body.message || body.error)) || `Request failed (${response.status})`); return body as T;
}

export const api = {
  authNonce: (address: string) => request<{ nonce: string; message: string; expiresAt: string }>("/api/auth/nonce", { method: "POST", body: JSON.stringify({ address }) }),
  authVerify: (address: string, signature: string) => request<{ token: string; address: string; expiresAt: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ address, signature }) }),
  authDemoSession: () => request<{ token: string; address: string; expiresAt: string }>("/api/auth/demo-session", { method: "POST" }),
  authSignup: (username: string, password: string) => request<{ token: string; address: string; expiresAt: string }>("/api/auth/signup", { method: "POST", body: JSON.stringify({ username, password }) }),
  authLogin: (username: string, password: string) => request<{ token: string; address: string; expiresAt: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  createSafeAccount: (input: unknown) => request("/api/safe-accounts", { method: "POST", body: JSON.stringify(input) }),
  listMySafeAccounts: () => request<any[]>("/api/safe-accounts"),
  getSafeAccount: (id: string) => request(`/api/safe-accounts/${id}`),
  getSafeBalances: (id: string) => request(`/api/safe-accounts/${id}/balances`),
  getSafeAuthorization: (id: string) => request<any>(`/api/safe-accounts/${id}/authorization`),
  prepareSafeAuthorization: (id: string) => request<any>(`/api/safe-accounts/${id}/authorization/prepare`, { method: "POST", body: JSON.stringify({}) }),
  buildSafeAuthorizationExecution: (id: string, input: { stepId: string; safeTxHash: string; signature: string }) => request<{ to: string; value: string; data: string; safeTxHash: string }>(`/api/safe-accounts/${id}/authorization/execute-calldata`, { method: "POST", body: JSON.stringify(input) }),
  listStrategies: (safeId?: string) => request<any[]>(`/api/exit-strategies${safeId ? `?safeId=${encodeURIComponent(safeId)}` : ""}`),
  getStrategy: (id: string) => request<any>(`/api/exit-strategies/${id}`),
  createStrategy: (input: unknown) => request("/api/exit-strategies", { method: "POST", body: JSON.stringify(input) }),
  previewStrategy: (id: string) => request<any>(`/api/exit-strategies/${id}/preview`),
  activateStrategy: (id: string) => request(`/api/exit-strategies/${id}/activate`, { method: "POST" }),
  pauseStrategy: (id: string) => request(`/api/exit-strategies/${id}/pause`, { method: "POST" }),
  listExecutions: (strategyId: string) => request<any[]>(`/api/exit-strategies/${strategyId}/executions`),
  createExecution: (strategyId: string, currentRateBps: number) => request(`/api/exit-strategies/${strategyId}/executions`, { method: "POST", body: JSON.stringify({ currentRateBps }) }),
  simulateExecution: (strategyId: string, executionId: string) => request(`/api/exit-strategies/${strategyId}/executions/${executionId}/simulate`, { method: "POST" }),
  broadcastExecution: (strategyId: string, executionId: string) => request(`/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`, { method: "POST" }),
  refreshExecutionStatus: (strategyId: string, executionId: string) => request(`/api/exit-strategies/${strategyId}/executions/${executionId}/refresh-status`, { method: "POST" }),
  evaluateAgent: (strategyId: string) => request<any>(`/api/exit-strategies/${strategyId}/agent/evaluate`, { method: "POST" }),
  listAgentDecisions: (strategyId: string) => request<any[]>(`/api/exit-strategies/${strategyId}/agent/decisions`),
  getAgentReceipt: (decisionId: string) => request<any>(`/api/agent/decisions/${decisionId}`),
};