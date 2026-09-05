"use client";

import { useEffect, useRef, useState } from "react";
import { buildZodiacModulesSafeAppUrl } from "@exit-keepa/shared";
import { btnPrimary, linkFocus } from "../lib/ui";
import { api } from "../lib/api";
import { useWallet } from "../lib/wallet";

export type AuthorizationState = "needs_module" | "needs_permission" | "protected";
export interface AuthorizationStatus {
  state: AuthorizationState;
  detectedModifierAddress: string | null;
  enabledModules: string[];
  permissionChecked: boolean;
  undetermined: string | null;
  summary: string;
}

export function AuthorizationPanel({ status, safeAddress, chainId, safeId, onRecheck }: {
  status: AuthorizationStatus;
  safeAddress: string;
  chainId: number;
  safeId: string;
  onRecheck: () => Promise<void> | void;
}) {
  const { address, getProvider } = useWallet();
  const [authorizing, setAuthorizing] = useState(false);
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const onRecheckRef = useRef(onRecheck);
  onRecheckRef.current = onRecheck;

  useEffect(() => {
    if (status.state === "protected") return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (!cancelled && !document.hidden) Promise.resolve(onRecheckRef.current()).catch(() => {});
    }, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [status.state]);

  if (status.state === "protected") {
    return (
      <div className="rounded-xl border border-mint-400/30 bg-mint-400/5 p-5">
        <h2 className="font-display text-lg font-semibold text-mint-300">Your Safe is protected.</h2>
        <p className="mt-1 text-pretty text-sm text-cream-300">Automatic exits are enabled. Exit Keepa can withdraw Base USDC from Aave only when your strategy says to exit.</p>
      </div>
    );
  }

  async function authorize() {
    const provider = getProvider();
    if (!provider || !address || address === "demo-mode") {
      setMessage("Connect the wallet that owns this Safe before authorizing automatic exits.");
      return;
    }
    setAuthorizing(true); setMessage(null);
    try {
      for (let currentStep = 0; currentStep < 3; currentStep++) {
        setStep(currentStep);
        const plan = await api.prepareSafeAuthorization(safeId, currentStep);
        const signature = await provider.request({
          method: "eth_signTypedData_v4",
          params: [address, JSON.stringify(plan.typedData)],
        }) as string;
        const execution = await api.buildSafeAuthorizationExecution(safeId, {
          step: currentStep,
          safeTxHash: plan.safeTxHash,
          signature,
        });

        // Preflight the exact Safe call with the exact owner signature. A
        // successful eth_call proves the Safe contract accepts this signature
        // and transaction shape before the wallet is asked to broadcast it.
        await provider.request({
          method: "eth_call",
          params: [{ from: address, to: execution.to, data: execution.data, value: execution.value }, "latest"],
        });
        await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: address, to: execution.to, data: execution.data, value: execution.value }],
        });

        // Do not trust submission as completion. Wait for the Safe nonce/state
        // to advance and let the authoritative authorization endpoint decide
        // whether the permission is actually present.
        await waitForRecheck(currentStep, onRecheckRef.current);
      }
      await onRecheckRef.current();
    } catch (err) {
      setMessage((err as Error).message || "The authorization transaction was not completed.");
    } finally { setAuthorizing(false); }
  }

  async function waitForRecheck(completedStep: number, recheck: () => Promise<void> | void) {
    // The recheck endpoint is the only source of truth. We give the chain a
    // bounded window to mine the owner-signed Safe transaction, then stop.
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (document.hidden) continue;
      await recheck();
      // A later authorization call will move the UI forward. We intentionally
      // do not infer completion from the submitted transaction hash.
      if (completedStep === 2) return;
    }
  }

  if (status.state === "needs_module") {
    return (
      <div className="space-y-4 rounded-xl border border-cream-100/15 bg-forest-800/60 p-5">
        <div>
          <h2 className="text-balance font-display text-lg font-semibold text-cream-50">Your Safe needs one additional permission module.</h2>
          <p className="mt-1 text-pretty text-sm text-cream-300">Exit Keepa cannot install a custody-related module silently. This one-time security change must be approved by your Safe owners.</p>
        </div>
        <a href={buildZodiacModulesSafeAppUrl(chainId, safeAddress)} target="_blank" rel="noreferrer" className={`inline-flex ${btnPrimary}`}>
          Set up the permission module
        </a>
        <p className="text-pretty text-xs text-cream-400">Once it is installed, return here. Exit Keepa will detect it automatically.</p>
        {status.undetermined && <p className="text-pretty text-xs text-danger">Could not verify the Safe: {status.undetermined}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-xl border border-cream-100/15 bg-forest-800/60 p-5">
      <div>
        <h2 className="text-balance font-display text-lg font-semibold text-cream-50">Enable automatic exits</h2>
        <p className="mt-1 text-pretty text-sm text-cream-300">Your Safe is compatible. Approve a narrow permission so Exit Keepa can withdraw Base USDC from Aave back to this Safe.</p>
      </div>

      <div className="rounded-lg border border-cream-100/10 bg-forest-950/40 p-4">
        <p className="text-sm font-medium text-cream-100">What Exit Keepa can do</p>
        <ul className="mt-2 space-y-1 text-sm text-cream-300">
          <li>• Withdraw Base USDC from Aave</li>
          <li>• Send it only back to your Safe</li>
          <li>• Allow only the Exit Keepa keeper to trigger it</li>
          <li>• Leave Safe ownership and threshold unchanged</li>
        </ul>
      </div>

      <button onClick={authorize} disabled={authorizing} className={btnPrimary}>
        {authorizing ? `Approving security step ${step + 1} of 3…` : "Authorize automatic exits"}
      </button>

      {authorizing && <p className="text-pretty text-xs text-cream-400">Your wallet will ask you to sign each Safe configuration step. Exit Keepa waits for each one to be mined before continuing.</p>}
      {message && <p className="text-pretty rounded-lg border border-cream-100/10 bg-forest-950/40 px-3 py-2 text-sm text-danger">{message}</p>}
      {status.undetermined && <p className="text-pretty text-xs text-cream-400">{status.undetermined}</p>}

      <details>
        <summary className="cursor-pointer text-xs text-cream-500 hover:text-cream-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">Technical details</summary>
        <div className="mt-2 space-y-1 font-mono text-[11px] text-cream-400">
          <p className="break-all">Safe: {safeAddress}</p>
          <p className="break-all">Detected permission module: {status.detectedModifierAddress ?? "none"}</p>
          <p>Permission dry run performed: {status.permissionChecked ? "yes" : "no"}</p>
          <p>Authorization state: {status.state}</p>
        </div>
      </details>
      <p className="text-pretty text-xs text-cream-500">A wallet signature authorizes the Safe transaction. Exit Keepa does not hold your Safe key and never treats a submitted transaction as proof of protection.</p>
    </div>
  );
}
