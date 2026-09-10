"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EXIT_KEEPA_LIVE_PROOF, EXIT_KEEPA_LIVE_PROOF_STAGES } from "@exit-keepa/shared";
import { api } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { resolveSafeId } from "../../lib/resolveSafeId";
import { btnPrimary, btnSecondary, btnSecondarySmall, linkFocus } from "../../lib/ui";
import { AuditTimeline } from "../../components/AuditTimeline";
import { blockedCallRows, liveProofRows, sandboxRows } from "../../lib/auditRows";
import { ErrorDetail } from "../../components/ErrorDetail";

/**
 * The audit page: one screen where a judge can see, in order, what Exit
 * Keepa actually did - condition snapshot, policy verdict, simulation,
 * KeeperHub execution id, receipt.
 *
 * Two kinds of trail live here and they are never interleaved or merged:
 *
 * - the **live proof**, a real Base mainnet execution that happened before
 *   this page existed. Seeded from published records, so a visitor sees
 *   real data without executing anything and without a wallet.
 * - the **demo sandbox**, whatever this visitor's own session has done.
 *   Every row carries a DEMO SANDBOX badge, and no sandbox row can ever
 *   show a transaction hash, because a sandbox produces no transaction.
 *
 * Nothing on this page executes anything. The one button - "Try a blocked
 * call" - deliberately builds an invalid exit so a judge can watch it be
 * refused; it contacts nothing and stores nothing.
 */
export default function AuditPage() {
  const { address, isDemo, enterDemoMode } = useWallet();

  const [liveProof, setLiveProof] = useState<any>(null);
  const [liveProofError, setLiveProofError] = useState<string | null>(null);

  const [safeId, setSafeId] = useState<string | null | undefined>(undefined);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<any>(null);
  const [execution, setExecution] = useState<any>(null);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const [blocked, setBlocked] = useState<any>(null);
  const [blocking, setBlocking] = useState(false);
  const [startingDemo, setStartingDemo] = useState(false);

  // Public and session-free, so this runs for a visitor who has not
  // connected anything. A failure here is reported, never silently
  // replaced with a stored verdict - see liveProofRows.
  useEffect(() => {
    let cancelled = false;
    api
      .getLiveProof()
      .then((data) => {
        if (!cancelled) setLiveProof(data);
      })
      .catch((err) => {
        if (!cancelled) setLiveProofError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!address) {
      setSafeId(null);
      return;
    }
    let cancelled = false;
    setSafeId(undefined);
    resolveSafeId(address, isDemo).then((id) => {
      if (!cancelled) setSafeId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [address, isDemo]);

  useEffect(() => {
    if (!safeId) return;
    let cancelled = false;
    api
      .listStrategies(safeId)
      .then((rows) => {
        if (cancelled) return;
        setStrategies(rows);
        setSelectedId((current) => current ?? rows[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setSandboxError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [safeId]);

  const loadStrategyTrail = useCallback(async (strategyId: string) => {
    setSandboxError(null);
    const [decisions, executions] = await Promise.all([
      api.listAgentDecisions(strategyId).catch(() => []),
      api.listExecutions(strategyId).catch(() => []),
    ]);
    const newest = decisions[0] ?? null;
    setDecision(newest);
    // The execution that decision opened, if any; otherwise the newest one
    // recorded for the strategy, so a trail is still shown for an execution
    // created outside the agent path.
    const linked = newest?.executionId
      ? executions.find((e: any) => e.id === newest.executionId)
      : [...executions].sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
    setExecution(linked ?? null);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setBlocked(null);
    loadStrategyTrail(selectedId).catch((err) => setSandboxError((err as Error).message));
  }, [selectedId, loadStrategyTrail]);

  async function startDemo() {
    setStartingDemo(true);
    try {
      await enterDemoMode();
    } catch {
      // enterDemoMode records this in useWallet()'s own error state.
    } finally {
      setStartingDemo(false);
    }
  }

  async function tryBlockedCall() {
    if (!selectedId) return;
    setBlocking(true);
    setSandboxError(null);
    try {
      setBlocked(await api.blockedCallDemo(selectedId));
    } catch (err) {
      setSandboxError((err as Error).message);
    } finally {
      setBlocking(false);
    }
  }

  const selected = strategies.find((s) => s.id === selectedId) ?? null;
  const stages = liveProof?.stages ?? EXIT_KEEPA_LIVE_PROOF_STAGES;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-balance font-display text-3xl font-bold text-cream-50">Audit trail</h1>
        <p className="text-pretty text-cream-300">
          Every exit, in the order it happened: the condition Exit Keepa observed, the policy verdict, the simulation,
          KeeperHub&apos;s execution id, and the receipt. No wallet needed to read any of it.
        </p>
        <p className="text-pretty text-sm text-cream-400">
          Rows are labelled <strong className="text-mint-300">LIVE PROOF</strong> or{" "}
          <strong className="text-warning">DEMO SANDBOX</strong> and are never mixed. A sandbox row can never show a
          transaction hash, because a sandbox produces no transaction.
        </p>
      </header>

      {liveProofError && (
        <ErrorDetail
          message={`Could not reach the Exit Keepa API to recompute the live-proof policy check: ${liveProofError}. The published record below still renders - and the transaction itself is verifiable on BaseScan without this app at all.`}
          className="rounded-xl border border-warning/30 bg-warning/5 p-4"
        />
      )}

      <AuditTimeline
        kind="live-proof"
        title="Aave v3 USDC protective exit"
        subtitle={`Base mainnet, execution ${EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId}. Real funds, already moved, before this page existed - a judge verifies it rather than triggers it.`}
        rows={liveProofRows(stages, liveProof)}
        footer={
          <p className="text-pretty text-xs text-cream-400">
            The Safe never appears as this transaction&apos;s top-level <code className="font-mono">from</code> or{" "}
            <code className="font-mono">to</code> on BaseScan: KeeperHub relayed it through its own gas-sponsoring
            contract. What proves the Roles path is in the decoded input and the logs - the Safe itself emits{" "}
            <code className="font-mono">{EXIT_KEEPA_LIVE_PROOF.safeModuleEvent}</code>.{" "}
            <a
              href={EXIT_KEEPA_LIVE_PROOF.basescanUrl}
              target="_blank"
              rel="noreferrer"
              className={`text-mint-300 underline hover:text-mint-200 ${linkFocus}`}
            >
              Open on BaseScan →
            </a>
          </p>
        }
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-cream-50">Your session</h2>
          {strategies.length > 1 && (
            <label className="text-xs text-cream-400">
              Strategy{" "}
              <select
                className="rounded border border-cream-100/20 bg-forest-900 px-2 py-1 text-cream-100"
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!address && (
          <div className="rounded-xl border border-dashed border-cream-100/15 p-6 text-center">
            <p className="text-pretty text-sm text-cream-300">
              Start a private demo session to see your own audit trail alongside the live proof. No wallet, no funds,
              nothing broadcast.
            </p>
            <button onClick={startDemo} disabled={startingDemo} className={`mt-3 ${btnPrimary}`}>
              {startingDemo ? "Starting demo…" : "Try the demo, no wallet needed"}
            </button>
          </div>
        )}

        {address && safeId === undefined && (
          <div className="h-40 animate-pulse rounded-xl border border-cream-100/10 bg-forest-800/40" />
        )}

        {address && safeId && strategies.length === 0 && (
          <div className="rounded-xl border border-dashed border-cream-100/15 p-6 text-center">
            <p className="text-pretty text-sm text-cream-300">
              This session has no strategies yet, so there is nothing of your own to audit.
            </p>
            <Link href="/create" className={`mt-3 inline-flex ${btnSecondary}`}>
              Create one →
            </Link>
          </div>
        )}

        {sandboxError && <ErrorDetail message={sandboxError} />}

        {selected && (
          <AuditTimeline
            kind="demo-sandbox"
            title={selected.name}
            subtitle={
              isDemo
                ? "This session's private sandbox Safe. A synthetic address on no chain - nothing here is or becomes a transaction."
                : "Your own Safe's most recent exit lifecycle, as Exit Keepa recorded it."
            }
            rows={sandboxRows(selected, decision, execution)}
            footer={
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={tryBlockedCall} disabled={blocking} className={btnSecondarySmall}>
                    {blocking ? "Building…" : "Try a blocked call"}
                  </button>
                  <p className="text-pretty text-xs text-cream-400">
                    Builds a withdraw that pays out to <code className="font-mono">0x…dEaD</code> instead of your Safe,
                    and shows Exit Keepa refusing it. Simulate-side only: it contacts KeeperHub not at all and stores
                    nothing.
                  </p>
                </div>
                <Link href={`/strategy/${selected.id}`} className={`inline-block text-xs text-cream-400 underline ${linkFocus}`}>
                  Open this strategy →
                </Link>
              </div>
            }
          />
        )}

        {blocked && (
          <AuditTimeline
            kind="demo-sandbox"
            title="Blocked call"
            subtitle="A deliberately invalid exit, refused. Nothing was sent, simulated, or recorded."
            rows={blockedCallRows(blocked)}
            footer={
              <ul className="space-y-1.5 text-xs text-cream-400">
                {(blocked.independentDefences as string[]).map((line) => (
                  <li key={line} className="text-pretty flex gap-2">
                    <span className="text-mint-300" aria-hidden="true">
                      ✓
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </section>
    </div>
  );
}
