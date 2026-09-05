"use client";

import { useEffect, useRef, useState } from "react";
import { btnPrimary } from "../lib/ui";
import { api } from "../lib/api";
import { useWallet } from "../lib/wallet";
import { resolveSafeId } from "../lib/resolveSafeId";

export type AuthorizationState = "needs_module" | "needs_permission" | "protected";
export interface AuthorizationStatus { state: AuthorizationState; detectedModifierAddress: string | null; enabledModules: string[]; permissionChecked: boolean; undetermined: string | null; summary: string; }
type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type PlanStep = { id: string; kind: "deploy_proxy" | "enable_module" | "assign_role" | "scope_target" | "scope_function"; label: string; txType: "eoa" | "safe"; to: string; value: string; data: string; safeTxHash?: string; typedData?: unknown; safeTx?: { to: string; value: string; data: string; operation: number; safeTxGas: string; baseGas: string; gasPrice: string; gasToken: string; refundReceiver: string; nonce: string } };

export function AuthorizationPanel({ status, safeAddress, chainId, safeId, onRecheck }: { status: AuthorizationStatus; safeAddress: string; chainId: number; safeId?: string; onRecheck: () => Promise<void> | void; }) {
  const { address, getProvider } = useWallet(); const [authorizing, setAuthorizing] = useState(false); const [currentLabel, setCurrentLabel] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null); const onRecheckRef = useRef(onRecheck); onRecheckRef.current = onRecheck;
  useEffect(() => { if (status.state === "protected") return; let cancelled = false; const timer = setInterval(() => { if (!cancelled && !document.hidden) Promise.resolve(onRecheckRef.current()).catch(() => {}); }, 10000); return () => { cancelled = true; clearInterval(timer); }; }, [status.state]);
  if (status.state === "protected") return <div className="rounded-xl border border-mint-400/30 bg-mint-400/5 p-5"><h2 className="font-display text-lg font-semibold text-mint-300">Your Safe is protected.</h2><p className="mt-1 text-pretty text-sm text-cream-300">Automatic exits are enabled. Exit Keepa can withdraw Base USDC from Aave only when your strategy says to exit.</p></div>;
  async function ensureBase(provider: Provider) { const raw = await provider.request({ method: "eth_chainId" }); if (String(raw).toLowerCase() === "0x2105") return; await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }); const switched = await provider.request({ method: "eth_chainId" }); if (String(switched).toLowerCase() !== "0x2105") throw new Error("Switch your wallet to Base before authorizing automatic exits."); }
  async function waitForReceipt(provider: Provider, txHash: string) { for (let attempt = 0; attempt < 90; attempt++) { const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] }) as { status?: string } | null; if (receipt) { if (receipt.status !== "0x1") throw new Error("The authorization transaction failed. Exit Keepa has not marked your Safe as protected."); return; } await new Promise((resolve) => setTimeout(resolve, 2000)); } throw new Error("The authorization transaction is still pending. Exit Keepa has not marked your Safe as protected."); }
  async function authorize() {
    const provider = getProvider(); if (!provider || !address || address === "demo-mode") { setMessage("Connect the wallet that owns this Safe before authorizing automatic exits."); return; }
    setAuthorizing(true); setMessage(null); setCurrentLabel(null);
    try {
      await ensureBase(provider); if (chainId !== 8453) throw new Error("This Safe is not on Base.");
      const accountId = safeId ?? await resolveSafeId(address, false); if (!accountId) throw new Error("Exit Keepa could not identify this Safe.");
      for (let guard = 0; guard < 8; guard++) {
        const response = await api.prepareSafeAuthorization(accountId); if (response.status === "protected" || !response.plan?.length) { await onRecheckRef.current(); return; }
        const step = response.plan[0] as PlanStep; setCurrentLabel(step.label);
        if (step.txType === "eoa") { const tx = { from: address, to: step.to, data: step.data, value: step.value }; await provider.request({ method: "eth_call", params: [tx, "latest"] }); const txHash = await provider.request({ method: "eth_sendTransaction", params: [tx] }) as string; await waitForReceipt(provider, txHash); await onRecheckRef.current(); continue; }
        if (!step.typedData || !step.safeTxHash || !step.safeTx) throw new Error("Exit Keepa could not prepare the Safe authorization transaction.");
        const signature = await provider.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(step.typedData)] }) as string;
        const execution = await api.buildSafeAuthorizationExecution(accountId, { stepId: step.id, safeTxHash: step.safeTxHash, signature });
        await provider.request({ method: "eth_call", params: [{ from: address, to: execution.to, data: execution.data, value: execution.value }, "latest"] });
        const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: address, to: execution.to, data: execution.data, value: execution.value }] }) as string; await waitForReceipt(provider, txHash); await onRecheckRef.current();
      }
      throw new Error("Authorization did not converge to a protected Safe. No further transaction was submitted.");
    } catch (err) { setMessage((err as Error).message || "The authorization transaction was not completed."); } finally { setAuthorizing(false); setCurrentLabel(null); }
  }
  return <div className="space-y-5 rounded-xl border border-cream-100/15 bg-forest-800/60 p-5"><div><h2 className="text-balance font-display text-lg font-semibold text-cream-50">Protect your Safe</h2><p className="mt-1 text-pretty text-sm text-cream-300">Exit Keepa needs permission to automate one specific action.</p></div><div className="rounded-lg border border-cream-100/10 bg-forest-950/40 p-4"><p className="text-sm font-medium text-cream-100">It can</p><ul className="mt-2 space-y-1 text-sm text-cream-300"><li>• Withdraw Base USDC from Aave</li><li>• Send it only back to your Safe</li><li>• Be triggered only by Exit Keepa</li><li>• Leave Safe ownership and threshold unchanged</li></ul></div><button onClick={authorize} disabled={authorizing} className={btnPrimary}>{authorizing ? (currentLabel ?? "Verifying…") : "Protect my Safe"}</button>{authorizing && <p className="text-pretty text-xs text-cream-400">Exit Keepa verifies each transaction, waits for its receipt, then reads the Safe again before continuing.</p>}{message && <p className="text-pretty rounded-lg border border-cream-100/10 bg-forest-950/40 px-3 py-2 text-sm text-danger">{message}</p>}{status.undetermined && <p className="text-pretty text-xs text-cream-400">{status.undetermined}</p>}<details><summary className="cursor-pointer text-xs text-cream-500 hover:text-cream-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">Technical details</summary><div className="mt-2 space-y-1 font-mono text-[11px] text-cream-400"><p className="break-all">Safe: {safeAddress}</p><p className="break-all">Detected permission module: {status.detectedModifierAddress ?? "none"}</p><p>Permission verification: {status.permissionChecked ? "yes" : "no"}</p><p>Authorization state: {status.state}</p></div></details><p className="text-pretty text-xs text-cream-500">A wallet signature authorizes each Safe transaction. Exit Keepa never treats a submitted transaction as proof of protection.</p></div>;
}
