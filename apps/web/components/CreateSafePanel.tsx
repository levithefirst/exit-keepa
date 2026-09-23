"use client";

import { useEffect, useRef, useState } from "react";
import type { Address, Hash } from "viem";
import { btnSecondary, linkFocus } from "../lib/ui";
import { useWallet } from "../lib/wallet";
import { CopyButton } from "./CopyButton";
import { BASE_EXPLORER_URL } from "../src/lib/safe-creation/config";
import type { VerifiedSafe } from "../src/lib/safe-creation/flow";

type SafeCreation = typeof import("../src/lib/safe-creation");
type Step =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "ready"; account: Address; predictedAddress: Address; balance: bigint; estimatedCost: bigint; hasEnoughEth: boolean }
  | { kind: "deploying"; predictedAddress: Address; txHash?: Hash }
  | { kind: "verified"; safe: VerifiedSafe; created: boolean; txHash?: Hash }
  | { kind: "error"; message: string; txHash?: string };

// Loaded only when someone asks to create a Safe, so Protocol Kit never ships with the dashboard itself.
const loadSafeCreation = () => import("../src/lib/safe-creation");
const formatEth = (wei: bigint) => (Number(wei) / 1e18).toLocaleString(undefined, { maximumSignificantDigits: 4 });
function TxLink({ hash }: { hash: string }) { return <a href={`${BASE_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" className={`break-all font-mono text-xs underline ${linkFocus}`}>{hash}</a>; }

/**
 * Deploys a 1-of-1 Safe owned by the connected wallet, using the same
 * Protocol Kit flow proven in safe-prototype, and hands the address to the
 * dashboard's register form only after reading owner and threshold back
 * from Base. It never registers anything itself.
 */
export function CreateSafePanel({ onVerified }: { onVerified: (safeAddress: string) => void }) {
  const { address, getProvider } = useWallet();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  // Every run bumps this so a result that lands after unmount or a newer run is dropped.
  const runId = useRef(0);
  const deploying = useRef(false);
  useEffect(() => () => { runId.current++; }, []);

  if (!getProvider()) return null;

  function fail(err: unknown, flow: SafeCreation | undefined) {
    if (!flow) { setStep({ kind: "error", message: "Could not load Safe creation. Check your connection and try again." }); return; }
    const flowErr = flow.toFlowError(err);
    console.error(flowErr, flowErr.cause);
    setStep({ kind: "error", message: flowErr.message, txHash: flowErr.txHash });
  }
  function verified(safe: VerifiedSafe, txHash?: Hash) {
    setStep({ kind: "verified", safe, created: Boolean(txHash), txHash });
    onVerified(safe.safeAddress);
  }

  async function prepare() {
    const id = ++runId.current;
    setStep({ kind: "preparing" });
    let flow: SafeCreation | undefined;
    try {
      flow = await loadSafeCreation();
      const provider = getProvider();
      if (!provider || !address) throw new flow.FlowError("NO_WALLET");
      // The Safe's owner must be the wallet this session signed in with, not whichever account the extension shows now.
      const account = await flow.getCurrentAccount(provider);
      if (!account || account.toLowerCase() !== address.toLowerCase()) throw new flow.FlowError("ACCOUNT_CHANGED");
      await flow.ensureBaseChain(provider);
      const prepared = await flow.prepareSafe(flow.createFlowDeps(provider, account), account);
      if (id !== runId.current) return;
      if (prepared.kind === "exists") verified(prepared.safe);
      else setStep({ kind: "ready", account, predictedAddress: prepared.predictedAddress, balance: prepared.balance, estimatedCost: prepared.estimatedCost, hasEnoughEth: prepared.hasEnoughEth });
    } catch (err) { if (id === runId.current) fail(err, flow); }
  }

  async function deploy() {
    if (step.kind !== "ready" || deploying.current) return;
    const { account, predictedAddress } = step;
    const id = ++runId.current;
    deploying.current = true;
    setStep({ kind: "deploying", predictedAddress });
    let flow: SafeCreation | undefined;
    try {
      flow = await loadSafeCreation();
      const provider = getProvider();
      if (!provider) throw new flow.FlowError("NO_WALLET");
      const result = await flow.deploySafe(flow.createFlowDeps(provider, account), { account, predictedAddress }, (status) => {
        if (status.stage === "confirming" && id === runId.current) setStep({ kind: "deploying", predictedAddress, txHash: status.txHash });
      });
      if (id !== runId.current) return;
      verified(result.safe, result.kind === "created" ? result.txHash : undefined);
    } catch (err) { if (id === runId.current) fail(err, flow); }
    finally { deploying.current = false; }
  }

  if (step.kind === "verified") return <div className="space-y-2 rounded-xl border border-mint-400/30 bg-mint-400/5 p-4"><h2 className="font-display text-base font-semibold text-mint-300">{step.created ? "Safe created and verified" : "This wallet already has a Safe"}</h2><p className="text-pretty text-sm text-cream-300">Read back from Base: your wallet is its only owner, threshold {step.safe.threshold} of 1.</p><div className="flex items-center gap-1"><p className="break-all font-mono text-xs text-cream-200">{step.safe.safeAddress}</p><CopyButton value={step.safe.safeAddress} label="Copy address" /></div>{step.txHash && <p className="text-xs text-cream-400">Transaction: <TxLink hash={step.txHash} /></p>}<p className="text-pretty text-xs text-cream-400">Its address is filled in below. Press Save Safe to register it with Exit Keepa.</p></div>;

  return <div className="space-y-3 rounded-xl border border-cream-100/15 bg-forest-800/40 p-4">
    <div><h2 className="font-display text-base font-semibold text-cream-50">Or create a Safe here</h2><p className="mt-1 text-pretty text-xs text-cream-400">Deploys a new Safe on Base with this wallet as its only owner (1 of 1). Your wallet signs one transaction and pays the gas in Base ETH.</p></div>
    {step.kind === "idle" && <button onClick={prepare} className={btnSecondary}>Create Safe</button>}
    {step.kind === "preparing" && <p className="text-pretty text-sm text-cream-300">Checking your wallet is on Base and predicting your Safe address…</p>}
    {step.kind === "ready" && <>
      <div><p className="text-xs text-cream-400">Your Safe will be created at</p><p className="break-all font-mono text-xs text-cream-200">{step.predictedAddress}</p></div>
      <p className="text-xs tabular-nums text-cream-400">Wallet balance {formatEth(step.balance)} ETH · estimated gas {formatEth(step.estimatedCost)} ETH</p>
      {!step.hasEnoughEth && <p className="text-pretty text-sm text-danger">You need Base ETH in this wallet to pay the deployment transaction.</p>}
      <button onClick={deploy} disabled={!step.hasEnoughEth} className={btnSecondary}>Deploy Safe</button>
    </>}
    {step.kind === "deploying" && <div className="space-y-1"><p className="text-pretty text-sm text-cream-300">{step.txHash ? "Waiting for Base to confirm, then reading the Safe's owner and threshold back…" : "Approve the transaction in your wallet…"}</p>{step.txHash && <p className="text-xs text-cream-400">Transaction: <TxLink hash={step.txHash} /></p>}</div>}
    {step.kind === "error" && <>
      <p className="text-pretty text-sm text-danger">{step.message}</p>
      {step.txHash && <p className="text-xs text-cream-400">Transaction: <TxLink hash={step.txHash} /></p>}
      <button onClick={prepare} className={btnSecondary}>Try again</button>
    </>}
  </div>;
}
