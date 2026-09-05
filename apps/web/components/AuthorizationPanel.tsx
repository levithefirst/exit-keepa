"use client";

import { useEffect, useRef, useState } from "react";
import { buildRolesSafeAppUrl, buildZodiacModulesSafeAppUrl } from "@exit-keepa/shared";
import { btnPrimary, linkFocus } from "../lib/ui";

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
 * The one-time authorization, presented the way a normal DeFi app presents
 * a signature: one sentence about what it allows, one button, and then it
 * gets out of the way.
 *
 * Two things this deliberately no longer does, because they made the user
 * orchestrate a process Exit Keepa should be orchestrating:
 *
 * - No "Step 1 of 2 / Step 2 of 2". The user is doing one thing -
 *   authorizing this exit. That it takes two Safe transactions is an
 *   implementation detail of Zodiac, not a fact the user should have to
 *   track. The button simply points wherever the next real action is.
 * - No "I've done this - check again". Exit Keepa polls the chain itself
 *   while this panel is open and advances the moment the authorization
 *   lands. Asking someone to tell an app what the app can read for itself
 *   is the app being lazy.
 *
 * What has not changed, and cannot: the transactions that install a Zodiac
 * modifier and scope its permission are executed BY the Safe and signed by
 * its own owners. Exit Keepa holds no keys, so it cannot sign them.
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
  const [opened, setOpened] = useState(false);
  const onRecheckRef = useRef(onRecheck);
  onRecheckRef.current = onRecheck;

  // Watch the chain for the authorization landing, instead of asking the
  // user to come back and tell us. Only runs while there is genuinely
  // something outstanding, pauses on a hidden tab, and stops as soon as
  // the Safe is protected.
  const outstanding = status.state !== "protected";
  useEffect(() => {
    if (!outstanding) return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || document.hidden) return;
      Promise.resolve(onRecheckRef.current()).catch(() => {});
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [outstanding]);

  if (status.state === "protected") {
    return (
      <div className="rounded-xl border border-mint-400/30 bg-mint-400/5 p-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-mint-300">
            ✓
          </span>
          <h2 className="font-display text-lg font-semibold text-mint-300">Protected</h2>
        </div>
        <p className="text-pretty mt-1 text-sm text-cream-300">
          Exit Keepa will automatically execute your exit if your condition is reached.
        </p>
      </div>
    );
  }

  // Where the next real action lives. Which of the two it is comes from
  // chain state, and is never something the user has to work out.
  const href =
    status.state === "needs_module"
      ? buildZodiacModulesSafeAppUrl(chainId, safeAddress)
      : buildRolesSafeAppUrl(chainId, safeAddress);

  return (
    <div className="space-y-4 rounded-xl border border-cream-100/15 bg-forest-800/60 p-5">
      <div>
        <h2 className="text-balance font-display text-lg font-semibold text-cream-50">One-time authorization</h2>
        <p className="text-pretty mt-1 text-sm text-cream-300">
          This lets Exit Keepa perform only this specific exit. Your Safe remains yours and Exit Keepa never receives
          your keys.
        </p>
      </div>

      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={() => setOpened(true)}
        className={`inline-flex ${btnPrimary}`}
      >
        Authorize in your Safe →
      </a>

      <p className="text-pretty text-xs text-cream-400">
        {opened
          ? "Waiting for your Safe… Exit Keepa is watching for this and will continue on its own the moment it lands. You can close that tab when you're done."
          : "Opens your Safe in a new tab. Sign in with a wallet that owns this Safe. Exit Keepa checks for the result itself - there's nothing to come back and click."}
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
          <p className="break-all">Zodiac module detected: {status.detectedModifierAddress ?? "none"}</p>
          <p className="break-all">
            Modules enabled on this Safe: {status.enabledModules.length ? status.enabledModules.join(", ") : "none"}
          </p>
          <p>Permission dry run performed: {status.permissionChecked ? "yes" : "no"}</p>
          <p>Authorization state: {status.state}</p>
        </div>
        <p className="text-pretty mt-2 text-xs text-cream-500">
          Exit Keepa can&apos;t sign this for you - it holds no keys, and only your Safe&apos;s owners can grant it.
          If that button opens a page that won&apos;t load, open{" "}
          <a href="https://app.safe.global" target="_blank" rel="noreferrer" className={`underline ${linkFocus}`}>
            app.safe.global
          </a>{" "}
          directly and pick this Safe; Exit Keepa still detects the result on its own.
        </p>
      </details>
    </div>
  );
}
