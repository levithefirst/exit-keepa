import {
  AAVE_V3_BASE,
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
  roleKey: string;
  decodedFunction: string;
  decodedArgs: Record<string, string>;
}

export interface SafeForExecution {
  safeAddress: string;
  rolesModifierAddress: string | null;
  rolesKey: string | null;
}

/**
 * The single place that turns a stored strategy + its Safe into the exact
 * transaction Exit Keepa will ask KeeperHub to execute. Never accepts a
 * target/function/calldata from a caller - everything here is derived from
 * validated, DB-stored data (the strategy's `action`, already constrained
 * by exitActionSchema to Aave v3 Base USDC withdraw) plus known protocol
 * constants. This is what makes a strategy's transaction reconstructible
 * deterministically at any later point, and what keeps a compromised or
 * buggy frontend from ever steering an arbitrary call through the Safe.
 */
export function buildExitTransaction(action: ExitAction, safe: SafeForExecution): BuiltTransaction {
  if (!safe.rolesModifierAddress || !safe.rolesKey) {
    throw new HttpError(409, "Safe has no Roles Modifier / role key configured yet");
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
    roleKey: safe.rolesKey,
    decodedFunction: "withdraw(address asset, uint256 amount, address to)",
    decodedArgs: { asset: action.asset, amount: amount.toString(), to: safe.safeAddress },
  };
}
