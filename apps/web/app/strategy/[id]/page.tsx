"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { btnPrimary, btnPrimarySmall, btnSecondarySmall, btnDanger, inputBase } from "../../../lib/ui";
import { StatusPill } from "../../../components/StatusPill";
import { CopyButton } from "../../../components/CopyButton";

const BASESCAN = "https://basescan.org";

function DetailSkeleton() {
  return (
    <div className="max-w-2xl animate-pulse space-y-8">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-white/10" />
        <div className="h-5 w-20 rounded bg-white/10" />
      </div>
      <div className="h-20 rounded-lg border border-white/10 bg-white/5" />
      <div className="h-28 rounded-lg border border-white/10 bg-white/5" />
    </div>
  );
}

export default function StrategyDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [strategy, setStrategy] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [executions, setExecutions] = useState<any[]>([]);
  const [currentRateBps, setCurrentRateBps] = useState("150");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  if (error && !strategy) return <p className="text-pretty text-sm text-red-400">{error}</p>;
  if (!strategy) return <DetailSkeleton />;

  async function createExecution() {
    setBusy(true);
    setError(null);
    try {
      await api.createExecution(id, Number(currentRateBps));
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
        <h1 className="text-balance text-2xl font-bold text-white">{strategy.name}</h1>
        <div className="mt-1">
          <StatusPill status={strategy.status} />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 p-4">
        <h2 className="mb-2 font-semibold text-white">Condition</h2>
        <p className="text-pretty text-sm tabular-nums text-gray-300">
          {strategy.condition.market} — {strategy.condition.metric} {strategy.condition.comparator}{" "}
          {strategy.condition.thresholdBps / 100}%
        </p>
      </div>

      {preview?.tx && (
        <div className="rounded-lg border border-white/10 p-4">
          <h2 className="mb-2 font-semibold text-white">Configured transaction</h2>
          <div className="space-y-1 font-mono text-xs text-gray-300">
            <p>Target contract: {preview.tx.to}</p>
            <p>Function: {preview.tx.decodedFunction}</p>
            <p>Args: {JSON.stringify(preview.tx.decodedArgs)}</p>
            <p className="break-all">Calldata: {preview.tx.data}</p>
          </div>
        </div>
      )}

      {preview && !preview.tx && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-2">
          <h2 className="font-semibold text-yellow-300">Roles permission not yet granted</h2>
          <p className="text-pretty text-xs text-gray-400">{preview.txError}</p>
          {preview.rolesPermission && (
            <>
              <div className="space-y-1 font-mono text-xs text-gray-300">
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
                className="inline-flex min-h-11 items-center rounded border border-white/20 px-3 text-xs font-medium text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                Open Zodiac Roles app for this Safe →
              </a>
            </>
          )}
        </div>
      )}

      <div className="rounded-lg border border-white/10 p-4 space-y-3">
        <h2 className="font-semibold text-white">Manual trigger (demo)</h2>
        <p className="text-pretty text-xs text-gray-500">
          Exit Keepa v1 doesn&apos;t yet run a live on-chain rate oracle (see README limitations) — enter the current rate
          to check against the condition, exactly as a real monitor would.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="current-rate" className="mb-1 block text-sm text-gray-400">
              Current supply APR (bps)
            </label>
            <input
              id="current-rate"
              className={`${inputBase} w-28 tabular-nums`}
              value={currentRateBps}
              onChange={(e) => setCurrentRateBps(e.target.value)}
            />
          </div>
          <button onClick={createExecution} disabled={busy || strategy.status !== "active"} className={btnPrimary}>
            Check &amp; create execution
          </button>
        </div>
        {strategy.status !== "active" && (
          <p className="text-pretty text-xs text-yellow-400">Activate the strategy from Create Strategy before executing.</p>
        )}
      </div>

      {error && <p className="text-pretty text-sm text-red-400">{error}</p>}

      <div>
        <h2 className="mb-3 font-semibold text-white">Execution history</h2>
        {executions.length === 0 && <p className="text-pretty text-sm text-gray-500">No executions yet.</p>}
        <div className="space-y-3">
          {executions.map((e) => (
            <div key={e.id} className="rounded-lg border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <StatusPill status={e.status} />
                <span className="text-xs tabular-nums text-gray-500">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              {e.errorMessage && <p className="mt-1 text-pretty text-xs text-red-400">{e.errorMessage}</p>}
              {e.txHash && (
                <div className="mt-1 flex items-center gap-1">
                  <a
                    href={`${BASESCAN}/tx/${e.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all font-mono text-xs text-gray-300 underline hover:text-white"
                  >
                    {e.txHash}
                  </a>
                  <CopyButton value={e.txHash} label="Copy tx hash" />
                </div>
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
                    <span className="text-pretty text-xs text-red-300">
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
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
