import type { ExitStrategyStatus, KeeperHubExecutionStatus } from "@exit-keepa/shared";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

interface StatusMeta {
  label: string;
  tone: Tone;
  /** True while the state represents work in progress (drives a pulsing dot). */
  pending?: boolean;
}

/**
 * Single source of truth for what a strategy status means in the UI. Every
 * screen that shows strategy status must go through this map — the goal is
 * that "active" never looks different on the dashboard than it does on the
 * strategy detail page.
 */
export const STRATEGY_STATUS: Record<ExitStrategyStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active — monitoring", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

/**
 * Single source of truth for what an execution status means. The gap this
 * closes: "simulated" and "succeeded" look nothing alike here on purpose —
 * a simulation is a preview, a success is money that actually moved.
 */
export const EXECUTION_STATUS: Record<KeeperHubExecutionStatus, StatusMeta> = {
  pending: { label: "Pending — not yet simulated", tone: "neutral" },
  simulating: { label: "Simulating…", tone: "info", pending: true },
  simulated: { label: "Simulated — ready to execute", tone: "info" },
  executing: { label: "Broadcasting…", tone: "info", pending: true },
  succeeded: { label: "Executed on-chain", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const TONE_CLASSES: Record<Tone, { bg: string; text: string; dot: string }> = {
  neutral: { bg: "bg-white/10", text: "text-gray-300", dot: "bg-gray-400" },
  success: { bg: "bg-accent-soft", text: "text-accent", dot: "bg-accent" },
  warning: { bg: "bg-warning-soft", text: "text-warning", dot: "bg-warning" },
  danger: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger" },
  info: { bg: "bg-info-soft", text: "text-info", dot: "bg-info" },
};
