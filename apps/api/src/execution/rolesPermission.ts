import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR, canonicalRoleKey } from "@exit-keepa/shared";

export type RolesSetupState = "modifier_missing" | "permission_missing" | "ready";
export interface RolesPermissionSpec {
  /** Technical/debug representation only. Always Exit Keepa's canonical key. */
  roleKey: string;
  target: string;
  targetLabel: string;
  selector: string;
  functionSignature: string;
  conditions: Array<{ param: string; type: string; rule: string }>;
  executionOptions: "None (no value, no delegatecall)";
  /** Retained for API compatibility. The live authorization path never uses setup links. */
  safeAppUrl: string;
  /** Retained for API compatibility. The live authorization path never uses setup links. */
  zodiacAppUrl: string;
  setupState: RolesSetupState;
  note: string;
  needsModifier: boolean;
  isSandbox: boolean;
}

export function buildRolesPermissionSpec(params: {
  chainId: number;
  safeAddress: string;
  rolesModifierAddress: string | null;
  /** Legacy input retained for API compatibility; it is ignored. */
  roleKey?: string | null;
  isSandbox: boolean;
  executable?: boolean;
}): RolesPermissionSpec {
  const hasModifier = Boolean(params.rolesModifierAddress);
  const setupState: RolesSetupState = !hasModifier ? "modifier_missing" : params.executable === true ? "ready" : "permission_missing";

  return {
    roleKey: canonicalRoleKey(),
    target: AAVE_V3_BASE.pool,
    targetLabel: "Aave v3 Pool (Base)",
    selector: AAVE_V3_WITHDRAW_SELECTOR,
    functionSignature: "withdraw(address asset, uint256 amount, address to)",
    conditions: [
      { param: "asset", type: "address", rule: `equals ${AAVE_V3_BASE.usdc} (USDC)` },
      { param: "amount", type: "uint256", rule: "unrestricted" },
      { param: "to", type: "address", rule: `equals ${params.safeAddress} (this Safe)` },
    ],
    executionOptions: "None (no value, no delegatecall)",
    safeAppUrl: "",
    zodiacAppUrl: "",
    setupState,
    note: hasModifier
      ? "Exit Keepa can configure this permission directly through the Safe owner signing flow."
      : "This Safe has no compatible permission module yet. Exit Keepa will install one after the Safe owner approves the required transactions.",
    needsModifier: !hasModifier,
    isSandbox: params.isSandbox,
  };
}
