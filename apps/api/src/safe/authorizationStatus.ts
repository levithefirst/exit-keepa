import { AAVE_V3_BASE, type ExitAction } from "@exit-keepa/shared";
import { logger } from "../logger";
import { type SafeForExecution } from "../execution/buildTransaction";
import { inspectEnabledModules, classifyRolesModules, readRolePermissionState, verifyNegativeRoleProbes, KEEPERHUB_EXECUTION_SENDER } from "./authorizationTransactions";

export const SELECTORS = { getModulesPaginated: "0xcc2f8452", avatar: "0x5aef7de6", target: "0xd4b83992" } as const;
export type AuthorizationState = "needs_module" | "needs_permission" | "protected" | "undetermined";
export interface AuthorizationStatus { state: AuthorizationState; detectedModifierAddress: string | null; enabledModules: string[]; permissionChecked: boolean; undetermined: string | null; summary: string; }
export function decodeModulesPaginated(hex: string): string[] { const body = hex.startsWith("0x") ? hex.slice(2) : hex; if (body.length < 128) return []; const offset = Number(BigInt(`0x${body.slice(0, 64)}`)); const arrayStart = offset * 2; if (body.length < arrayStart + 64) return []; const length = Number(BigInt(`0x${body.slice(arrayStart, arrayStart + 64)}`)); const modules: string[] = []; for (let i = 0; i < length; i++) { const start = arrayStart + 64 + i * 64; if (body.length < start + 64) break; modules.push(`0x${body.slice(start + 24, start + 64)}`); } return modules; }
export async function detectZodiacModifier(safeAddress: string): Promise<{ enabledModules: string[]; modifier: string | null; incompatibleRoles: boolean }> { const enabledModules = await inspectEnabledModules(safeAddress as `0x${string}`); /* Every module is classified in one batched round trip rather than a few calls each - the same reads, far fewer chances to be throttled mid-verification. */ const classifications = await classifyRolesModules(enabledModules as `0x${string}`[], safeAddress as `0x${string}`); let modifier: string | null = null; let incompatibleRoles = false; for (const moduleAddress of enabledModules) { const classification = classifications.get(moduleAddress.toLowerCase()); if (classification === "compatible") modifier = moduleAddress; if (classification === "incompatible_roles") incompatibleRoles = true; } return { enabledModules, modifier, incompatibleRoles }; }
export interface ReadAuthorizationOptions {
  /**
   * Whether to adversarially probe the configured permission - sending a
   * wrong asset, a wrong recipient, a non-zero value, a foreign selector
   * and a delegatecall, and requiring the Roles modifier to reject all
   * five. Defaults to true, and stays true on every path that leads to
   * moving funds: readProtectionState, requireProtectedSafe, activation
   * and every Guardian tick.
   *
   * A read-only status display may pass false. That does NOT relax what
   * counts as protected: readRolePermissionState still has to find the
   * exact on-chain Roles storage - the keeper assigned to the canonical
   * role, the target scoped to the Aave pool, and the function scoped to
   * withdraw with the USDC asset and this same Safe as recipient. The
   * probes are five more eth_calls confirming the negative space around
   * that, and skipping them keeps a dashboard read inside a public RPC's
   * budget without ever letting an unverified Safe read as protected.
   */
  requireProbes?: boolean;
}

export async function readAuthorizationStatus(safe: SafeForExecution & { isSandbox: boolean }, _action: ExitAction, options: ReadAuthorizationOptions = {}): Promise<AuthorizationStatus> {
  const requireProbes = options.requireProbes ?? true;
  if (safe.isSandbox) return { state: "protected", detectedModifierAddress: safe.rolesModifierAddress, enabledModules: [], permissionChecked: false, undetermined: null, summary: "This is your private demo sandbox - it is ready to use, and there is nothing to authorize." };
  if (safe.chainId !== AAVE_V3_BASE.chainId) return { state: "undetermined", detectedModifierAddress: null, enabledModules: [], permissionChecked: false, undetermined: "This Safe is not on Base.", summary: "Exit Keepa currently protects Safes on Base only." };
  try {
    const detected = await detectZodiacModifier(safe.safeAddress);
    if (!detected.modifier) { if (detected.incompatibleRoles) return { state: "needs_module", detectedModifierAddress: null, enabledModules: detected.enabledModules, permissionChecked: false, undetermined: "An incompatible permission module is already enabled. Exit Keepa will not install another one.", summary: "This Safe cannot be protected without resolving its existing permission module." }; return { state: "needs_module", detectedModifierAddress: null, enabledModules: detected.enabledModules, permissionChecked: false, undetermined: null, summary: "Your Safe needs one additional permission module before Exit Keepa can protect it." }; }
    const keeper = KEEPERHUB_EXECUTION_SENDER as `0x${string}`; const permission = await readRolePermissionState(detected.modifier as `0x${string}`, safe.safeAddress as `0x${string}`, keeper);
    if (!permission.exact) return { state: "needs_permission", detectedModifierAddress: detected.modifier, enabledModules: detected.enabledModules, permissionChecked: true, undetermined: null, summary: "Your Safe is compatible, but automatic exits are not enabled yet." };
    if (requireProbes && !(await verifyNegativeRoleProbes(detected.modifier as `0x${string}`, safe.safeAddress as `0x${string}`, keeper))) return { state: "needs_permission", detectedModifierAddress: detected.modifier, enabledModules: detected.enabledModules, permissionChecked: true, undetermined: "The configured permission did not pass its security probes.", summary: "Automatic exits are not enabled." };
    return { state: "protected", detectedModifierAddress: detected.modifier, enabledModules: detected.enabledModules, permissionChecked: true, undetermined: null, summary: "Exit Keepa is authorized to execute this exit automatically." };
  } catch (err) { logger.warn({ err, safeAddress: safe.safeAddress }, "Could not verify Safe authorization state"); return { state: "undetermined", detectedModifierAddress: null, enabledModules: [], permissionChecked: false, undetermined: `Could not verify your Safe. Try again. (${(err as Error).message})`, summary: "We could not verify your Safe just now." }; }
}

/** The one action Exit Keepa is ever authorized to take - every protection check is read against exactly it. */
const PROTECTION_PROBE: ExitAction = { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" };

export type SafeForProtectionCheck = SafeForExecution & { isSandbox: boolean };

/**
 * Live, fail-closed protection check. A stored `rolesModifierAddress` only
 * records what a past read saw; this re-reads the exact on-chain Roles
 * configuration, so a Safe whose permission was revoked, re-pointed, or
 * never finished being configured stops counting as protected immediately.
 * Sandbox Safes short-circuit inside readAuthorizationStatus without ever
 * touching the chain. Any read failure lands on `undetermined`, which is
 * not protected.
 */
export async function readProtectionState(safe: SafeForProtectionCheck): Promise<{ isProtected: boolean; status: AuthorizationStatus }> {
  const status = await readAuthorizationStatus(safe, PROTECTION_PROBE);
  return { isProtected: status.state === "protected", status };
}
