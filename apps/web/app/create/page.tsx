"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { resolveSafeId } from "../../lib/resolveSafeId";
import { btnPrimary, btnSecondary, inputBase, card, linkFocus } from "../../lib/ui";
import { RolesSetupPanel } from "../../components/RolesSetupPanel";
import { ErrorDetail } from "../../components/ErrorDetail";

const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const COMPARATOR_WORDS: Record<string, string> = {
  lt: "drops below",
  lte: "drops to or below",
  gt: "rises above",
  gte: "rises to or above",
};

export default function CreateStrategyPage() {
  const { address, isDemo } = useWallet();
  const router = useRouter();
  const [safeId, setSafeId] = useState<string | null | undefined>(undefined); // undefined = still resolving

  const [name, setName] = useState("");
  const [comparator, setComparator] = useState<"gt" | "gte" | "lt" | "lte">("lt");
  const [thresholdPct, setThresholdPct] = useState("2");
  const [amountMode, setAmountMode] = useState<"max" | "exact">("max");
  const [exactAmount, setExactAmount] = useState("");

  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "review" | "activated">("form");

  // See dashboard/page.tsx's identical effect for why `cancelled` matters:
  // without it, an identity switch (e.g. into demo mode) that re-runs this
  // effect can still have its result overwritten by an older, slower call
  // resolving after the newer one already has.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setSafeId(undefined);
    resolveSafeId(address, isDemo).then((id) => {
      if (!cancelled) setSafeId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [address, isDemo]);

  if (!address) return <p className="text-pretty text-cream-300">Connect your wallet first.</p>;
  if (safeId === undefined) return <p className="text-pretty text-cream-300">Loading...</p>;
  if (!safeId)
    return (
      <p className="text-pretty text-cream-300">
        You need to connect a Safe on the{" "}
        <a href="/dashboard" className={`underline ${linkFocus}`}>
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

  async function recheckPreview() {
    if (!strategyId) return;
    try {
      const previewRes: any = await api.previewStrategy(strategyId);
      setPreview(previewRes);
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
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Strategy activated</h1>
        <p className="text-pretty text-sm text-cream-300">
          Exit Keepa will run this transaction through your Safe the moment your condition is met.
        </p>
        <button onClick={() => router.push(`/strategy/${strategyId}`)} className={btnPrimary}>
          View strategy
        </button>
      </div>
    );
  }

  if (step === "review" && preview) {
    const canActivate = Boolean(preview.tx);
    // The Roles-missing case has its own guided panel below - showing the
    // raw backend error above it too would just repeat the same fact in a
    // scarier voice. Any other build failure (e.g. a bad amount) still
    // gets surfaced plainly, since the Roles panel wouldn't explain it.
    const rolesBlocking = !preview.tx && String(preview.txError ?? "").includes("Roles Modifier");
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Review before you activate</h1>
        <p className="text-pretty text-sm text-cream-300">
          This transaction is rebuilt directly from your strategy every time. Nothing here comes from anything
          typed by hand.
        </p>

        <div className={card}>
          <p className="text-pretty text-sm text-cream-100">
            Exit when USDC supply APR {COMPARATOR_WORDS[comparator]} {thresholdPct}%. Withdraws{" "}
            {amountMode === "max" ? "your entire position" : `${exactAmount || "0"} (smallest units)`} from Aave
            straight back to your own Safe.
          </p>
        </div>

        {preview.tx ? (
          <details className="group rounded-xl border border-cream-100/10 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
              Technical details
              <svg className="faq-chevron h-4 w-4 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className="data-mono mt-3 space-y-2 font-mono text-xs text-cream-300">
              <p>
                <span className="text-cream-500">Target: </span>
                {preview.tx.to}
              </p>
              <p>
                <span className="text-cream-500">Function: </span>
                {preview.tx.decodedFunction}
              </p>
              <p>
                <span className="text-cream-500">Args: </span>
                {JSON.stringify(preview.tx.decodedArgs)}
              </p>
              <p>
                <span className="text-cream-500">Calldata: </span>
                <span className="break-all">{preview.tx.data}</span>
              </p>
              <p>
                <span className="text-cream-500">Via Roles Modifier: </span>
                {preview.tx.rolesModifierAddress}
              </p>
            </div>
          </details>
        ) : (
          !rolesBlocking && (
            <ErrorDetail
              message={preview.txError}
              className="rounded-xl border border-warning/30 bg-warning/5 p-4"
            />
          )
        )}

        {preview.rolesPermission && (canActivate || rolesBlocking) && (
          <RolesSetupPanel spec={preview.rolesPermission} ready={canActivate} onRecheck={recheckPreview} />
        )}

        {error && <p className="text-pretty text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button onClick={activate} disabled={!canActivate} className={btnPrimary}>
            Activate strategy
          </button>
          <button onClick={() => setStep("form")} className={btnSecondary}>
            Back
          </button>
        </div>
        <p className="text-pretty text-xs text-cream-500">
          Activating only turns monitoring on. It doesn&apos;t simulate or send anything, you&apos;ll do that from
          the strategy page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Create exit strategy</h1>

      <div>
        <label htmlFor="strategy-name" className="mb-1 block text-sm text-cream-300">
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
        <label className="mb-1 block text-sm text-cream-300">Market</label>
        <div className="rounded-lg border border-cream-100/20 px-3 py-2 text-sm text-cream-200">
          Aave v3 on Base, USDC supply. The only market Exit Keepa supports right now.
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-cream-300">What happens when it triggers</label>
        <div className="space-y-2 rounded-lg border border-cream-100/20 p-3 text-sm">
          <p className="text-pretty text-cream-200">
            Withdraw USDC from Aave straight back to your Safe (<code>withdraw(asset, amount, to)</code>)
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-xs text-cream-300">
              <input type="radio" checked={amountMode === "max"} onChange={() => setAmountMode("max")} className="accent-mint-400" />
              Withdraw everything
            </label>
            <label className="flex items-center gap-1.5 text-xs text-cream-300">
              <input type="radio" checked={amountMode === "exact"} onChange={() => setAmountMode("exact")} className="accent-mint-400" />
              Withdraw an exact amount
            </label>
          </div>
          {amountMode === "exact" && (
            <div>
              <label htmlFor="exact-amount" className="mb-1 block text-xs text-cream-400">
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
        <label className="mb-1 block text-sm text-cream-300">When should this run?</label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-cream-300">Exit when USDC supply APR</span>
          <select
            value={comparator}
            onChange={(e) => setComparator(e.target.value as any)}
            className="min-h-11 rounded-lg border border-cream-100/20 bg-forest-900/60 px-2 text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950"
          >
            <option value="lt">is below</option>
            <option value="lte">is at or below</option>
            <option value="gt">is above</option>
            <option value="gte">is at or above</option>
          </select>
          <input
            aria-label="Threshold percentage"
            className="min-h-11 w-20 rounded-lg border border-cream-100/20 bg-transparent px-2 tabular-nums text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
          />
          <span className="text-cream-300">%</span>
        </div>
      </div>

      {error && <p className="text-pretty text-sm text-danger">{error}</p>}

      <button onClick={createAndPreview} className={btnPrimary}>
        Preview transaction
      </button>
    </div>
  );
}
