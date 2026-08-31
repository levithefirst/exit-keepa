"use client";

import { useMemo, useState } from "react";

type Range = "7D" | "30D" | "90D";

interface DayPoint {
  label: string;
  simulated: number;
  confirmed: number;
}

/**
 * FIXTURE DATA — Exit Keepa has no aggregate analytics endpoint yet (the
 * API exposes per-strategy executions, not a cross-strategy time series).
 * This is clearly-labeled demo data shaped like the real thing so the
 * component can be dropped onto a real endpoint later without changing
 * its interface: swap `DATASETS` for a fetch returning `DayPoint[]`.
 * Never presented as production metrics — see the "Demo data" label
 * rendered with the chart itself.
 */
const DATASETS: Record<Range, DayPoint[]> = {
  "7D": [
    { label: "Mon", simulated: 3, confirmed: 1 },
    { label: "Tue", simulated: 2, confirmed: 0 },
    { label: "Wed", simulated: 5, confirmed: 2 },
    { label: "Thu", simulated: 4, confirmed: 1 },
    { label: "Fri", simulated: 6, confirmed: 3 },
    { label: "Sat", simulated: 2, confirmed: 1 },
    { label: "Sun", simulated: 3, confirmed: 1 },
  ],
  "30D": [
    { label: "W1", simulated: 14, confirmed: 5 },
    { label: "W2", simulated: 21, confirmed: 8 },
    { label: "W3", simulated: 18, confirmed: 6 },
    { label: "W4", simulated: 26, confirmed: 11 },
  ],
  "90D": [
    { label: "M1", simulated: 58, confirmed: 22 },
    { label: "M2", simulated: 71, confirmed: 29 },
    { label: "M3", simulated: 84, confirmed: 35 },
  ],
};

const RANGES: Range[] = ["7D", "30D", "90D"];

function total(points: DayPoint[]) {
  return points.reduce((sum, p) => sum + p.simulated + p.confirmed, 0);
}

export function AnalyticsChart() {
  const [range, setRange] = useState<Range>("7D");
  const points = DATASETS[range];

  const { max, currentTotal, prevTotal, deltaPct } = useMemo(() => {
    const max = Math.max(...points.map((p) => p.simulated + p.confirmed), 1);
    const currentTotal = total(points);
    // Delta compares this range's total to a synthetic "previous period" —
    // 90% of current, for demo purposes only (see fixture note above).
    const prevTotal = Math.round(currentTotal * 0.9) || 1;
    const deltaPct = Math.round(((currentTotal - prevTotal) / prevTotal) * 100);
    return { max, currentTotal, prevTotal, deltaPct };
  }, [points]);

  return (
    <div className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-cream-50">Strategy activity</h2>
          <p className="text-pretty mt-0.5 text-xs text-cream-400">
            Simulations run vs. executions confirmed onchain ·{" "}
            <span className="rounded bg-cream-100/10 px-1.5 py-0.5 text-[11px] font-medium text-cream-300">
              Demo data
            </span>
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="data-mono text-2xl font-bold text-cream-50">{currentTotal}</span>
            <span
              className={`data-mono text-xs font-medium ${deltaPct >= 0 ? "text-mint-400" : "text-danger"}`}
              title={`${currentTotal} this period vs ${prevTotal} previous period (demo comparison)`}
            >
              {deltaPct >= 0 ? "+" : ""}
              {deltaPct}%
            </span>
          </div>
        </div>

        <div role="tablist" aria-label="Time range" className="flex gap-1 rounded-lg border border-cream-100/15 bg-forest-900/60 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70 ${
                range === r ? "bg-mint-400 text-forest-950" : "text-cream-300 hover:text-cream-50"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-40 gap-2 border-b border-cream-100/10 sm:gap-3">
        {points.map((p) => {
          const simPct = (p.simulated / max) * 100;
          const confPct = (p.confirmed / max) * 100;
          return (
            <div key={p.label} className="flex h-full flex-1 flex-col items-center gap-1.5">
              {/* flex-1 on a flex-column child of a fixed-height (h-full)
                  container resolves to a definite pixel height, which the
                  percentage-height bars below can then size against - a
                  bare `height:100%` on an auto-height parent silently
                  collapses to 0 instead. */}
              <div
                className="flex w-full max-w-8 flex-1 flex-col justify-end overflow-hidden rounded-t-md"
                title={`${p.label}: ${p.simulated} simulated, ${p.confirmed} confirmed onchain`}
              >
                <div className="w-full bg-info/50" style={{ height: `${simPct}%` }} aria-hidden="true" />
                <div className="w-full rounded-t-md bg-mint-400" style={{ height: `${confPct}%` }} aria-hidden="true" />
              </div>
              <span className="data-mono text-[11px] text-cream-400">{p.label}</span>
              <span className="sr-only">
                {p.label}: {p.simulated} simulated, {p.confirmed} confirmed onchain
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-cream-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-mint-400" /> Confirmed onchain
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-info/50" /> Simulated only
        </span>
      </div>
    </div>
  );
}
