"use client";

import { useState } from "react";
import { btnSecondarySmall } from "../lib/ui";

export type RolesSetupState = "modifier_missing" | "permission_missing" | "ready";

export interface RolesPermissionSpec {
  roleKey: string;
  target: string;
  targetLabel: string;
  selector: string;
  functionSignature: string;
  conditions: Array<{ param: string; type: string; rule: string }>;
  executionOptions: string;
  /** Zodiac Roles app - configures permissions on a Modifier that already exists. */
  safeAppUrl: string;
  /** Zodiac app - where a Roles Modifier is installed on a Safe in the first place. */
  zodiacAppUrl: string;
  /** Which of the three real-Safe setup states this Safe is in. */
  setupState: RolesSetupState;
  note: string;
  needsModifier: boolean;
  /** True for a demo session's own private sandbox Safe. This panel never shows
   * setup steps or a live safe.global link when true, regardless of `setupState`. */
  isSandbox: boolean;
}

/**
 * The one-time authorization a real Safe needs before Exit Keepa can act
 * for it, and the only step in the whole product a person has to perform
 * themselves. It cannot move server-side: KeeperHub only ever executes
 * through a Roles permission the Safe's own owners granted in the Safe's
 * own signing flow, and nothing here holds their keys (see
 * apps/api/src/execution/rolesPermission.ts).
 *
 * What this panel is careful about is WHICH step it asks for. There are
 * three genuinely different states, and the previous version collapsed the
 * first two - so someone whose Safe had no Roles Modifier at all was sent
 * to the Roles permissions editor, which configures permissions on a
 * Modifier that doesn't exist yet. It opened, showed nothing usable, and
 * dead-ended. Each state below gets its own copy and its own destination.
 */
export function RolesSetupPanel({
  spec,
  onRecheck,
}: {
  spec: RolesPermissionSpec;
  onRecheck?: () => Promise<void> | void;
}) {
  const [rechecking, setRechecking] = useState(false);

  // A sandbox Safe (demo mode) is never a real Safe an owner can sign
  // through, and its Roles permission is pre-configured at creation - so it
  // is always treated as ready and never sent to a real Safe/Roles URL,
  // whatever setupState says.
  const state: RolesSetupState = spec.isSandbox ? "ready" : spec.setupState;
  const ready = state === "ready";

  async function handleRecheck() {
    if (!onRecheck) return;
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  }

  const copy = {
    modifier_missing: {
      heading: "One-time setup: step 1 of 2",
      lead: "Your Safe needs Zodiac's Roles Modifier installed before it can grant Exit Keepa anything. This is a one-time change to the Safe itself, made by the Safe's own owners.",
      steps: [
        "Open the Zodiac app below, connected as one of this Safe's owners.",
        'Add the "Roles Modifier" module and confirm the transaction in your Safe.',
        "Come back here and hit Check again - you'll then get step 2, the permission itself.",
      ],
      linkLabel: "Open the Zodiac app for this Safe →",
      linkUrl: spec.zodiacAppUrl,
    },
    permission_missing: {
      heading: "One-time setup: step 2 of 2",
      lead: "The Roles Modifier is installed. All that's left is granting Exit Keepa the single, narrow permission below - one withdrawal, one asset, paid back into this same Safe, and nothing else.",
      steps: [
        "Open the Zodiac Roles app below, connected as one of this Safe's owners.",
        "Add the permission shown under Technical details for the role key listed there.",
        "Come back here and hit Check again.",
      ],
      linkLabel: "Open the Zodiac Roles app for this Safe →",
      linkUrl: spec.safeAppUrl,
    },
    ready: {
      heading: "READY - Exit Keepa is authorized to execute this exit automatically",
      lead: spec.isSandbox
        ? "This is your own private demo sandbox. Its permission is pre-configured and it isn't deployed on any real chain, so there's nothing for you to set up."
        : "Setup is done, and it was one-time. From here Exit Keepa watches your condition and executes the exit itself - you don't have to be online, and you won't be asked to sign anything again.",
      steps: [] as string[],
      linkLabel: "Review this permission in the Zodiac Roles app →",
      linkUrl: spec.safeAppUrl,
    },
  }[state];

  return (
    <div
      className={`space-y-3 rounded-xl border p-5 ${
        ready ? "border-mint-400/30 bg-mint-400/5" : "border-warning/30 bg-warning/5"
      }`}
    >
      <div>
        <h2 className={`text-balance font-semibold ${ready ? "text-mint-300" : "text-warning"}`}>{copy.heading}</h2>
        <p className="text-pretty mt-1 text-sm text-cream-300">{copy.lead}</p>
        {!ready && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-cream-500 hover:text-cream-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
              Why can&apos;t Exit Keepa just do this for me?
            </summary>
            <p className="text-pretty mt-1.5 text-xs text-cream-400">
              Exit Keepa never holds your funds or your keys. The only way it can ever touch this Safe is through a
              narrow, one-function permission - and the only party who can grant that is this Safe&apos;s own
              owner(s), signing through Safe&apos;s own app. Nothing here submits that transaction for you. It is
              also the only thing you ever have to do by hand: once it&apos;s granted, every exit after this runs
              without you.
            </p>
          </details>
        )}
      </div>

      {copy.steps.length > 0 && (
        <ol className="space-y-1.5 text-pretty text-sm text-cream-200">
          {copy.steps.map((s, i) => (
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
            <a href={copy.linkUrl} target="_blank" rel="noreferrer" className={`inline-flex ${btnSecondarySmall}`}>
              {copy.linkLabel}
            </a>
            {onRecheck && !ready && (
              <button onClick={handleRecheck} disabled={rechecking} className={btnSecondarySmall}>
                {rechecking ? "Checking..." : "Check again"}
              </button>
            )}
          </div>
          {!ready && (
            <p className="text-pretty text-xs text-cream-500">
              Opens Safe&apos;s own app in a new tab. Connect the wallet that&apos;s actually an owner of this Safe -
              Safe rejects a signature from any other wallet, including yours if you&apos;re not one of its owners.
            </p>
          )}
        </>
      )}
    </div>
  );
}
