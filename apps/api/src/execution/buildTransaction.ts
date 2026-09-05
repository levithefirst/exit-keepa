import {
  AAVE_V3_BASE,
  canonicalRoleKey,
  encodeAaveV3WithdrawCalldata,
  resolveWithdrawAmount,
  type ExitAction,
} from "@exit-keepa/shared";
import { HttpError } from "../middleware/errorHandler";

export interface BuiltTransaction {
  /** Target the Safe calls through execTransactionWithRole - always the Aave v3 Base Pool in v1. */
  to: string;
  value: "0";
  data: string;
  operation: 0;
  rolesModifierAddress: string;
  /** Always the canonical Exit Keepa role. Never client-controlled. */
  roleKey: string;
  decodedFunction: string;
  decodedArgs: Record<string, string>;
}

export interface SafeForExecution {
  safeAddress: string;
  chainId: number;
  rolesModifierAddress: string | null;
  /** Legacy database field retained for compatibility; execution ignores it. */
  rolesKey: string | null;
}

/**
 * The single place that turns a stored strategy + its Safe into the exact
 * transaction Exit Keepa will ask KeeperHub to execute. Never accepts a
 * target/function/calldata/role key from a caller - everything here is
 * derived from validated, DB-stored data plus known protocol constants.
 */
export function buildExitTransaction(action: ExitAction, safe: SafeForExecution): BuiltTransaction {
  if (safe.chainId !== AAVE_V3_BASE.chainId) {
    throw new HttpError(
      409,
      `Safe is registered on chainId ${safe.chainId}, but Exit Keepa v1 only supports Base (chainId ${AAVE_V3_BASE.chainId})`,
    );
  }

  if (!safe.rolesModifierAddress) {
    throw new HttpError(409, "Safe has no compatible permission module configured yet");
  }

  const amount = resolveWithdrawAmount(action.amount);
  const data = encodeAaveV3WithdrawCalldata({
    asset: action.asset,
    amount,
    to: safe.safeAddress,
  });

  return {
    to: AAVE_V3_BASE.pool,
    value: "0",
    data,
    operation: 0,
    rolesModifierAddress: safe.rolesModifierAddress,
    roleKey: canonicalRoleKey(),
    decodedFunction: "withdraw(address asset, uint256 amount, address to)",
    decodedArgs: { asset: action.asset, amount: amount.toString(), to: safe.safeAddress },
  };
}
