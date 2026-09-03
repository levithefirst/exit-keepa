/**
 * Pure execution-state decision logic, factored out of routes/executions.ts
 * so the "never broadcast twice" / "never broadcast before a successful
 * simulation" rules are directly unit-testable without a database.
 *
 * keeperhub_executions.status values: pending -> simulating -> simulated ->
 * executing -> succeeded | failed | cancelled. Two rows created directly by
 * Exit Guardian (agent/guardian.ts) never enter this chain at all: `refused`
 * (a policy/permission check said no before ever reaching KeeperHub) is a
 * terminal status created straight from nothing, and a `simulated` row can
 * be stopped short of `executing` into `blocked` (see decideBroadcast's
 * staleness/amount checks) instead of proceeding to a real broadcast.
 * `demo_completed` is the terminal state a demo sandbox Safe's execution
 * reaches instead of `succeeded` - the same lifecycle, nothing broadcast,
 * never a tx hash (see execution/executeApproved.ts).
 */

export type ExecutionStatus =
  | "pending"
  | "simulating"
  | "simulated"
  | "executing"
  | "succeeded"
  | "failed"
  | "refused"
  | "blocked"
  | "demo_completed"
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
