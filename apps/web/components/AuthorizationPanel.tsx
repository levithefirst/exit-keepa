"use client";

import { useState } from "react";
import { buildRolesSafeAppUrl, buildZodiacModulesSafeAppUrl } from "@exit-keepa/shared";
import { btnPrimary, btnSecondarySmall, linkFocus } from "../lib/ui";

export type AuthorizationState = "needs_module" | "needs_permission" | "protected";

export interface AuthorizationStatus {
  state: AuthorizationState;
  detectedModifierAddress: string | null;
  enabledModules: string[];
  permissionChecked: boolean;
  undetermined: string | null;
  summary: string;
}

/**
 * The one-time authorization, told as a product step rather than as a tour
 * of Safe and Zodiac.
 *
 * What this replaces: a panel that told people to "open the Zodiac Roles
 * app and add the permission", linked straight into a Safe App deep link
 * that a real tester hit as "Safe App could not be loaded", and asked them
 * to paste a Roles Modifier address and a bytes32 role key by hand. None
 * of that is asked for any more - the modifier address is read off the
 * Safe (see the API's /authorization endpoint), and the state comes from
 * chain rather than from what the UI assumes.
 *
 * What honestly cannot change here: the transactions that install a Zodiac
 * modifier and scope its permission must be executed BY the Safe, signed
 * by its own owners. Exit Keepa holds no keys, so it cannot sign them, and
 * this project has no verified encoding for Zodiac's scopeFunction
 * condition tree (see apps/api/src/execution/rolesPermission.ts). So the
 * signing itself still happens in Safe's own app - but Exit Keepa now says
 * exactly which step you're on, how many remain, checks the result itself,
 * and moves on the moment it sees the change on-chain.
 */
export function AuthorizationPanel({
  status,
  safeAddress,
  chainId,
  onRecheck,
}: {
  status: AuthorizationStatus;
  safeAddress: string;
  chainId: number;
  onRecheck: () => Promise<void> | void;
}) {
  const [checking, setChecking] = useState(false);

  async function recheck() {
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      setChecking(false);
    }
  }

  if (status.state === "protected") {
    return (
      <div className="rounded-xl border border-mint-400/30 bg-mint-400/5 p-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-mint-300">
            ✓
          </span>
          <h2 className="font-display text-lg font-semibold text-mint-300">Protected</h2>
        </div>
        <p className="text-pretty mt-1 text-sm text-cream-300">{status.summary}</p>
      </div>
    );
  }

  const step = status.state === "needs_module" ? 1 : 2;

  return (
    <div className="space-y-4 rounded-xl border border-warning/30 bg-warning/5 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">
          Step {step} of 2 · one-time authorization
        </p>
        <h2 className="text-balance mt-1 font-display text-lg font-semibold text-cream-50">
          {step === 1 ? "Authorize Exit Keepa" : "Finish authorization"}
        </h2>
        <p className="text-pretty mt-1 text-sm text-cream-300">{status.summary}</p>
      </div>

      <p className="text-pretty text-sm text-cream-200">
        {step === 1
          ? "Your Safe needs to give Exit Keepa a single, narrow permission: withdraw your USDC out of Aave, back into this same Safe. Nothing else. You'll approve it in your Safe, and only your Safe's owners can grant it."
          : "Almost there. Your Safe is set up - it just hasn't granted Exit Keepa the withdrawal permission yet. One more approval in your Safe and you're done."}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={step === 1 ? buildZodiacModulesSafeAppUrl(chainId, safeAddress) : buildRolesSafeAppUrl(chainId, safeAddress)}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex ${btnPrimary}`}
        >
          {step === 1 ? "Authorize Exit Keepa →" : "Grant the permission →"}
        </a>
        <button onClick={recheck} disabled={checking} className={btnSecondarySmall}>
          {checking ? "Checking your Safe…" : "I've done this - check again"}
        </button>
      </div>

      <p className="text-pretty text-xs text-cream-400">
        Opens your Safe in a new tab. Sign in with a wallet that is an owner of this Safe - it will reject any other
        wallet. Exit Keepa checks your Safe on its own and moves you forward as soon as it sees the change.
      </p>

      {status.undetermined && (
        <p className="text-pretty rounded-lg border border-cream-100/10 bg-forest-950/40 px-3 py-2 text-xs text-cream-400">
          {status.undetermined}
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-cream-500 hover:text-cream-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
          Technical details
        </summary>
        <div className="mt-2 space-y-1 font-mono text-[11px] text-cream-400">
          <p className="break-all">Safe: {safeAddress}</p>
          <p>
            Zodiac module detected:{" "}
            <span className="break-all">{status.detectedModifierAddress ?? "none"}</span>
          </p>
          <p className="break-all">
            Modules enabled on this Safe: {status.enabledModules.length ? status.enabledModules.join(", ") : "none"}
          </p>
          <p>Permission dry run performed: {status.permissionChecked ? "yes" : "no"}</p>
        </div>
        <p className="text-pretty mt-2 text-xs text-cream-500">
          If that button opens a page that won&apos;t load, open{" "}
          <a href="https://app.safe.global" target="_blank" rel="noreferrer" className={`underline ${linkFocus}`}>
            app.safe.global
          </a>{" "}
          directly, pick this Safe, and find Zodiac under Apps. Exit Keepa will still detect the change on its own.
        </p>
      </details>
    </div>
  );
}
