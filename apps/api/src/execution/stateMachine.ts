/**
 * Pure execution-state decision logic, factored out of routes/executions.ts
 * so the "never broadcast twice" / "never broadcast before a successful
 * simulation" rules are directly unit-testable without a database.
 *
 * keeperhub_executions.status values: pending -> simulating -> simulated ->
 * executing -> succeeded | failed | cancelled.
 */

export type ExecutionStatus =
  | "pending"
  | "simulating"
  | "simulated"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ExecutionSnapshot {
  status: ExecutionStatus;
  txHash: string | null;
}

export type BroadcastDecision =
  | { action: "already_broadcast" }
  | { action: "reject"; reason: string }
  | { action: "proceed" };

/**
 * Decides what a broadcast request should do given the execution's current
 * state. This is the single source of truth the route enforces (via a
 * conditional UPDATE ... WHERE status = 'simulated' to make the "proceed"
 * case race-safe against concurrent requests) - a successful broadcast
 * must never be attempted again just because a caller retried after a
 * timeout.
 */
export function decideBroadcast(execution: ExecutionSnapshot): BroadcastDecision {
  if (execution.txHash || execution.status === "succeeded") {
    return { action: "already_broadcast" };
  }
  if (execution.status !== "simulated") {
    return {
      action: "reject",
      reason: `Execution is ${execution.status} - can only broadcast an execution that has just been successfully simulated`,
    };
  }
  return { action: "proceed" };
}
