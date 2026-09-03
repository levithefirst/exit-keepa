import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAaveRateBps, readAaveUsdcRate } from "./aaveRateOracle";

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

describe("Aave rate oracle - surviving a throttled RPC", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A 429 from the public Base endpoint used to propagate straight out of
   * readAaveUsdcRate, which meant the Guardian skipped that strategy for
   * the whole tick - the condition went unchecked rather than evaluated.
   * Observed live in production (Railway, 2026-09-03): "Base RPC returned
   * HTTP 429" on every tick, and no strategy was ever evaluated. */
  it("retries a 429 and succeeds on the next attempt", async () => {
    const words = Array.from({ length: 15 }, () => 0n);
    words[2] = (500n * 10n ** 27n) / 10_000n; // 5.00% supply APR
    const okBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: `0x${words.map((w) => w.toString(16).padStart(64, "0")).join("")}`,
    });

    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("rate limited", { status: 429 });
        return new Response(okBody, { status: 200 });
      }),
    );

    const snapshot = await readAaveUsdcRate("supply_apr");
    expect(calls).toBe(2);
    expect(snapshot.rateBps).toBe(500);
  });

  it("still throws once the retries are exhausted - a rate that could not be read is never mistaken for a condition that is not met", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(readAaveUsdcRate("supply_apr")).rejects.toThrow(/HTTP 429/);
  });

  it("does not retry a non-transient error", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("nope", { status: 400 });
      }),
    );
    await expect(readAaveUsdcRate("supply_apr")).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });
});
