/**
 * Small shared class strings / status metadata so the playbook rules
 * (44px touch targets, focus-visible rings, press feedback, consistent
 * status wording) are applied the same way everywhere instead of
 * hand-rolled per screen. Intentionally not a component library — just
 * Tailwind utility strings composed with the project's existing tokens.
 */

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded px-4 text-sm font-medium " +
  "transition-transform active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

/** The one accent-colored action per view — reserve for the primary CTA. */
export const btnPrimary = `${btnBase} bg-accent text-black focus-visible:ring-accent/70`;

/** Neutral — for secondary/alternate actions so they never compete with the primary CTA. */
export const btnSecondary = `${btnBase} border border-white/20 text-gray-200 focus-visible:ring-white/40`;

/** Compact variant (execution-history row actions) that still meets the 44px target height. */
export const btnPrimarySmall = `${btnPrimary} px-3`;
export const btnSecondarySmall = `${btnSecondary} px-3`;

/** Destructive-toned confirm step for the one truly irreversible action (broadcast). */
export const btnDanger = `${btnBase} border border-red-500/40 bg-red-500/10 text-red-300 focus-visible:ring-red-500/60`;

export const linkFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-ink rounded";

export const inputBase =
  "min-h-11 w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

/**
 * Status label + tone in one place so "active"/"succeeded"/"failed"/etc.
 * always show as real words (never color-only) with a small dot for
 * quick scanning alongside the text.
 */
export const STATUS_META: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  draft: { label: "Draft", dot: "bg-gray-400", text: "text-gray-300", bg: "bg-white/10" },
  active: { label: "Active", dot: "bg-accent", text: "text-accent", bg: "bg-accent/20" },
  paused: { label: "Paused", dot: "bg-yellow-400", text: "text-yellow-300", bg: "bg-yellow-500/10" },
  archived: { label: "Archived", dot: "bg-gray-500", text: "text-gray-400", bg: "bg-white/10" },
  pending: { label: "Pending", dot: "bg-gray-400", text: "text-gray-300", bg: "bg-white/10" },
  simulating: { label: "Simulating", dot: "bg-blue-400", text: "text-blue-300", bg: "bg-blue-500/10" },
  simulated: { label: "Simulated", dot: "bg-blue-400", text: "text-blue-300", bg: "bg-blue-500/10" },
  executing: { label: "Broadcasting", dot: "bg-yellow-400", text: "text-yellow-300", bg: "bg-yellow-500/10" },
  succeeded: { label: "Succeeded", dot: "bg-accent", text: "text-accent", bg: "bg-accent/20" },
  failed: { label: "Failed", dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/20" },
  cancelled: { label: "Cancelled", dot: "bg-gray-500", text: "text-gray-400", bg: "bg-white/10" },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, dot: "bg-gray-400", text: "text-gray-300", bg: "bg-white/10" };
}
