"use client";

import { CopyButton } from "./CopyButton";
import { linkFocus } from "../lib/ui";

const BASESCAN = "https://basescan.org";

/**
 * Where a row's data comes from, and therefore how far a reader should
 * trust it. Every row carries one, always visible - the point of this
 * timeline is that "verified on-chain" and "this app says so" never look
 * the same.
 */
export type AuditEvidence =
  | "onchain"
  | "keeperhub"
  | "recomputed"
  | "recorded"
  | "sandbox"
  | "not-published"
  | "pending";

const EVIDENCE_META: Record<AuditEvidence, { label: string; className: string; title: string }> = {
  onchain: {
    label: "on-chain",
    className: "bg-mint-400/15 text-mint-300",
    title: "Re-fetchable from Base by anyone, without this project's cooperation.",
  },
  keeperhub: {
    label: "KeeperHub record",
    className: "bg-info/10 text-info",
    title: "From KeeperHub's own execution record. Reading it directly needs the org's API key.",
  },
  recomputed: {
    label: "recomputed now",
    className: "bg-info/10 text-info",
    title: "Not a stored claim: re-derived on this request by running the same deterministic code the agent runs.",
  },
  recorded: {
    label: "recorded",
    className: "bg-cream-100/10 text-cream-300",
    title: "Persisted by Exit Keepa when it happened, in its own audit log.",
  },
  sandbox: {
    label: "sandbox",
    className: "bg-warning/10 text-warning",
    title: "Produced inside this session's demo sandbox. No chain was involved.",
  },
  "not-published": {
    label: "not published",
    className: "bg-danger/10 text-danger",
    title: "This project holds no checkable artifact for this step, and says so rather than filling one in.",
  },
  pending: {
    label: "not reached",
    className: "bg-cream-100/10 text-cream-500",
    title: "The lifecycle has not got this far.",
  },
};

export interface AuditRow {
  id: string;
  label: string;
  evidence: AuditEvidence;
  detail: string;
  /** Short key/value facts under the detail - addresses, ids, rate readings. */
  facts?: Array<{ label: string; value: string; mono?: boolean; copy?: boolean }>;
  /** A BaseScan transaction link, when and only when a real hash exists. */
  txHash?: string | null;
  /** Renders the row as a refusal rather than a step that completed. */
  refused?: boolean;
}

export type AuditKind = "live-proof" | "demo-sandbox";

const KIND_META: Record<AuditKind, { label: string; className: string; blurb: string }> = {
  "live-proof": {
    label: "LIVE PROOF",
    className: "border-mint-400/40 bg-mint-400/10 text-mint-300",
    blurb: "Base mainnet. Real funds, already moved, before this page existed.",
  },
  "demo-sandbox": {
    label: "DEMO SANDBOX",
    className: "border-warning/40 bg-warning/10 text-warning",
    blurb: "This session only. A synthetic Safe on no chain - nothing here is or becomes a transaction.",
  },
};

/** The kind badge, repeated on every row so a screenshot of one row is never ambiguous. */
function KindBadge({ kind }: { kind: AuditKind }) {
  const meta = KIND_META[kind];
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function EvidenceChip({ evidence }: { evidence: AuditEvidence }) {
  const meta = EVIDENCE_META[evidence];
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ${meta.className}`} title={meta.title}>
      {meta.label}
    </span>
  );
}

/**
 * One lifecycle, in order: condition snapshot → policy pass/fail →
 * simulate result → execution id → receipt.
 *
 * Live-proof rows and demo-sandbox rows are rendered by the same component
 * but are never interleaved: each timeline has exactly one `kind`, stated
 * in its header and repeated on every row. A demo row can never be read as
 * evidence of an on-chain execution, which is the failure mode this whole
 * page exists to avoid.
 */
export function AuditTimeline({
  kind,
  title,
  subtitle,
  rows,
  footer,
}: {
  kind: AuditKind;
  title: string;
  subtitle?: string;
  rows: AuditRow[];
  footer?: React.ReactNode;
}) {
  const meta = KIND_META[kind];

  return (
    <section
      className={`rounded-xl border p-5 sm:p-6 ${kind === "live-proof" ? "border-mint-400/25 bg-forest-800/60" : "border-warning/25 bg-forest-800/40"}`}
      aria-label={`${meta.label} audit trail: ${title}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <KindBadge kind={kind} />
        <h3 className="font-display text-lg font-bold text-cream-50">{title}</h3>
      </div>
      <p className="text-pretty text-sm text-cream-400">{subtitle ?? meta.blurb}</p>

      <ol className="mt-5 space-y-0">
        {rows.map((row, index) => (
          <li key={row.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector line, so the order reads as a sequence rather than a list. */}
            {index < rows.length - 1 && (
              <span className="absolute left-[11px] top-6 h-full w-px bg-cream-100/10" aria-hidden="true" />
            )}
            <span
              className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                row.refused
                  ? "border-danger/50 bg-danger/15 text-danger"
                  : row.evidence === "pending" || row.evidence === "not-published"
                    ? "border-cream-100/20 bg-forest-950 text-cream-500"
                    : "border-mint-400/40 bg-forest-950 text-mint-300"
              }`}
              aria-hidden="true"
            >
              {row.refused ? "✕" : index + 1}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium ${row.refused ? "text-danger" : "text-cream-100"}`}>
                  {row.label}
                </span>
                <EvidenceChip evidence={row.evidence} />
                <KindBadge kind={kind} />
              </div>
              <p className="text-pretty mt-1 text-sm text-cream-400">{row.detail}</p>

              {row.facts && row.facts.length > 0 && (
                <dl className="mt-2 space-y-1 rounded-lg bg-forest-950/50 p-3 text-xs">
                  {row.facts.map((fact) => (
                    <div key={fact.label} className="flex flex-wrap items-center gap-x-2">
                      <dt className="text-cream-500">{fact.label}</dt>
                      <dd className={`min-w-0 break-all text-cream-200 ${fact.mono ? "font-mono" : "tabular-nums"}`}>
                        {fact.value}
                        {fact.copy && <CopyButton value={fact.value} label="Copy" />}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {row.txHash && (
                <a
                  href={`${BASESCAN}/tx/${row.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-2 inline-block break-all font-mono text-xs text-mint-300 underline hover:text-mint-200 ${linkFocus}`}
                >
                  Verify on BaseScan: {row.txHash}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {footer && <div className="mt-4 border-t border-cream-100/10 pt-4">{footer}</div>}
    </section>
  );
}
