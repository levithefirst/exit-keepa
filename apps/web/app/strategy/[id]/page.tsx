"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

const BASESCAN = "https://basescan.org";

export default function StrategyDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [strategy, setStrategy] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [executions, setExecutions] = useState<any[]>([]);
  const [currentRateBps, setCurrentRateBps] = useState("150");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (error && !strategy) return <p className="text-sm text-red-400">{error}</p>;
  if (!strategy) return <p className="text-sm text-gray-500">Loading...</p>;

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
        <h1 className="text-2xl font-bold text-white">{strategy.name}</h1>
        <span
          className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${
            strategy.status === "active" ? "bg-accent/20 text-accent" : "bg-white/10 text-gray-400"
          }`}
        >
          {strategy.status}
        </span>
      </div>

      <div className="rounded-lg border border-white/10 p-4">
        <h2 className="mb-2 font-semibold text-white">Condition</h2>
        <p className="text-sm text-gray-300">
          {strategy.condition.market} — {strategy.condition.metric} {strategy.condition.comparator}{" "}
          {strategy.condition.thresholdBps / 100}%
        </p>
      </div>

      {preview && (
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

      <div className="rounded-lg border border-white/10 p-4 space-y-3">
        <h2 className="font-semibold text-white">Manual trigger (demo)</h2>
        <p className="text-xs text-gray-500">
          Exit Keepa v1 doesn&apos;t yet run a live on-chain rate oracle (see README limitations) — enter the current rate
          to check against the condition, exactly as a real monitor would.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Current supply APR (bps):</span>
          <input
            className="w-24 rounded border border-white/20 bg-transparent px-2 py-1 text-sm"
            value={currentRateBps}
            onChange={(e) => setCurrentRateBps(e.target.value)}
          />
          <button
            onClick={createExecution}
            disabled={busy || strategy.status !== "active"}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
          >
            Check & Create Execution
          </button>
        </div>
        {strategy.status !== "active" && (
          <p className="text-xs text-yellow-400">Activate the strategy from Create Strategy before executing.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <h2 className="mb-3 font-semibold text-white">Execution history</h2>
        {executions.length === 0 && <p className="text-sm text-gray-500">No executions yet.</p>}
        <div className="space-y-3">
          {executions.map((e) => (
            <div key={e.id} className="rounded-lg border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    e.status === "succeeded"
                      ? "bg-accent/20 text-accent"
                      : e.status === "failed"
                        ? "bg-red-500/20 text-red-300"
                        : "bg-white/10 text-gray-400"
                  }`}
                >
                  {e.status}
                </span>
                <span className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              {e.errorMessage && <p className="mt-1 text-xs text-red-400">{e.errorMessage}</p>}
              {e.txHash && (
                <a
                  href={`${BASESCAN}/tx/${e.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all font-mono text-xs text-accent underline"
                >
                  {e.txHash}
                </a>
              )}
              <div className="mt-2 flex gap-2">
                {e.status === "pending" && (
                  <button
                    onClick={() => simulate(e.id)}
                    disabled={busy}
                    className="rounded border border-white/20 px-3 py-1 text-xs text-gray-200 disabled:opacity-50"
                  >
                    Simulate
                  </button>
                )}
                {e.status === "simulated" && (
                  <button
                    onClick={() => broadcast(e.id)}
                    disabled={busy}
                    className="rounded bg-accent px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
                  >
                    Execute (broadcast)
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
