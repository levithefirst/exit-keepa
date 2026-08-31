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

async function rpc(method: string, params: unknown[]): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Base RPC returned HTTP ${response.status}`);
  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Base RPC call failed");
  if (!body.result || body.result === "0x") throw new Error("Aave rate read returned no data");
  return body.result;
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
 * Reads Aave V3's verified getReserveData(address) view directly from the
 * deployed Base Pool. Aave keeps this getter backwards-compatible via
 * ReserveDataLegacy; the supply and variable-borrow rates are words 2 and 4
 * in the ABI-encoded tuple. The selector is independently verified as
 * 0x35ea6a75 against public Aave bindings.
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
