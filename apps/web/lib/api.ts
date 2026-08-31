import { clientEnv } from "./env";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${clientEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body && (body.message || body.error)) || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  createSafeAccount: (input: unknown) => request("/api/safe-accounts", { method: "POST", body: JSON.stringify(input) }),
  getSafeAccount: (id: string) => request(`/api/safe-accounts/${id}`),
  getSafeBalances: (id: string) => request(`/api/safe-accounts/${id}/balances`),

  listStrategies: (safeId?: string) =>
    request<any[]>(`/api/exit-strategies${safeId ? `?safeId=${encodeURIComponent(safeId)}` : ""}`),
  getStrategy: (id: string) => request<any>(`/api/exit-strategies/${id}`),
  createStrategy: (input: unknown) => request("/api/exit-strategies", { method: "POST", body: JSON.stringify(input) }),
  previewStrategy: (id: string) => request<any>(`/api/exit-strategies/${id}/preview`),
  activateStrategy: (id: string) => request(`/api/exit-strategies/${id}/activate`, { method: "POST" }),
  pauseStrategy: (id: string) => request(`/api/exit-strategies/${id}/pause`, { method: "POST" }),

  evaluateAgent: (strategyId: string) =>
    request<any>(`/api/exit-strategies/${strategyId}/agent/evaluate`, { method: "POST" }),
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
};
