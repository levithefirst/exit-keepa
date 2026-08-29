/**
 * Domain types shared between apps/api and apps/web.
 *
 * These model the "Ratehopper Auto-Exit" concept: a Safe holds a position
 * (e.g. a lending/borrow position), and an ExitStrategy defines a rate
 * condition under which the position should be unwound automatically.
 * Execution of the unwind is delegated to KeeperHub, which calls into the
 * Safe through a Zodiac Roles Modifier scoped to the exact calls required
 * (see docs/keeperhub-integration.md for the verified integration details).
 */

export type ChainId = number;

export interface SafeAccount {
  id: string;
  chainId: ChainId;
  safeAddress: string;
  /** Address of the Zodiac Roles Modifier enabled on this Safe, if any. */
  rolesModifierAddress: string | null;
  createdAt: string;
}

export type ExitStrategyStatus = "draft" | "active" | "paused" | "archived";

export interface ExitStrategy {
  id: string;
  safeId: string;
  name: string;
  status: ExitStrategyStatus;
  /** Human-readable description of the rate condition, e.g. "borrow APR > 8%". */
  condition: RateCondition;
  /** KeeperHub workflow backing this strategy, once created. */
  keeperhubWorkflowId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RateComparator = "gt" | "gte" | "lt" | "lte";

export interface RateCondition {
  /** Protocol/market being monitored, e.g. "aave-v3-base". */
  market: string;
  metric: "borrow_apr" | "supply_apr" | "utilization";
  comparator: RateComparator;
  /** Threshold expressed in basis points. */
  thresholdBps: number;
}

export type KeeperHubExecutionStatus =
  | "pending"
  | "simulating"
  | "simulated"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AuditEvent {
  id: string;
  entityType: "safe" | "exit_strategy" | "keeperhub_workflow" | "keeperhub_execution";
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}
