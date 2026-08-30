import type { RateCondition } from "@exit-keepa/shared";

/**
 * Pure comparator logic for a RateCondition against a rate expressed in
 * the same basis-points unit as `thresholdBps`. Intentionally has no
 * knowledge of where the rate came from - see routes/executions.ts and
 * README "Known limitations" for why live on-chain rate reads aren't
 * wired up in v1 (the deployed Aave Pool's exact ReserveData ABI version
 * on Base wasn't independently verified, and guessing a struct layout for
 * a value that gates fund movement is exactly the kind of guess this
 * project forbids).
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
