"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { btnSecondarySmall, btnDanger, card } from "../../../lib/ui";
import { StatusPill } from "../../../components/StatusPill";
import { CopyButton } from "../../../components/CopyButton";
import { ErrorDetail } from "../../../components/ErrorDetail";
import { RolesSetupPanel } from "../../../components/RolesSetupPanel";

const BASESCAN = "https://basescan.org";

const COMPARATOR_WORDS: Record<string, string> = {
  lt: "drops below",
  lte: "drops to or below",
  gt: "rises above",
  gte: "rises to or above",
};

/** Statuses where the exit is over, one way or another, and Exit Keepa has nothing left to do. */
const TERMINAL = new Set(["succeeded", "demo_completed", "failed", "refused", "blocked", "cancelled"]);

/**
 * What actually happened, in the user's terms - one line per execution
 * state, deliberately never claiming more than the backend confirmed.
 *
 * The three rules this encodes, from the backend's own contract:
 * - `succeeded` is the ONLY status backed by a verified onchain receipt.
 * - `demo_completed` means the whole lifecycle ran but nothing was sent to
 *   any chain; it is never dressed up as a real execution, and there is no
 *   transaction hash to show because no transaction exists.
 * - `executing` means the outcome is genuinely unknown right now. It says
 *   "being verified" - never "failed", which would be a claim we can't
 *   make, and never "succeeded", which would be worse.
 */
function outcomeCopy(e: any): { headline: string; tone: "good" | "bad" | "pending"; detail?: string } {
  switch (e.status) {
    case "succeeded":
      return { headline: "Exit executed. Confirmed onchain.", tone: "good" };
    case "demo_completed":
      return {
        headline: "Demo execution completed.",
        tone: "good",
        detail:
          "Every step of the real flow ran - trigger, permission check, simulation, execution, verification. Nothing was sent to a blockchain, because this demo Safe exists only in your session. That's why there's no transaction to look up.",
      };
    case "executing":
      return {
        headline: "Execution status is being verified.",
        tone: "pending",
        detail:
          "Exit Keepa sent the transaction and is waiting for confirmation. It will not report success until the outcome is confirmed. This page keeps checking on its own.",
      };
    case "refused":
      return {
        headline: "Exit Keepa refused to execute this.",
        tone: "bad",
        detail: "A safety check failed before anything was sent. Nothing was executed.",
      };
    case "blocked":
      return {
        headline: "Exit Keepa stopped before executing.",
        tone: "bad",
        detail:
          "Conditions changed between approving this exit and sending it, so it was stopped rather than sent on stale information. Nothing was executed.",
      };
    case "failed":
      return { headline: "This exit did not go through.", tone: "bad" };
    case "simulated":
      return {
        headline: "Checked and ready - executing now.",
        tone: "pending",
        detail: "The transaction passed its dry run. Exit Keepa is carrying it out.",
      };
    default:
      return { headline: "Working on it...", tone: "pending" };
  }
}

/**
 * The exit, told as the sequence of things that actually happened - built
 * strictly from the execution's real status, so a step is only ever marked
 * done when the backend genuinely got that far. `refused` never gets past
 * the permission check; `failed` at simulation never shows an execution
 * step as done; nothing here can mark "verified" on an outcome the backend
 * left unconfirmed.
 */
function lifecycleSteps(e: any): Array<{ label: string; done: boolean; failed?: boolean }> {
  const s = e.status as string;
  const refused = s === "refused";
  const blocked = s === "blocked";
  const pastPolicy = !refused;
  const simulated = pastPolicy && !blocked && s !== "pending" && s !== "simulating";
  const simulationFailed = s === "failed" && !e.keeperhubExecutionId && !e.txHash;
  const executed = ["executing", "succeeded", "demo_completed"].includes(s) || Boolean(e.txHash);
  const verified = s === "succeeded" || s === "demo_completed";

  return [
    { label: "Your exit condition was met", done: true },
    { label: "Safe permission verified", done: pastPolicy, failed: refused },
    {
      label: simulationFailed ? "Dry run said this would fail - stopped here" : "Transaction checked in a dry run",
      done: simulated && !simulationFailed,
      failed: simulationFailed || blocked,
    },
    {
      label: e.status === "demo_completed" ? "Executed (demo - nothing sent to a chain)" : "Exit executed",
      done: executed,
    },
    {
      label: verified ? "Outcome verified" : "Outcome verification",
      done: verified,
    },
  ];
}

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
  const [decisions, setDecisions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
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
    // Every agent tick is recorded, including the ones that decide to do
    // nothing - so the newest one is real evidence that Exit Keepa is
    // actually watching, and carries the rate it actually observed. Read
    // on load rather than only after a click, because "is it watching"
    // shouldn't require the user to poke it.
    try {
      setDecisions(await api.listAgentDecisions(id));
    } catch {
      setDecisions([]);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // An execution that came back non-terminal (KeeperHub still confirming
  // the receipt, or still processing under this Idempotency-Key) keeps
  // getting checked on its own - the same GET
  // /api/execute/{executionId}/status the Safe First-Write Sequence
  // calls for, never a re-execution - until it settles or the tab closes.
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

  // "Check now" runs the exact same evaluate-and-execute path the
  // autonomous loop runs on its own schedule - it is a way to see the
  // agent work on demand, not a separate manual execution route.
  async function checkNow() {
    setChecking(true);
    setError(null);
    try {
      const evalResult = await api.evaluateAgent(id);
      setReceipt(await api.getAgentReceipt(evalResult.decisionId));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function recover(executionId: string, kind: "simulate" | "broadcast" | "refresh") {
    setBusy(true);
    setError(null);
    setArmedExecutionId(null);
    try {
      if (kind === "simulate") await api.simulateExecution(id, executionId);
      if (kind === "broadcast") await api.broadcastExecution(id, executionId);
      if (kind === "refresh") await api.refreshExecutionStatus(id, executionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isSandbox = Boolean(preview?.rolesPermission?.isSandbox);
  const ready = Boolean(preview?.tx);
  const watching = strategy.status === "active" && ready;
  const latest = executions.length > 0 ? [...executions].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] : null;
  const triggered = Boolean(latest);
  // Newest decision first (the API already sorts that way), falling back to
  // an on-demand check's own receipt if the list hasn't loaded.
  const lastDecision = decisions[0] ?? null;
  const observedRateBps = lastDecision?.observation?.rateBps ?? receipt?.observation?.rateBps ?? null;
  const lastCheckedAt = lastDecision?.createdAt ?? receipt?.createdAt ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">{strategy.name}</h1>
        <div className="mt-1">
          <StatusPill status={strategy.status} />
        </div>
      </div>

      {/* WHAT AM I PROTECTING / EXIT CONDITION / WHAT WILL EXIT KEEPA DO */}
      <div className={card}>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-cream-500">What I&apos;m protecting</dt>
            <dd className="text-pretty mt-0.5 text-cream-100">
              Your USDC position in Aave v3 on Base{isSandbox ? " (demo)" : ""}.
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-cream-500">Exit condition</dt>
            <dd className="text-pretty mt-0.5 tabular-nums text-cream-100">
              When USDC supply APR {COMPARATOR_WORDS[strategy.condition.comparator] ?? strategy.condition.comparator}{" "}
              {strategy.condition.thresholdBps / 100}%
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-cream-500">What Exit Keepa will do</dt>
            <dd className="text-pretty mt-0.5 text-cream-100">
              Withdraw{" "}
              {strategy.action?.amount === "max" ? "your whole position" : `${strategy.action?.amount} (smallest units)`}{" "}
              out of Aave, straight back into your own Safe - by itself, without asking you again.
            </dd>
          </div>
        </dl>
      </div>

      {/* IS IT WATCHING */}
      <div
        className={`rounded-xl border p-5 ${
          watching ? "border-mint-400/30 bg-mint-400/5" : "border-cream-100/10 bg-forest-800/60"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-cream-500">Status</p>
            <p className={`mt-0.5 font-display text-lg font-semibold ${watching ? "text-mint-300" : "text-cream-200"}`}>
              {watching ? "WATCHING" : strategy.status === "active" ? "NOT YET AUTHORIZED" : "PAUSED"}
            </p>
            <p className="text-pretty mt-1 text-sm text-cream-300">
              {watching
                ? "Exit Keepa is checking the live Aave rate on Base and will act on its own the moment your condition is met. You don't need to be here."
                : strategy.status === "active"
                  ? "Exit Keepa can't act for this Safe yet - finish the one-time authorization below."
                  : "Monitoring is paused. Exit Keepa will not act until you resume it."}
            </p>
            {observedRateBps !== null && (
              <p className="mt-2 text-sm tabular-nums text-cream-200">
                Current APR: <span className="font-mono">{(observedRateBps / 100).toFixed(2)}%</span>
                {lastCheckedAt && (
                  <span className="ml-2 text-xs text-cream-500">
                    last checked {new Date(lastCheckedAt).toLocaleTimeString()}
                  </span>
                )}
              </p>
            )}
          </div>
          <button onClick={checkNow} disabled={checking || strategy.status !== "active"} className={btnSecondarySmall}>
            {checking ? "Checking..." : "Check now"}
          </button>
        </div>
      </div>

      {/* The one-time authorization, only when there's actually something to do. */}
      {preview?.rolesPermission && !ready && (
        <RolesSetupPanel spec={preview.rolesPermission} onRecheck={refresh} />
      )}
      {preview && !preview.tx && !String(preview.txError ?? "").includes("Roles Modifier") && (
        <ErrorDetail message={preview.txError} className="rounded-xl border border-warning/30 bg-warning/5 p-4" />
      )}

      {error && <p className="text-pretty text-sm text-danger">{error}</p>}

      {/* HAS IT TRIGGERED / WHAT HAPPENED */}
      <div>
        <h2 className="mb-1 font-semibold text-cream-50">Has it triggered?</h2>
        {!triggered && (
          <p className="text-pretty text-sm text-cream-400">
            Not yet. Nothing has been executed, and nothing will be until your condition is actually met.
          </p>
        )}

        {latest && <ExecutionCard e={latest} onRecover={recover} busy={busy} armed={armedExecutionId} setArmed={setArmedExecutionId} />}

        {executions.length > 1 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-cream-400 hover:text-cream-300">
              Earlier triggers ({executions.length - 1})
            </summary>
            <div className="mt-3 space-y-3">
              {[...executions]
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                .slice(1)
                .map((e) => (
                  <ExecutionCard
                    key={e.id}
                    e={e}
                    onRecover={recover}
                    busy={busy}
                    armed={armedExecutionId}
                    setArmed={setArmedExecutionId}
                  />
                ))}
            </div>
          </details>
        )}
      </div>

      {receipt && (
        <details className="rounded-xl border border-cream-100/10 p-4">
          <summary className="cursor-pointer text-xs font-medium text-cream-400 hover:text-cream-300">
            Technical details: the agent&apos;s own receipt
          </summary>
          <div className="mt-3 space-y-2 font-mono text-[11px] text-cream-400">
            <p>Decision: {receipt.decision}</p>
            <p>Condition met: {String(receipt.conditionMet)}</p>
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
      )}
    </div>
  );
}

/**
 * One trigger, told as what happened rather than as a machine state - with
 * the raw status, KeeperHub id, and any developer recovery action tucked
 * behind a disclosure. Recovery exists for executions the autonomous path
 * deliberately left open (a status KeeperHub never resolved, a row created
 * by an older manual flow); it is not a step in the normal product, which
 * is why nothing here is on the main path.
 */
function ExecutionCard({
  e,
  onRecover,
  busy,
  armed,
  setArmed,
}: {
  e: any;
  onRecover: (id: string, kind: "simulate" | "broadcast" | "refresh") => void;
  busy: boolean;
  armed: string | null;
  setArmed: (id: string | null) => void;
}) {
  const { headline, tone, detail } = outcomeCopy(e);
  const toneClass = tone === "good" ? "text-mint-300" : tone === "bad" ? "text-danger" : "text-warning";
  const canRecover = !TERMINAL.has(e.status);

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-pretty font-medium ${toneClass}`}>{headline}</p>
        <span className="text-xs tabular-nums text-cream-400">{new Date(e.createdAt).toLocaleString()}</span>
      </div>
      {detail && <p className="text-pretty mt-1 text-sm text-cream-300">{detail}</p>}

      <ul className="mt-3 space-y-1 text-sm">
        {lifecycleSteps(e).map((step) => (
          <li key={step.label} className="flex gap-2">
            <span className={step.done ? "text-mint-300" : step.failed ? "text-danger" : "text-cream-500"}>
              {step.done ? "✓" : step.failed ? "✕" : "·"}
            </span>
            <span className={step.done || step.failed ? "text-cream-200" : "text-cream-500"}>{step.label}</span>
          </li>
        ))}
      </ul>
      {e.errorMessage && e.status !== "executing" && <ErrorDetail message={e.errorMessage} className="mt-2" />}

      {e.txHash && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-cream-500">Verify it yourself:</p>
          <div className="flex items-center gap-1 rounded-lg bg-forest-950/60 px-3 py-2">
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
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-cream-500 hover:text-cream-400">Technical details</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={e.status} />
            {e.keeperhubExecutionId && (
              <span className="flex items-center gap-1 font-mono text-[11px] text-cream-400">
                {e.keeperhubExecutionId}
                <CopyButton value={e.keeperhubExecutionId} label="Copy KeeperHub execution id" />
              </span>
            )}
          </div>
          {canRecover && (
            <div className="space-y-1.5 rounded-lg border border-cream-100/10 p-3">
              <p className="text-pretty text-[11px] text-cream-500">
                Developer recovery. Exit Keepa drives this lifecycle itself - these only exist for an execution it
                couldn&apos;t finish on its own.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {e.status === "pending" && (
                  <button onClick={() => onRecover(e.id, "simulate")} disabled={busy} className={btnSecondarySmall}>
                    Re-run dry run
                  </button>
                )}
                {e.status === "simulated" && armed !== e.id && (
                  <button onClick={() => setArmed(e.id)} disabled={busy} className={btnSecondarySmall}>
                    Force execute
                  </button>
                )}
                {e.status === "simulated" && armed === e.id && (
                  <>
                    <span className="text-pretty text-xs text-danger">
                      This sends a real, irreversible transaction. Confirm?
                    </span>
                    <button onClick={() => onRecover(e.id, "broadcast")} disabled={busy} className={btnDanger}>
                      Confirm
                    </button>
                    <button onClick={() => setArmed(null)} disabled={busy} className={btnSecondarySmall}>
                      Cancel
                    </button>
                  </>
                )}
                {e.status === "executing" && e.keeperhubExecutionId && (
                  <button onClick={() => onRecover(e.id, "refresh")} disabled={busy} className={btnSecondarySmall}>
                    Check status now
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
