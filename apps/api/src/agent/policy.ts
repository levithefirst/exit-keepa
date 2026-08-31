import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR } from "@exit-keepa/shared";
import type { BuiltTransaction, SafeForExecution } from "../execution/buildTransaction";

/**
 * Deterministic policy check the Guardian runs against every attempted
 * execution before it's ever allowed to reach KeeperHub - pure and
 * side-effect-free so every branch (each individual check failing on its
 * own, and every combination) is directly testable without a database or a
 * live chain call.
 */
export interface PolicyResult {
  policy: Record<string, boolean>;
  policyPassed: boolean;
  refusalReasons: string[];
}

export function checkPolicy(tx: BuiltTransaction | null, safe: SafeForExecution, txBuildError: string | null): PolicyResult {
  const policy = {
    chainAllowed: safe.chainId === AAVE_V3_BASE.chainId,
    rolesConfigured: Boolean(safe.rolesModifierAddress && safe.rolesKey),
    transactionBuildable: tx !== null,
    targetAllowed: tx !== null && tx.to === AAVE_V3_BASE.pool,
    actionAllowed: tx !== null && tx.decodedFunction === "withdraw(address asset, uint256 amount, address to)",
    selectorBound: tx !== null && tx.data.slice(0, 10).toLowerCase() === AAVE_V3_WITHDRAW_SELECTOR.toLowerCase(),
    assetBound: tx !== null && tx.decodedArgs.asset.toLowerCase() === AAVE_V3_BASE.usdc.toLowerCase(),
    recipientBound: tx !== null && tx.decodedArgs.to.toLowerCase() === safe.safeAddress.toLowerCase(),
  };
  const policyPassed = Object.values(policy).every(Boolean);

  const refusalReasons: string[] = [];
  if (txBuildError) refusalReasons.push(`Missing permission - ${txBuildError}`);
  for (const [name, passed] of Object.entries(policy)) {
    if (!passed && name !== "transactionBuildable") refusalReasons.push(`Policy check failed: ${name}`);
  }

  return { policy, policyPassed, refusalReasons };
}
