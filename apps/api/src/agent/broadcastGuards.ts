import { env } from "../env";

/**
 * Base aUSDC (the interest-bearing token representing a supplied USDC
 * position on Aave v3 Base) - source: bgd-labs/aave-address-book
 * AaveV3BaseAssets.USDC.A_TOKEN, the same canonical source
 * @exit-keepa/shared's protocols/aaveV3Base.ts already cites for the Pool
 * and USDC addresses. Used read-only here (balanceOf), never to build a
 * transaction - this sandbox's egress proxy blocks a live RPC call, so
 * treat first production use as the final cross-check, same caveat as
 * agent/aaveRateOracle.ts.
 */
export const AAVE_V3_BASE_AUSDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";

const BALANCE_OF_SELECTOR = "0x70a08231";

async function rpc(method: string, params: unknown[]): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Base RPC returned HTTP ${response.status}`);
  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Base RPC call failed");
  return body.result ?? "0x0";
}

/** Reads the Safe's live aUSDC balance - the actual current size of its Aave USDC position. */
export async function readAaveUsdcPositionBalance(safeAddress: string): Promise<bigint> {
  const padded = safeAddress.slice(2).toLowerCase().padStart(64, "0");
  const result = await rpc("eth_call", [{ to: AAVE_V3_BASE_AUSDC, data: BALANCE_OF_SELECTOR + padded }, "latest"]);
  return BigInt(result);
}

export interface StalenessCheckInput {
  /** When the decision that approved this execution was made. Null if this
   *  execution wasn't created by the Guardian (e.g. the older manual-rate
   *  flow) - staleness only applies to a Guardian decision's own latency. */
  decisionCreatedAt: Date | null;
  strategyUpdatedAt: Date;
  now: Date;
  maxAgeMs: number;
}

export interface BroadcastGuardResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Refuses a broadcast whose approving decision is either too old (the live
 * state that justified it may no longer hold) or whose strategy was edited
 * after the decision was made (the decision was made against a condition or
 * action that no longer exists). Deliberately does not compare against
 * anything on the execution row itself - `strategyUpdatedAt` and
 * `decisionCreatedAt` are both independent of any DB write this specific
 * broadcast attempt makes, so this can't be defeated by racing the check.
 */
export function checkStaleIntent(input: StalenessCheckInput): BroadcastGuardResult {
  if (!input.decisionCreatedAt) return { blocked: false };

  if (input.strategyUpdatedAt.getTime() > input.decisionCreatedAt.getTime()) {
    return {
      blocked: true,
      reason: "Stale intent: the strategy was edited after this execution's approving decision was made",
    };
  }

  const ageMs = input.now.getTime() - input.decisionCreatedAt.getTime();
  if (ageMs > input.maxAgeMs) {
    return {
      blocked: true,
      reason: `Stale intent: the approving decision is ${Math.round(ageMs / 1000)}s old, older than the ${Math.round(input.maxAgeMs / 1000)}s freshness window`,
    };
  }

  return { blocked: false };
}

/**
 * Refuses a broadcast configured for an exact amount that the Safe's live
 * Aave position can no longer cover (e.g. an earlier manual or external
 * withdrawal shrank it since the strategy was created). A "max" amount is
 * never checked here - Aave's own max-uint256 convention already
 * self-limits to whatever the real balance is.
 */
export function checkAmountExceeded(configuredAmount: bigint, livePositionBalance: bigint): BroadcastGuardResult {
  if (configuredAmount > livePositionBalance) {
    return {
      blocked: true,
      reason: `Amount exceeded: strategy is configured to withdraw ${configuredAmount.toString()} but the live Aave position only holds ${livePositionBalance.toString()}`,
    };
  }
  return { blocked: false };
}
