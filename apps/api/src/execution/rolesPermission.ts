import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR, buildRolesSafeAppUrl } from "@exit-keepa/shared";

/**
 * Describes (but never encodes/broadcasts) the minimal Zodiac Roles
 * permission a Safe needs for Exit Keepa's withdraw action, and points to
 * the official Zodiac Roles app to actually create it.
 *
 * Why this doesn't hand-encode the on-chain scopeTarget/scopeFunction
 * calldata itself: `scopeFunction`'s `ConditionFlat[]` parameter is a
 * flattened condition tree (parent-index + ABI-encoded compValue per
 * node). Zodiac's own SDK (`zodiac-roles-sdk`, packages/sdk/src/main)
 * does not expose a simple "give me the raw calldata" function for
 * this - its `postRole`/diffing machinery computes the permission delta
 * and hands it to the hosted Zodiac Roles app (roles.gnosisguild.org),
 * which is itself a Safe App that produces and submits the exact
 * scopeTarget/scopeFunction transaction through the Safe's own signing
 * flow. That's the audited, maintained path for a permission that gates
 * fund movement - hand-rolling the byte encoding here, with no way to
 * cross-check it against the real contract before broadcast, is exactly
 * the kind of guess this project has avoided all session.
 */
export interface RolesPermissionSpec {
  roleKey: string;
  target: string;
  targetLabel: string;
  selector: string;
  functionSignature: string;
  conditions: Array<{ param: string; type: string; rule: string }>;
  executionOptions: "None (no value, no delegatecall)";
  /** Deep link into Safe{Wallet}'s UI, opening the official Zodiac Roles Safe App for this exact Safe. */
  safeAppUrl: string;
  note: string;
  /** True when this Safe has no Roles Modifier at all yet (the bigger, one-time step); false when the
   * Modifier already exists and only this specific permission still needs adding. The frontend uses this
   * to pick copy/steps instead of pattern-matching `note`'s text. */
  needsModifier: boolean;
  /** True for a demo session's own private, auto-provisioned sandbox Safe (see
   * routes/auth.ts's POST /api/auth/demo-session and /auth/signup) - never a real
   * deployed Safe. The frontend (RolesSetupPanel) uses this to hard-gate against
   * ever showing the real-Safe setup wall or a live link to app.safe.global for a
   * sandbox Safe, regardless of what rolesModifierAddress/needsModifier say. */
  isSandbox: boolean;
}

export function buildRolesPermissionSpec(params: {
  chainId: number;
  safeAddress: string;
  rolesModifierAddress: string | null;
  roleKey: string | null;
  isSandbox: boolean;
}): RolesPermissionSpec {
  const safeAppUrl = buildRolesSafeAppUrl(params.chainId, params.safeAddress);

  return {
    roleKey: params.roleKey ?? "(choose a role key when enabling Roles for this Safe, e.g. in the Zodiac Roles app)",
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
    safeAppUrl,
    note: params.rolesModifierAddress
      ? "Open the official Zodiac Roles app (as a Safe App, so your Safe's own signers approve it) and add exactly this permission for the role key above. Exit Keepa does not submit this transaction on your behalf."
      : "This Safe has no Roles Modifier enabled yet. Enable Zodiac's Roles Modifier on this Safe first (also done through the Zodiac Roles app), then add the permission described here.",
    needsModifier: !params.rolesModifierAddress,
    isSandbox: params.isSandbox,
  };
}
