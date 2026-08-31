"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId } from "../../lib/storage";
import { btnPrimary, btnSecondary, inputBase } from "../../lib/ui";

const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export default function CreateStrategyPage() {
  const { address } = useWallet();
  const router = useRouter();
  const [safeId, setSafeId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [comparator, setComparator] = useState<"gt" | "gte" | "lt" | "lte">("lt");
  const [thresholdPct, setThresholdPct] = useState("2");
  const [amountMode, setAmountMode] = useState<"max" | "exact">("max");
  const [exactAmount, setExactAmount] = useState("");

  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "review" | "activated">("form");

  useEffect(() => {
    if (address) setSafeId(getStoredSafeId(address));
  }, [address]);

  if (!address) return <p className="text-pretty text-gray-400">Connect your wallet first.</p>;
  if (!safeId)
    return (
      <p className="text-pretty text-gray-400">
        You need to connect a Safe on the{" "}
        <a href="/dashboard" className="underline">
          Dashboard
        </a>{" "}
        before creating a strategy.
      </p>
    );

  async function createAndPreview() {
    setError(null);
    try {
      const strategy: any = await api.createStrategy({
        safeId,
        name: name || "Exit Keepa strategy",
        condition: {
          market: "aave-v3-base",
          metric: "supply_apr",
          comparator,
          thresholdBps: Math.round(parseFloat(thresholdPct || "0") * 100),
        },
        action: {
          protocol: "aave-v3-base",
          action: "withdraw",
          asset: AAVE_USDC,
          amount: amountMode === "max" ? "max" : exactAmount,
        },
      });
      setStrategyId(strategy.id);
      const previewRes: any = await api.previewStrategy(strategy.id);
      setPreview(previewRes);
      setStep("review");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function activate() {
    if (!strategyId) return;
    setError(null);
    try {
      await api.activateStrategy(strategyId);
      setStep("activated");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (step === "activated") {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-balance text-2xl font-bold text-white">Strategy activated</h1>
        <p className="text-pretty text-sm text-gray-400">
          Exit Keepa will execute this transaction through your Safe once the condition is met.
        </p>
        <button onClick={() => router.push(`/strategy/${strategyId}`)} className={btnPrimary}>
          View strategy
        </button>
      </div>
    );
  }

  if (step === "review" && preview) {
    const canActivate = Boolean(preview.tx);
    return (
      <div className="max-w-xl space-y-5">
        <h1 className="text-balance text-2xl font-bold text-white">Review the exact transaction</h1>
        <p className="text-pretty text-sm text-gray-400">
          This is deterministically rebuilt from your strategy — nothing here is user-suppliable calldata.
        </p>

        {preview.tx ? (
          <div className="space-y-2 rounded-lg border border-white/10 p-4 font-mono text-xs">
            <p>
              <span className="text-gray-500">Target: </span>
              {preview.tx.to}
            </p>
            <p>
              <span className="text-gray-500">Function: </span>
              {preview.tx.decodedFunction}
            </p>
            <p>
              <span className="text-gray-500">Args: </span>
              {JSON.stringify(preview.tx.decodedArgs)}
            </p>
            <p>
              <span className="text-gray-500">Calldata: </span>
              <span className="break-all">{preview.tx.data}</span>
            </p>
            <p>
              <span className="text-gray-500">Via Roles Modifier: </span>
              {preview.tx.rolesModifierAddress}
            </p>
          </div>
        ) : (
          <p className="text-pretty rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-yellow-300">
            {preview.txError}
          </p>
        )}

        {preview.rolesPermission && (
          <div className="rounded-lg border border-white/10 p-4 space-y-2">
            <h2 className="font-semibold text-white">Roles permission required</h2>
            <p className="text-pretty text-xs text-gray-500">{preview.rolesPermission.note}</p>
            <div className="space-y-1 font-mono text-xs text-gray-300">
              <p>Target: {preview.rolesPermission.targetLabel} ({preview.rolesPermission.target})</p>
              <p>Function: {preview.rolesPermission.functionSignature} (selector {preview.rolesPermission.selector})</p>
              {preview.rolesPermission.conditions.map((c: any) => (
                <p key={c.param}>· {c.param} ({c.type}): {c.rule}</p>
              ))}
              <p>Execution options: {preview.rolesPermission.executionOptions}</p>
            </div>
            <a
              href={preview.rolesPermission.safeAppUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded border border-white/20 px-3 text-xs font-medium text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              Open Zodiac Roles app for this Safe →
            </a>
          </div>
        )}

        {error && <p className="text-pretty text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button onClick={activate} disabled={!canActivate} className={btnPrimary}>
            Activate strategy
          </button>
          <button onClick={() => setStep("form")} className={btnSecondary}>
            Back
          </button>
        </div>
        <p className="text-pretty text-xs text-gray-500">
          Activating only turns monitoring on — it does not simulate or broadcast anything. Do that from the strategy
          detail page.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-balance text-2xl font-bold text-white">Create exit strategy</h1>

      <div>
        <label htmlFor="strategy-name" className="mb-1 block text-sm text-gray-400">
          Name
        </label>
        <input
          id="strategy-name"
          className={inputBase}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Exit USDC when supply APR drops"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-400">Protocol / market</label>
        <div className="rounded border border-white/20 px-3 py-2 text-sm text-gray-300">
          Aave v3 on Base — USDC supply (only supported protocol in v1)
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-400">Exit action</label>
        <div className="space-y-2 rounded border border-white/20 p-3 text-sm">
          <p className="text-pretty text-gray-300">
            Withdraw USDC from Aave back to your Safe (<code>withdraw(asset, amount, to)</code>)
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input type="radio" checked={amountMode === "max"} onChange={() => setAmountMode("max")} />
              Withdraw entire position
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input type="radio" checked={amountMode === "exact"} onChange={() => setAmountMode("exact")} />
              Exact amount (smallest units)
            </label>
          </div>
          {amountMode === "exact" && (
            <div>
              <label htmlFor="exact-amount" className="mb-1 block text-xs text-gray-500">
                Amount (smallest units)
              </label>
              <input
                id="exact-amount"
                className={inputBase}
                placeholder="e.g. 1000000 for 1 USDC"
                value={exactAmount}
                onChange={(e) => setExactAmount(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-400">Trigger condition</label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-400">Exit when USDC supply APR</span>
          <select
            value={comparator}
            onChange={(e) => setComparator(e.target.value as any)}
            className="min-h-11 rounded border border-white/20 bg-ink px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            <option value="lt">is below</option>
            <option value="lte">is at or below</option>
            <option value="gt">is above</option>
            <option value="gte">is at or above</option>
          </select>
          <input
            aria-label="Threshold percentage"
            className="min-h-11 w-20 rounded border border-white/20 bg-transparent px-2 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
          />
          <span className="text-gray-400">%</span>
        </div>
      </div>

      {error && <p className="text-pretty text-sm text-red-400">{error}</p>}

      <button onClick={createAndPreview} className={btnPrimary}>
        Preview transaction
      </button>
    </div>
  );
}
