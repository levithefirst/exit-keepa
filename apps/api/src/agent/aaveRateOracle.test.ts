import { describe, expect, it } from "vitest";
import { decodeAaveRateBps } from "./aaveRateOracle";

const RAY = 10n ** 27n;

/** Ray (1e27 fixed point) is Aave's own representation: 1 ray = 100%. Going
 *  through bps -> ray -> bps (rather than hand-picking a "round" ray value)
 *  is what caught the original fixture bug here: `50n * 10n ** 27n / 100n`
 *  reads as "50%", not "500 bps" (5%) - it produced a real supply rate of
 *  5000 bps, which the original assertion (500) got wrong by exactly 10x. */
function bpsToRay(bps: number): bigint {
  return (BigInt(bps) * RAY) / 10_000n;
}

function fixture(supplyRay: bigint, borrowRay: bigint) {
  const words = Array.from({ length: 15 }, () => 0n);
  words[2] = supplyRay;
  words[4] = borrowRay;
  return `0x${words.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

describe("Aave rate oracle decoding", () => {
  it("decodes the supply rate from ReserveData word 2 and converts ray to bps", () => {
    const result = decodeAaveRateBps(fixture(bpsToRay(500), 0n), "supply_apr");
    expect(result.rateBps).toBe(500);
    expect(result.rateRay).toBe(bpsToRay(500));
  });

  it("decodes the variable borrow rate from ReserveData word 4, independent of the supply rate in word 2", () => {
    const result = decodeAaveRateBps(fixture(bpsToRay(500), bpsToRay(1250)), "borrow_apr");
    expect(result.rateBps).toBe(1250);
  });

  it("round-trips a rate at the edge of a whole percent without truncation drift", () => {
    const result = decodeAaveRateBps(fixture(bpsToRay(10_000), 0n), "supply_apr");
    expect(result.rateBps).toBe(10_000);
  });

  it("fails closed on a truncated response", () => {
    expect(() => decodeAaveRateBps("0x00", "supply_apr")).toThrow(/Unexpected Aave reserve response length/);
  });

  it("fails closed on a response that is a few bytes short of a full 15-word tuple", () => {
    const truncated = fixture(bpsToRay(500), 0n).slice(0, -4);
    expect(() => decodeAaveRateBps(truncated, "supply_apr")).toThrow(/Unexpected Aave reserve response length/);
  });
});
