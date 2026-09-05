import { AAVE_V3_BASE, type ExitAction } from "@exit-keepa/shared";
import { logger } from "../logger";
import { type SafeForExecution } from "../execution/buildTransaction";
import { inspectEnabledModules, classifyRolesModule, readRolePermissionState, verifyNegativeRoleProbes, KEEPERHUB_EXECUTION_SENDER } from "./authorizationTransactions";

export const SELECTORS = { getModulesPaginated: "0xcc2f8452", avatar: "0x5aef7de6", target: "0xd4b83992" } as const;
export type AuthorizationState = "needs_module" | "needs_permission" | "protected";
export interface AuthorizationStatus { state: AuthorizationState; detectedModifierAddress: string | null; enabledModules: string[]; permissionChecked: boolean; undetermined: string | null; summary: string; }

export async function detectZodiacModifier(safeAddress: string): Promise<{ enabledModules: string[]; modifier: string | null; incompatibleRoles: boolean }> {
  const enabledModules = await inspectEnabledModules(safeAddress as `0x${string}`); let modifier: string | null = null; let incompatibleRoles = false;
  for (const moduleAddress of enabledModules) {
    const classification = await classifyRolesModule(moduleAddress as `0x${string}`, safeAddress as `0x${string}`);
    if (classification === "compatible") modifier = moduleAddress;
    if (classification === "incompatible_roles") incompatibleRoles = true;
  }
  return { enabledModules, modifier, incompatibleRoles };
}

export async function readAuthorizationStatus(safe: SafeForExecution & { isSandbox: boolean }, _action: ExitAction): Promise<AuthorizationStatus> {
  if (safe.isSandbox) return { state: "protected", detectedModifierAddress: safe.rolesModifierAddress, enabledModules: [], permissionChecked: false, undetermined: null, summary: "This is your private demo sandbox - it is ready to use, and there is nothing to authorize." };
  if (safe.chainId !== AAVE_V3_BASE.chainId) return { state: "needs_module", detectedModifierAddress: null, enabledModules: [], permissionChecked: false, undetermined: "This Safe is not on Base.", summary: "Exit Keepa currently protects Safes on Base only." };

  try {
    const detected = await detectZodiacModifier(safe.safeAddress);
    if (!detected.modifier) {
      if (detected.incompatibleRoles) return { state: "needs_module", detectedModifierAddress: null, enabledModules: detected.enabledModules, permissionChecked: false, undetermined: "An incompatible permission module is already enabled. Exit Keepa will not install another one.", summary: "This Safe cannot be protected without resolving its existing permission module." };
      return { state: "needs_module", detectedModifierAddress: null, enabledModules: detected.enabledModules, permissionChecked: false, undetermined: null, summary: "Your Safe needs one additional permission module before Exit Keepa can protect it." };
    }
    const keeper = KEEPERHUB_EXECUTION_SENDER as `0x${string}`;
    const permission = await readRolePermissionState(detected.modifier as `0x${string}`, safe.safeAddress as `0x${string}`, keeper);
    if (!permission.exact) return { state: "needs_permission", detectedModifierAddress: detected.modifier, enabledModules: detected.enabledModules, permissionChecked: true, undetermined: null, summary: "Your Safe is compatible, but automatic exits are not enabled yet." };
    if (!(await verifyNegativeRoleProbes(detected.modifier as `0x${string}`, safe.safeAddress as `0x${string}`, keeper))) return { state: "needs_permission", detectedModifierAddress: detected.modifier, enabledModules: detected.enabledModules, permissionChecked: true, undetermined: "The configured permission did not pass its security probes.", summary: "Automatic exits are not enabled." };
    return { state: "protected", detectedModifierAddress: detected.modifier, enabledModules: detected.enabledModules, permissionChecked: true, undetermined: null, summary: "Exit Keepa is authorized to execute this exit automatically." };
  } catch (err) {
    logger.warn({ err, safeAddress: safe.safeAddress }, "Could not verify Safe authorization state");
    return { state: "needs_module", detectedModifierAddress: safe.rolesModifierAddress, enabledModules: [], permissionChecked: false, undetermined: "Could not verify your Safe. Try again.", summary: "We could not verify your Safe just now." };
  }
}
