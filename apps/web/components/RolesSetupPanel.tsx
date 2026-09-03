"use client";

import { useState } from "react";
import { btnSecondarySmall } from "../lib/ui";

export interface RolesPermissionSpec {
  roleKey: string;
  target: string;
  targetLabel: string;
  selector: string;
  functionSignature: string;
  conditions: Array<{ param: string; type: string; rule: string }>;
  executionOptions: string;
  safeAppUrl: string;
  note: string;
  needsModifier: boolean;
  /** True for a demo session's own private sandbox Safe. This panel never shows
   * setup steps or a live safe.global link when true, regardless of `ready`. */
  isSandbox: boolean;
}

/**
 * The one-time real-Safe setup step Exit Keepa can't skip: KeeperHub only
 * ever executes through a Roles permission the Safe's own owners granted
 * themselves, in the Safe's own signing flow - there's no code path here
 * that submits it for them (see apps/api/src/execution/rolesPermission.ts).
 * What this panel controls is entirely presentation: a guided checklist
 * instead of a warning dead-end, framed by whether the strategy is already
 * executable (`ready`) or still blocked on this permission.
 */
export function RolesSetupPanel({
  spec,
  ready,
  onRecheck,
}: {
  spec: RolesPermissionSpec;
  ready: boolean;
  onRecheck?: () => Promise<void> | void;
}) {
  const [rechecking, setRechecking] = useState(false);

  // A sandbox Safe (demo mode) is never a real Safe an owner can sign
  // through, and its Roles permission is pre-configured at creation - so
  // this panel treats it as always ready and never sends anyone to a real
  // Safe/Roles setup URL for it, regardless of what the caller passed as
  // `ready` or what needsModifier says.
  const effectiveReady = ready || spec.isSandbox;

  async function handleRecheck() {
    if (!onRecheck) return;
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  }

  const steps = spec.needsModifier
    ? [
        "Open the Zodiac Roles app for this Safe (link below) and enable its Roles Modifier - a one-time setup for this Safe.",
        "In the same app, add the exact permission shown under Technical details, for the role key you choose.",
        "Come back here and hit Check again.",
      ]
    : [
        "Open the Zodiac Roles app for this Safe (link below) and add the exact permission shown under Technical details.",
        "Come back here and hit Check again.",
      ];

  return (
    <div
      className={`space-y-3 rounded-xl border p-5 ${
        effectiveReady ? "border-cream-100/10 bg-forest-800/60" : "border-warning/30 bg-warning/5"
      }`}
    >
      <div>
        <h2 className={`font-semibold ${effectiveReady ? "text-cream-50" : "text-warning"}`}>
          {spec.isSandbox
            ? "Roles permission"
            : ready
              ? "Roles permission"
              : spec.needsModifier
                ? "One-time setup: allow this withdrawal"
                : "Almost there: one permission to add"}
        </h2>
        <p className="text-pretty mt-1 text-sm text-cream-300">
          {spec.isSandbox
            ? "This is your own private demo sandbox - its Roles permission is pre-configured, not deployed on any real chain, and there's nothing for you to set up."
            : ready
              ? "This Safe is set up to execute this strategy. The permission below is what makes that possible - worth double-checking it's still exactly right."
              : "Exit Keepa never moves funds on its own signature. Your Safe's own owners grant it a narrow, one-function permission through Zodiac's official Roles app, then Exit Keepa can act only inside that permission."}
        </p>
      </div>

      {!effectiveReady && (
        <ol className="space-y-1.5 text-pretty text-sm text-cream-200">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-cream-500">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-cream-400 hover:text-cream-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
          Technical details
          <svg className="faq-chevron h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <div className="data-mono mt-2 space-y-1 font-mono text-xs text-cream-300">
          <p>
            Target: {spec.targetLabel} ({spec.target})
          </p>
          <p>
            Function: {spec.functionSignature} (selector {spec.selector})
          </p>
          {spec.conditions.map((c) => (
            <p key={c.param}>
              · {c.param} ({c.type}): {c.rule}
            </p>
          ))}
          <p>Execution options: {spec.executionOptions}</p>
          <p>Role key: {spec.roleKey}</p>
        </div>
      </details>

      {!spec.isSandbox && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <a href={spec.safeAppUrl} target="_blank" rel="noreferrer" className={`inline-flex ${btnSecondarySmall}`}>
              Open Zodiac Roles app for this Safe →
            </a>
            {onRecheck && !ready && (
              <button onClick={handleRecheck} disabled={rechecking} className={btnSecondarySmall}>
                {rechecking ? "Checking..." : "Check again"}
              </button>
            )}
          </div>
          <p className="text-pretty text-xs text-cream-500">
            Opens Safe&apos;s own app in a new tab, for this Safe&apos;s actual owners to sign.
          </p>
        </>
      )}
    </div>
  );
}
