"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { btnPrimary, btnPrimarySmall, btnSecondarySmall, btnDanger, card } from "../../../lib/ui";
import { StatusPill } from "../../../components/StatusPill";
import { CopyButton } from "../../../components/CopyButton";

const BASESCAN = "https://basescan.org";

function DetailSkeleton() {
  return (
    <div className="max-w-2xl animate-pulse space-y-8">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-cream-100/10" />
        <div className="h-5 w-20 rounded bg-cream-100/10" />
      </div>
      <div className="h-20 rounded-xl border border-cream-100/10 bg-forest-800/40" />
      <div className="h-28 rounded-xl border border-cream-100/10 bg-forest-800/40" />
    </div>
  );
}

export default function StrategyDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [strategy, setStrategy] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [executions, setExecutions] = useState<any[]>([]);
  const [agentResult, setAgentResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armedExecutionId, setArmedExecutionId] = useState<string | null>(null);

  async function refresh() {
    const [s, execs] = await Promise.all([api.getStrategy(id), api.listExecutions(id)]);
    setStrategy(s);
    setExecutions(execs);
    try {
      setPreview(await api.previewStrategy(id));
    } catch {
      setPreview(null);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !strategy) return <p className="text-pretty text-sm text-danger">{error}</p>;
  if (!strategy) return <DetailSkeleton />;

  async function runGuardian() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.evaluateAgent(id);
      setAgentResult(result);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function simulate(executionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.simulateExecution(id, executionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function broadcast(executionId: string) {
    setBusy(true);
    setError(null);
    setArmedExecutionId(null);
    try {
      await api.broadcastExecution(id, executionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">{strategy.name}</h1>
        <div className="mt-1">
          <StatusPill status={strategy.status} />
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-cream-50">Condition</h2>
        <p className="text-pretty text-sm tabular-nums text-cream-200">
          {strategy.condition.market} — {strategy.condition.metric} {strategy.condition.comparator}{" "}
          {strategy.condition.thresholdBps / 100}%
        </p>
      </div>

      <section className="rounded-xl border border-mint-400/30 bg-mint-400/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-300">Exit Guardian</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-cream-50">Observe → decide → prove</h2>
            <p className="mt-1 max-w-xl text-pretty text-sm text-cream-300">
              The deterministic agent reads the live Aave V3 Base rate, checks your exact strategy and permission boundary,
              then returns an auditable approval or refusal. It cannot bypass the simulation gate.
            </p>
          </div>
          <button onClick={runGuardian} disabled={busy || strategy.status !== "active"} className={btnPrimary}>
            {busy ? "Checking live state..." : "Run Exit Guardian"}
          </button>
        </div>

        {agentResult && (
          <div className="mt-5 space-y-4 rounded-xl border border-cream-100/10 bg-forest-950/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-cream-100">Agent decision</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agentResult.decisionReceipt.decision === "approved" ? "bg-mint-400/15 text-mint-300" : "bg-danger/15 text-danger"}`}>
                {agentResult.decisionReceipt.decision.toUpperCase()}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-cream-400">Observed rate</p>
                <p className="mt-1 font-mono text-sm tabular-nums text-cream-100">
                  {(agentResult.decisionReceipt.observation.rateBps / 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-cream-400">Condition</p>
                <p className="mt-1 text-sm text-cream-100">{agentResult.decisionReceipt.conditionMet ? "Satisfied" : "Not satisfied"}</p>
              </div>
            </div>
            {agentResult.refusalReasons?.length > 0 && (
              <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
                {agentResult.refusalReasons.map((reason: string) => <p key={reason}>{reason}</p>)}
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-xs font-medium text-cream-300">Inspect decision receipt</summary>
              <div className="mt-3 space-y-2 font-mono text-[11px] text-cream-400">
                <p className="break-all">Intent hash: {agentResult.decisionReceipt.intentHash}</p>
                <p className="break-all">Receipt hash: {agentResult.receiptHash}</p>
                <p>Policy: {Object.entries(agentResult.decisionReceipt.policy).filter(([, ok]) => ok).length}/{Object.keys(agentResult.decisionReceipt.policy).length} checks passed</p>
                <p>Execution: {agentResult.decisionReceipt.executionPath}</p>
              </div>
            </details>
          </div>
        )}
      </section>

      {preview?.tx && (
        <details className="group rounded-xl border border-cream-100/10 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-cream-100">
            Configured transaction (technical details)
            <span className="text-mint-400">⌄</span>
          </summary>
          <div className="data-mono mt-3 space-y-1 font-mono text-xs text-cream-300">
            <p>Target contract: {preview.tx.to}</p>
            <p>Function: {preview.tx.decodedFunction}</p>
            <p>Args: {JSON.stringify(preview.tx.decodedArgs)}</p>
            <p className="break-all">Calldata: {preview.tx.data}</p>
          </div>
        </details>
      )}

      {preview && !preview.tx && (
        <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <h2 className="font-semibold text-warning">Roles permission not yet granted</h2>
          <p className="text-pretty text-xs text-cream-300">{preview.txError}</p>
          {preview.rolesPermission && (
            <>
              <div className="data-mono space-y-1 font-mono text-xs text-cream-300">
                <p>Target: {preview.rolesPermission.targetLabel} ({preview.rolesPermission.target})</p>
                <p>Function: {preview.rolesPermission.functionSignature} (selector {preview.rolesPermission.selector})</p>
                {preview.rolesPermission.conditions.map((c: any) => <p key={c.param}>· {c.param} ({c.type}): {c.rule}</p>)}
              </div>
              <a href={preview.rolesPermission.safeAppUrl} target="_blank" rel="noreferrer" className={`inline-flex ${btnSecondarySmall}`}>
                Open Zodiac Roles app for this Safe →
              </a>
            </>
          )}
        </div>
      )}

      {error && <p className="text-pretty text-sm text-danger">{error}</p>}

      <div>
        <h2 className="mb-3 font-semibold text-cream-50">Execution history</h2>
        <p className="mb-3 text-pretty text-xs text-cream-400">
          A Guardian approval is a decision, not a broadcast. Simulation must still pass before a real transaction can execute.
        </p>
        {executions.length === 0 && <p className="text-pretty text-sm text-cream-400">No executions yet.</p>}
        <div className="space-y-3">
          {executions.map((e) => (
            <div key={e.id} className={card}>
              <div className="flex items-center justify-between">
                <StatusPill status={e.status} />
                <span className="text-xs tabular-nums text-cream-400">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              {e.errorMessage && <p className="mt-1 text-pretty text-xs text-danger">{e.errorMessage}</p>}
              {e.txHash && (
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-forest-950/60 px-3 py-2">
                  <a href={`${BASESCAN}/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="block break-all font-mono text-xs text-mint-300 underline hover:text-mint-200">
                    {e.txHash}
                  </a>
                  <CopyButton value={e.txHash} label="Copy tx hash" />
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {e.status === "pending" && <button onClick={() => simulate(e.id)} disabled={busy} className={btnSecondarySmall}>Simulate</button>}
                {e.status === "simulated" && armedExecutionId !== e.id && <button onClick={() => setArmedExecutionId(e.id)} disabled={busy} className={btnPrimarySmall}>Execute (broadcast)</button>}
                {e.status === "simulated" && armedExecutionId === e.id && (
                  <>
                    <span className="text-pretty text-xs text-danger">This sends a real, irreversible transaction. Confirm?</span>
                    <button onClick={() => broadcast(e.id)} disabled={busy} className={btnDanger}>Confirm broadcast</button>
                    <button onClick={() => setArmedExecutionId(null)} disabled={busy} className={btnSecondarySmall}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
