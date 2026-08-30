import { describe, expect, it } from "vitest";
import type { RateCondition } from "@exit-keepa/shared";
import { evaluateRateCondition } from "./evaluateCondition";

function condition(comparator: RateCondition["comparator"], thresholdBps: number): RateCondition {
  return { market: "aave-v3-base", metric: "supply_apr", comparator, thresholdBps };
}

describe("evaluateRateCondition", () => {
  it("gt", () => {
    expect(evaluateRateCondition(condition("gt", 500), 501)).toBe(true);
    expect(evaluateRateCondition(condition("gt", 500), 500)).toBe(false);
  });
  it("gte", () => {
    expect(evaluateRateCondition(condition("gte", 500), 500)).toBe(true);
    expect(evaluateRateCondition(condition("gte", 500), 499)).toBe(false);
  });
  it("lt", () => {
    expect(evaluateRateCondition(condition("lt", 500), 499)).toBe(true);
    expect(evaluateRateCondition(condition("lt", 500), 500)).toBe(false);
  });
  it("lte", () => {
    expect(evaluateRateCondition(condition("lte", 500), 500)).toBe(true);
    expect(evaluateRateCondition(condition("lte", 500), 501)).toBe(false);
  });
});
