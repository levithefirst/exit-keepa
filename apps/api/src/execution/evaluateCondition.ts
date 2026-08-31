import type { RateCondition } from "@exit-keepa/shared";

/**
 * Pure comparator logic for a RateCondition against a rate expressed in
 * the same basis-points unit as `thresholdBps`. Intentionally has no
 * knowledge of where the rate came from - the live rate itself now comes
 * from agent/aaveRateOracle.ts (see its doc comment for the independent
 * verification of the Aave ABI it decodes), used by agent/guardian.ts.
 */
export function evaluateRateCondition(condition: RateCondition, currentRateBps: number): boolean {
  switch (condition.comparator) {
    case "gt":
      return currentRateBps > condition.thresholdBps;
    case "gte":
      return currentRateBps >= condition.thresholdBps;
    case "lt":
      return currentRateBps < condition.thresholdBps;
    case "lte":
      return currentRateBps <= condition.thresholdBps;
  }
}
