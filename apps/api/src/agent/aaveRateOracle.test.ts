import { describe, expect, it } from "vitest";
import { decodeAaveRateBps } from "./aaveRateOracle";

function fixture(supplyRay: bigint, borrowRay: bigint) {
  const words = Array.from({ length: 15 }, () => 0n);
  words[2] = supplyRay;
  words[4] = borrowRay;
  return `0x${words.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

describe("Aave rate oracle decoding", () => {
  it("decodes the supply rate from ReserveData word 2 and converts ray to bps", () => {
    const result = decodeAaveRateBps(fixture(50n * 10n ** 27n / 100n, 0n), "supply_apr");
    expect(result.rateBps).toBe(500);
    expect(result.rateRay).toBe(500000000000000000000000000n);
  });

  it("decodes the variable borrow rate from ReserveData word 4", () => {
    const result = decodeAaveRateBps(fixture(0n, 125n * 10n ** 27n / 100n), "borrow_apr");
    expect(result.rateBps).toBe(1250);
  });

  it("fails closed on a truncated response", () => {
    expect(() => decodeAaveRateBps("0x00", "supply_apr")).toThrow(/Unexpected Aave reserve response length/);
  });
});
