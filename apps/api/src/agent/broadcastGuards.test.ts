import { describe, expect, it } from "vitest";
import { checkAmountExceeded, checkStaleIntent } from "./broadcastGuards";

describe("checkStaleIntent", () => {
  const baseNow = new Date("2026-08-31T12:10:00.000Z");
  const maxAgeMs = 5 * 60_000;

  it("does not block when there is no linked decision (e.g. the older manual-rate execution path)", () => {
    const result = checkStaleIntent({
      decisionCreatedAt: null,
      strategyUpdatedAt: new Date("2026-08-31T10:00:00.000Z"),
      now: baseNow,
      maxAgeMs,
    });
    expect(result.blocked).toBe(false);
  });

  it("does not block a fresh decision against an unchanged strategy", () => {
    const decisionCreatedAt = new Date("2026-08-31T12:08:00.000Z"); // 2 minutes old
    const result = checkStaleIntent({
      decisionCreatedAt,
      strategyUpdatedAt: new Date("2026-08-31T09:00:00.000Z"), // strategy last edited long before
      now: baseNow,
      maxAgeMs,
    });
    expect(result.blocked).toBe(false);
  });

  it("blocks once the decision is older than the freshness window", () => {
    const decisionCreatedAt = new Date("2026-08-31T12:00:00.000Z"); // exactly 10 minutes old
    const result = checkStaleIntent({
      decisionCreatedAt,
      strategyUpdatedAt: new Date("2026-08-31T09:00:00.000Z"),
      now: baseNow,
      maxAgeMs,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/Stale intent/);
    expect(result.reason).toMatch(/600s old/);
  });

  it("blocks when the strategy was edited after the decision was made, even if the decision is fresh", () => {
    const decisionCreatedAt = new Date("2026-08-31T12:09:00.000Z"); // 1 minute old - well within freshness
    const result = checkStaleIntent({
      decisionCreatedAt,
      strategyUpdatedAt: new Date("2026-08-31T12:09:30.000Z"), // edited 30s after the decision
      now: baseNow,
      maxAgeMs,
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/edited after/);
  });

  it("treats a strategy edit exactly at the decision timestamp as not stale (no edit actually happened after)", () => {
    const decisionCreatedAt = new Date("2026-08-31T12:09:00.000Z");
    const result = checkStaleIntent({
      decisionCreatedAt,
      strategyUpdatedAt: decisionCreatedAt,
      now: baseNow,
      maxAgeMs,
    });
    expect(result.blocked).toBe(false);
  });
});

describe("checkAmountExceeded", () => {
  it("does not block when the configured amount is fully covered by the live position", () => {
    const result = checkAmountExceeded(1_000_000n, 5_000_000n);
    expect(result.blocked).toBe(false);
  });

  it("does not block when the configured amount exactly equals the live position", () => {
    const result = checkAmountExceeded(5_000_000n, 5_000_000n);
    expect(result.blocked).toBe(false);
  });

  it("blocks when the configured amount exceeds the live position - e.g. a partial withdrawal happened elsewhere since", () => {
    const result = checkAmountExceeded(5_000_000n, 1_000_000n);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/Amount exceeded/);
    expect(result.reason).toContain("5000000");
    expect(result.reason).toContain("1000000");
  });

  it("blocks when the live position has gone to zero entirely", () => {
    const result = checkAmountExceeded(1n, 0n);
    expect(result.blocked).toBe(true);
  });
});
