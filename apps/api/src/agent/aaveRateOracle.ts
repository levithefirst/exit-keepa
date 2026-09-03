import { AAVE_V3_BASE } from "@exit-keepa/shared";
import { env } from "../env";

const GET_RESERVE_DATA_SELECTOR = "0x35ea6a75";
const RAY = 10n ** 27n;
const BPS = 10_000n;

export type AaveRateMetric = "supply_apr" | "borrow_apr";

export interface AaveRateSnapshot {
  chainId: number;
  blockTag: "latest";
  asset: string;
  metric: AaveRateMetric;
  rateBps: number;
  rateRay: string;
  observedAt: string;
}

/** HTTP statuses worth one more attempt: a throttle, or a transient
 * gateway failure at the RPC provider. Anything else is answered as-is. */
const RETRYABLE_HTTP = new Set([429, 502, 503, 504]);

/**
 * A single JSON-RPC call, retried briefly on a throttle or transient
 * gateway error. The public Base endpoint rate-limits, and a 429 that
 * propagated straight out meant the Guardian silently skipped a strategy
 * for that whole tick - the condition went unchecked rather than
 * evaluated, which for a watcher is a real failure and not a cosmetic
 * one. Retries are bounded and short; a persistent failure still throws,
 * because "couldn't read the rate" must never be mistaken for "the
 * condition isn't met".
 */
async function rpc(
  method: string,
  params: unknown[],
  options: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(env.BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

    if (!response.ok) {
      if (RETRYABLE_HTTP.has(response.status) && attempt < attempts) {
        await sleep(attempt * 500);
        continue;
      }
      throw new Error(`Base RPC returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as { result?: string; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? "Base RPC call failed");
    if (!body.result || body.result === "0x") throw new Error("Aave rate read returned no data");
    return body.result;
  }
}

function word(data: string, index: number): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const start = index * 64;
  const value = hex.slice(start, start + 64);
  if (value.length !== 64) throw new Error(`Aave reserve response is missing word ${index}`);
  return BigInt(`0x${value}`);
}

export function decodeAaveRateBps(data: string, metric: AaveRateMetric): { rateRay: bigint; rateBps: number } {
  const hexLength = data.startsWith("0x") ? data.length - 2 : data.length;
  if (hexLength < 15 * 64) throw new Error(`Unexpected Aave reserve response length: ${hexLength / 2} bytes`);
  const rateRay = metric === "supply_apr" ? word(data, 2) : word(data, 4);
  const rateBps = (rateRay * BPS) / RAY;
  if (rateBps > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Aave rate is outside the supported numeric range");
  return { rateRay, rateBps: Number(rateBps) };
}

/**
 * Reads Aave V3's getReserveData(address) view directly from the deployed
 * Base Pool. Independently verified before wiring this into anything that
 * gates a real withdrawal, per this project's own rule about not guessing at
 * an ABI for a value that moves funds:
 *   - Selector 0x35ea6a75 recomputed locally as
 *     keccak256("getReserveData(address)")[:4] via js-sha3, not recalled or
 *     copied from a third party.
 *   - Aave's own IPool.sol (aave-dao/aave-v3-origin) confirms
 *     getReserveData(address) returns exactly DataTypes.ReserveDataLegacy.
 *   - Aave's own DataTypes.sol confirms ReserveDataLegacy's 15 fields in
 *     declaration order, so currentLiquidityRate (the supply rate) is
 *     ABI word 2 and currentVariableBorrowRate (the variable borrow rate)
 *     is word 4 - both ray-denominated (1e27 fixed point), converted to bps
 *     as rateRay * 10_000 / 1e27.
 * Still not a live-chain confirmation (this sandbox's egress proxy blocks
 * direct RPC calls), so treat first production use as the final check, not
 * this comment.
 */
export async function readAaveUsdcRate(metric: AaveRateMetric): Promise<AaveRateSnapshot> {
  const asset = AAVE_V3_BASE.usdc;
  const calldata = `${GET_RESERVE_DATA_SELECTOR}${asset.slice(2).toLowerCase().padStart(64, "0")}`;
  const result = await rpc("eth_call", [{ to: AAVE_V3_BASE.pool, data: calldata }, "latest"]);
  const decoded = decodeAaveRateBps(result, metric);

  return {
    chainId: 8453,
    blockTag: "latest",
    asset,
    metric,
    rateBps: decoded.rateBps,
    rateRay: decoded.rateRay.toString(),
    observedAt: new Date().toISOString(),
  };
}
