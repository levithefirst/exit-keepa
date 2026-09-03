/**
 * Exit Keepa design system tokens as Tailwind class strings. Not a
 * component library — just shared, composable class strings so every
 * screen renders buttons/inputs/status the same way instead of each
 * page inventing its own variant.
 */

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium " +
  "transition-transform active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950 " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

/** The one accent-colored action per view — reserve for the primary CTA. */
export const btnPrimary = `${btnBase} bg-mint-400 text-ink-on-accent hover:bg-mint-300 focus-visible:ring-mint-400/70`;

/** Neutral — for secondary/alternate actions so they never compete with the primary CTA. */
export const btnSecondary = `${btnBase} border border-cream-100/20 text-cream-100 hover:border-cream-100/40 focus-visible:ring-cream-100/40`;

/** Ghost — for the lowest-emphasis action in a group (e.g. nav "Try demo"). */
export const btnGhost = `${btnBase} text-cream-300 hover:text-cream-50 focus-visible:ring-cream-100/40`;

/** Compact variant (execution-history row actions) that still meets the 44px target height. */
export const btnPrimarySmall = `${btnPrimary} px-3`;
export const btnSecondarySmall = `${btnSecondary} px-3`;

/** Destructive-toned confirm step for the one truly irreversible action (broadcast). */
export const btnDanger = `${btnBase} border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 focus-visible:ring-danger/60`;

export const linkFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100/40 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950 rounded";

export const inputBase =
  "min-h-11 w-full rounded-lg border border-cream-100/20 bg-forest-900/60 px-3 py-2 text-sm text-cream-100 placeholder:text-cream-400 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950";

/** Standard card surface — layered forest, subtle cream border. */
export const card = "rounded-xl border border-cream-100/10 bg-forest-800/60 p-5";
export const cardHover = `${card} transition-colors hover:border-mint-400/30`;

/**
 * Status label + tone in one place so "active"/"succeeded"/"failed"/etc.
 * always show as real words (never color-only) with a small dot for
 * quick scanning alongside the text. The chain, not this map, is the
 * source of truth for "confirmed" — this only controls how a known
 * status renders.
 */
export const STATUS_META: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  draft: { label: "Draft", dot: "bg-cream-400", text: "text-cream-300", bg: "bg-cream-100/10" },
  active: { label: "Active", dot: "bg-mint-400", text: "text-mint-300", bg: "bg-mint-400/15" },
  paused: { label: "Paused", dot: "bg-warning", text: "text-warning", bg: "bg-warning/10" },
  archived: { label: "Archived", dot: "bg-cream-400", text: "text-cream-400", bg: "bg-cream-100/10" },
  pending: { label: "Pending", dot: "bg-cream-400", text: "text-cream-300", bg: "bg-cream-100/10" },
  simulating: { label: "Simulating…", dot: "bg-info animate-pulse", text: "text-info", bg: "bg-info/10" },
  simulated: { label: "Simulated, not sent", dot: "bg-info", text: "text-info", bg: "bg-info/10" },
  executing: { label: "Broadcasting…", dot: "bg-warning animate-pulse", text: "text-warning", bg: "bg-warning/10" },
  succeeded: { label: "Confirmed onchain", dot: "bg-mint-400", text: "text-mint-300", bg: "bg-mint-400/15" },
  failed: { label: "Failed", dot: "bg-danger", text: "text-danger", bg: "bg-danger/15" },
  refused: { label: "Refused by policy", dot: "bg-danger", text: "text-danger", bg: "bg-danger/15" },
  blocked: { label: "Blocked before broadcast", dot: "bg-warning", text: "text-warning", bg: "bg-warning/10" },
  // Deliberately NOT worded like a success: the lifecycle ran, nothing
  // reached a chain, and there is no transaction hash. See
  // apps/api/src/execution/executeApproved.ts.
  demo_completed: { label: "Demo completed (no chain)", dot: "bg-mint-400", text: "text-mint-300", bg: "bg-mint-400/15" },
  cancelled: { label: "Cancelled", dot: "bg-cream-400", text: "text-cream-400", bg: "bg-cream-100/10" },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, dot: "bg-cream-400", text: "text-cream-300", bg: "bg-cream-100/10" };
}
