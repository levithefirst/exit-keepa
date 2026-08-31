"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId } from "../../lib/storage";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, TextInput } from "../../components/ui/Field";
import { Alert } from "../../components/ui/Alert";
import { Disclosure } from "../../components/ui/Disclosure";
import { DataRow } from "../../components/ui/DataRow";
import { EmptyState } from "../../components/ui/EmptyState";

const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const COMPARATOR_LABEL: Record<string, string> = {
  lt: "drops below",
  lte: "is at or below",
  gt: "rises above",
  gte: "is at or above",
};

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
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"form" | "review" | "activated">("form");

  useEffect(() => {
    if (address) setSafeId(getStoredSafeId(address));
  }, [address]);

  if (!address) {
    return <EmptyState title="Connect your wallet first" description="Strategies are tied to your connected Safe." />;
  }
  if (!safeId)
    return (
      <EmptyState
        title="No Safe connected yet"
        description="You need to connect a Safe on the Dashboard before creating a strategy."
        action={
          <a href="/dashboard" className="text-sm text-accent underline">
            Go to Dashboard
          </a>
        }
      />
    );

  async function createAndPreview() {
    setError(null);
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  }

  async function activate() {
    if (!strategyId) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.activateStrategy(strategyId);
      setStep("activated");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "activated") {
    return (
      <div className="max-w-lg space-y-5">
        <Alert tone="success" title="Strategy activated">
          Exit Keepa is now monitoring this condition. It will execute this exact transaction through your Safe once
          the condition is met — nothing has been broadcast yet.
        </Alert>
        <Button onClick={() => router.push(`/strategy/${strategyId}`)}>View Strategy</Button>
      </div>
    );
  }

  if (step === "review" && preview) {
    const canActivate = Boolean(preview.tx);
    const thresholdLabel = `${thresholdPct}%`;
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader
          eyebrow="Step 2 of 2"
          title="Review before activating"
          description="This is deterministically rebuilt from your strategy — nothing here is user-suppliable calldata."
        />

        <Card className="space-y-3">
          <CardHeader title="In plain terms" />
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-2">
              <span className="text-gray-500">Protecting</span>
              <span className="text-gray-200">Your Safe&apos;s USDC supply position on Aave v3 (Base)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-500">Trigger</span>
              <span className="text-gray-200">
                Exit when USDC supply APR {COMPARATOR_LABEL[comparator]} {thresholdLabel}
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-500">Action</span>
              <span className="text-gray-200">
                Withdraw {amountMode === "max" ? "the entire position" : `${exactAmount || "0"} (smallest units)`}{" "}
                back to your own Safe — funds never leave your custody
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-gray-500">When active</span>
              <span className="text-gray-200">Only monitoring turns on — nothing is simulated or broadcast yet</span>
            </li>
          </ul>
        </Card>

        {preview.tx ? (
          <Disclosure summary="Technical transaction details">
            <div className="-mt-1">
              <DataRow label="Target">{preview.tx.to}</DataRow>
              <DataRow label="Function">{preview.tx.decodedFunction}</DataRow>
              <DataRow label="Args">{JSON.stringify(preview.tx.decodedArgs)}</DataRow>
              <DataRow label="Calldata">{preview.tx.data}</DataRow>
              <DataRow label="Via Roles Modifier">{preview.tx.rolesModifierAddress}</DataRow>
            </div>
          </Disclosure>
        ) : (
          <Alert tone="warning" title="Roles permission not yet granted">
            {preview.txError}
          </Alert>
        )}

        {preview.rolesPermission && (
          <Card className="space-y-3">
            <CardHeader
              title="Roles permission required"
              description={preview.rolesPermission.note}
            />
            <div className="-mt-1 -mb-1">
              <DataRow label="Target">
                {preview.rolesPermission.targetLabel} ({preview.rolesPermission.target})
              </DataRow>
              <DataRow label="Function">
                {preview.rolesPermission.functionSignature} (selector {preview.rolesPermission.selector})
              </DataRow>
              {preview.rolesPermission.conditions.map((c: any) => (
                <DataRow key={c.param} label={c.param}>
                  ({c.type}) {c.rule}
                </DataRow>
              ))}
              <DataRow label="Execution options">{preview.rolesPermission.executionOptions}</DataRow>
            </div>
            <a
              href={preview.rolesPermission.safeAppUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm font-medium text-accent underline"
            >
              Open Zodiac Roles app for this Safe →
            </a>
          </Card>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="flex gap-3">
          <Button onClick={activate} disabled={!canActivate || submitting}>
            {submitting ? "Activating…" : "Activate Strategy"}
          </Button>
          <Button variant="secondary" onClick={() => setStep("form")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        eyebrow="Step 1 of 2"
        title="Create exit strategy"
        description="Define what you're protecting and the condition that should trigger an exit."
      />

      <Card className="space-y-4">
        <CardHeader title="Strategy" />
        <Field label="Name" hint="Optional — helps you tell strategies apart on the dashboard.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Exit USDC when supply APR drops" />
        </Field>
      </Card>

      <Card className="space-y-4">
        <CardHeader title="What you're protecting" />
        <div className="rounded-lg border border-white/10 bg-ink px-3 py-2.5 text-sm text-gray-300">
          Aave v3 on Base — USDC supply position
          <span className="ml-2 text-xs text-gray-500">(only supported market in v1)</span>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardHeader title="Exit action" description="Funds are always withdrawn back to your own Safe — never elsewhere." />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 text-gray-300">
            <input type="radio" checked={amountMode === "max"} onChange={() => setAmountMode("max")} />
            Withdraw entire position
          </label>
          <label className="flex items-center gap-2 text-gray-300">
            <input type="radio" checked={amountMode === "exact"} onChange={() => setAmountMode("exact")} />
            Exact amount
          </label>
        </div>
        {amountMode === "exact" && (
          <TextInput
            placeholder="e.g. 1000000 for 1 USDC (smallest units)"
            value={exactAmount}
            onChange={(e) => setExactAmount(e.target.value)}
          />
        )}
      </Card>

      <Card className="space-y-3">
        <CardHeader title="Trigger condition" description="What should cause Exit Keepa to act." />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-400">Exit when USDC supply APR</span>
          <select
            value={comparator}
            onChange={(e) => setComparator(e.target.value as any)}
            className="rounded-lg border border-white/15 bg-ink px-2.5 py-2 text-gray-200"
          >
            <option value="lt">drops below</option>
            <option value="lte">is at or below</option>
            <option value="gt">rises above</option>
            <option value="gte">is at or above</option>
          </select>
          <input
            className="w-20 rounded-lg border border-white/15 bg-ink px-2.5 py-2 text-gray-200"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
          />
          <span className="text-gray-400">%</span>
        </div>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      <Button onClick={createAndPreview} disabled={submitting}>
        {submitting ? "Building preview…" : "Preview Transaction"}
      </Button>
    </div>
  );
}
