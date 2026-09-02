"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { btnPrimary, btnPrimarySmall, btnSecondarySmall, btnDanger, card } from "../../../lib/ui";
import { StatusPill } from "../../../components/StatusPill";
import { CopyButton } from "../../../components/CopyButton";

const BASESCAN = "https://basescan.org";

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-8">
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
  const [receipt, setReceipt] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guardianBusy, setGuardianBusy] = useState(false);
  // The one truly irreversible action (a real broadcast) gets a two-step
  // confirm instead of firing on the first click - everything else stays
  // single-click.
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

  // A broadcast that came back non-terminal (KeeperHub still confirming
  // the receipt, or still processing under this Idempotency-Key) keeps
  // getting checked on its own - the same GET
  // /api/execute/{executionId}/status the Safe First-Write Sequence
  // calls for, not a re-broadcast - until it settles or the tab closes.
  useEffect(() => {
    const pending = executions.find((e) => e.status === "executing" && e.keeperhubExecutionId);
    if (!pending) return;
    const timer = setTimeout(() => {
      api
        .refreshExecutionStatus(id, pending.id)
        .then(refresh)
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executions, id]);

  if (error && !strategy) return <p className="text-pretty text-sm text-danger">{error}</p>;
  if (!strategy) return <DetailSkeleton />;

  async function runGuardian() {
    setGuardianBusy(true);
    setError(null);
    try {
      const evalResult = await api.evaluateAgent(id);
      const fullReceipt = await api.getAgentReceipt(evalResult.decisionId);
      setReceipt(fullReceipt);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardianBusy(false);
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

  async function refreshStatus(executionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.refreshExecutionStatus(id, executionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">{strategy.name}</h1>
        <div className="mt-1">
          <StatusPill status={strategy.status} />
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-cream-50">Condition</h2>
        <p className="text-pretty text-sm tabular-nums text-cream-200">
          {strategy.condition.market}: {strategy.condition.metric} {strategy.condition.comparator}{" "}
          {strategy.condition.thresholdBps / 100}%
        </p>
      </div>

      {preview?.tx && (
        <details className="group rounded-xl border border-cream-100/10 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
            Configured transaction (technical details)
            <svg className="faq-chevron h-4 w-4 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
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
                <p>
                  Target: {preview.rolesPermission.targetLabel} ({preview.rolesPermission.target})
                </p>
                <p>
                  Function: {preview.rolesPermission.functionSignature} (selector {preview.rolesPermission.selector})
                </p>
                {preview.rolesPermission.conditions.map((c: any) => (
                  <p key={c.param}>
                    · {c.param} ({c.type}): {c.rule}
                  </p>
                ))}
              </div>
              <a
                href={preview.rolesPermission.safeAppUrl}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex ${btnSecondarySmall}`}
              >
                Open Zodiac Roles app for this Safe →
              </a>
            </>
          )}
        </div>
      )}

      <section className="rounded-xl border border-mint-400/30 bg-mint-400/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint-300">Exit Guardian</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-cream-50">Observe, decide, prove</h2>
            <p className="mt-1 max-w-xl text-pretty text-sm text-cream-300">
              Reads the live Aave supply rate on Base, checks it against your condition, and runs the same deterministic
              policy check the autonomous background loop uses. It can approve, refuse, or find nothing to do.
            </p>
          </div>
          <button onClick={runGuardian} disabled={guardianBusy || strategy.status !== "active"} className={btnPrimary}>
            {guardianBusy ? "Checking live state..." : "Run Exit Guardian"}
          </button>
        </div>
        {strategy.status !== "active" && (
          <p className="mt-2 text-pretty text-xs text-warning">
            Activate the strategy from Create Strategy before Exit Guardian can watch it.
          </p>
        )}

        {receipt && (
          <div className="mt-5 space-y-4 rounded-xl border border-cream-100/10 bg-forest-950/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-cream-100">
                {receipt.decision === "triggered" && "Triggered: condition just crossed"}
                {receipt.decision === "held" && "Holding: already acted on this crossing"}
                {receipt.decision === "normal" && "Normal: condition not met"}
              </span>
              {receipt.decision === "triggered" && (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    receipt.policyCheck.policyPassed && receipt.simulationResult?.status !== "failed"
                      ? "bg-mint-400/15 text-mint-300"
                      : "bg-danger/15 text-danger"
                  }`}
                >
                  {!receipt.policyCheck.policyPassed
                    ? "REFUSED"
                    : receipt.simulationResult?.status === "failed"
                      ? "SIMULATION FAILED"
                      : "APPROVED"}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-cream-400">Observed rate</p>
                <p className="mt-1 font-mono text-sm tabular-nums text-cream-100">
                  {(receipt.observation.rateBps / 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-cream-400">Condition</p>
                <p className="mt-1 text-sm text-cream-100">{receipt.conditionMet ? "Satisfied" : "Not satisfied"}</p>
              </div>
            </div>

            {(receipt.policyCheck.refusalReasons?.length > 0 || receipt.simulationResult?.errorMessage) && (
              <div className="space-y-1 rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
                {receipt.policyCheck.refusalReasons?.map((reason: string) => <p key={reason}>{reason}</p>)}
                {receipt.simulationResult?.status === "failed" && receipt.simulationResult?.errorMessage && (
                  <p>Simulation reverted: {receipt.simulationResult.errorMessage}</p>
                )}
              </div>
            )}

            {receipt.decision === "triggered" && receipt.policyCheck.policyPassed && receipt.simulationResult?.status === "simulated" && (
              <p className="text-pretty text-xs text-mint-300">
                Approved and simulated clean. Confirm the broadcast below when you&apos;re ready. Exit Guardian never
                broadcasts on its own.
              </p>
            )}

            <details>
              <summary className="cursor-pointer text-xs font-medium text-cream-300">Inspect the full receipt</summary>
              <div className="mt-3 space-y-2 font-mono text-[11px] text-cream-400">
                <p className="break-all">Intent hash: {receipt.intentHash}</p>
                <p className="break-all">Receipt hash: {receipt.receiptHash}</p>
                {receipt.intent.target && <p className="break-all">Target: {receipt.intent.target}</p>}
                {receipt.policyCheck.policy && (
                  <p>
                    Policy:{" "}
                    {Object.entries(receipt.policyCheck.policy)
                      .map(([name, ok]) => `${name}=${ok ? "pass" : "fail"}`)
                      .join(", ")}
                  </p>
                )}
                <p>Source: {receipt.source === "poller" ? "autonomous poller" : "on-demand check"}</p>
                <p>Checked at: {new Date(receipt.createdAt).toLocaleString()}</p>
              </div>
            </details>
          </div>
        )}
      </section>

      {error && <p className="text-pretty text-sm text-danger">{error}</p>}

      <div>
        <h2 className="mb-3 font-semibold text-cream-50">Execution history</h2>
        <p className="mb-3 text-pretty text-xs text-cream-400">
          Simulated means checked, not sent. Confirmed onchain is the only status backed by a real transaction.
          Verify any of them directly on BaseScan.
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
              {e.keeperhubExecutionId && (
                <p className="mt-1 flex items-center gap-1 text-pretty text-xs text-cream-400">
                  KeeperHub execution: <span className="font-mono text-cream-300">{e.keeperhubExecutionId}</span>
                  <CopyButton value={e.keeperhubExecutionId} label="Copy KeeperHub execution id" />
                </p>
              )}
              {e.txHash && (
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-forest-950/60 px-3 py-2">
                  <a
                    href={`${BASESCAN}/tx/${e.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all font-mono text-xs text-mint-300 underline hover:text-mint-200"
                  >
                    {e.txHash}
                  </a>
                  <CopyButton value={e.txHash} label="Copy tx hash" />
                </div>
              )}
              {e.status === "executing" && (
                <p className="mt-2 text-pretty text-xs text-warning">
                  Broadcast sent - confirming the receipt on-chain with KeeperHub. This checks automatically every
                  few seconds.
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {e.status === "pending" && (
                  <button onClick={() => simulate(e.id)} disabled={busy} className={btnSecondarySmall}>
                    Simulate
                  </button>
                )}
                {e.status === "simulated" && armedExecutionId !== e.id && (
                  <button onClick={() => setArmedExecutionId(e.id)} disabled={busy} className={btnPrimarySmall}>
                    Execute (broadcast)
                  </button>
                )}
                {e.status === "simulated" && armedExecutionId === e.id && (
                  <>
                    <span className="text-pretty text-xs text-danger">
                      This sends a real, irreversible transaction. Confirm?
                    </span>
                    <button onClick={() => broadcast(e.id)} disabled={busy} className={btnDanger}>
                      Confirm broadcast
                    </button>
                    <button onClick={() => setArmedExecutionId(null)} disabled={busy} className={btnSecondarySmall}>
                      Cancel
                    </button>
                  </>
                )}
                {e.status === "executing" && e.keeperhubExecutionId && (
                  <button onClick={() => refreshStatus(e.id)} disabled={busy} className={btnSecondarySmall}>
                    Check status now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
