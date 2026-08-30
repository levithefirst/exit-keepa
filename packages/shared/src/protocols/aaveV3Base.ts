/**
 * Aave v3 on Base — the one protocol/action Exit Keepa v1 supports.
 *
 * Addresses are cross-checked against bgd-labs/aave-address-book
 * (AaveV3Base.sol, the canonical address list Aave Labs itself maintains),
 * fetched directly rather than recalled. The `withdraw` selector was
 * computed locally via keccak256("withdraw(address,uint256,address)"),
 * not guessed.
 *
 * Exit action: withdraw(asset, amount, to) on the Aave v3 Pool. This
 * requires the Safe to already hold the corresponding aToken (i.e. the
 * user must have separately supplied USDC to Aave); no `approve` step is
 * needed because aToken burn is internal to the Pool contract.
 */

export const AAVE_V3_BASE = {
  chainId: 8453,
  /** Aave: Pool Proxy (Base). Source: bgd-labs/aave-address-book AaveV3Base.sol POOL. */
  pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  /** USDC (Base). Matches Aave's own USDC_UNDERLYING constant for this market. */
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

/** withdraw(address,uint256,address) — computed via keccak256, verified independently of memory. */
export const AAVE_V3_WITHDRAW_SELECTOR = "0x69328dec";

/** Aave convention: passing type(uint256).max withdraws the caller's entire aToken balance. */
export const WITHDRAW_MAX_UINT256 = (2n ** 256n - 1n).toString();

function encodeAddressParam(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUint256Param(value: bigint): string {
  if (value < 0n || value > 2n ** 256n - 1n) {
    throw new Error(`uint256 out of range: ${value}`);
  }
  return value.toString(16).padStart(64, "0");
}

export interface AaveV3WithdrawParams {
  /** Reserve underlying to withdraw. v1 only supports Base USDC. */
  asset: string;
  /** Amount in the asset's smallest unit, or the literal max-uint256 sentinel for "withdraw all". */
  amount: bigint;
  /** Recipient — must be the Safe itself; Exit Keepa never routes withdrawals elsewhere. */
  to: string;
}

/**
 * Deterministically builds the exact calldata for Pool.withdraw(asset, amount, to).
 * Throws rather than encoding anything for an asset other than Base USDC, so a
 * strategy can never be silently pointed at an unsupported reserve.
 */
export function encodeAaveV3WithdrawCalldata(params: AaveV3WithdrawParams): string {
  if (params.asset.toLowerCase() !== AAVE_V3_BASE.usdc.toLowerCase()) {
    throw new Error(`Unsupported asset ${params.asset} — Exit Keepa v1 only supports Base USDC`);
  }
  return (
    AAVE_V3_WITHDRAW_SELECTOR +
    encodeAddressParam(params.asset) +
    encodeUint256Param(params.amount) +
    encodeAddressParam(params.to)
  );
}

/** Resolves the strategy's stored amount spec into the bigint passed to the encoder. */
export function resolveWithdrawAmount(amount: "max" | string): bigint {
  if (amount === "max") return BigInt(WITHDRAW_MAX_UINT256);
  const parsed = BigInt(amount);
  if (parsed <= 0n) throw new Error("Withdraw amount must be positive");
  return parsed;
}
