import { AAVE_V3_BASE, canonicalRoleKey, type ExitAction } from "@exit-keepa/shared";
import { env } from "../env";
import { logger } from "../logger";
import { buildExitTransaction, type SafeForExecution } from "../execution/buildTransaction";
import { simulateExitTransaction } from "../execution/executor";
import { verifyRolesModifier } from "./authorizationTransactions";

export const SELECTORS = { getModulesPaginated: "0xcc2f8452", avatar: "0x5aef7de6", target: "0xd4b83992" } as const;
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";
export type AuthorizationState = "needs_module" | "needs_permission" | "protected";
export interface AuthorizationStatus { state: AuthorizationState; detectedModifierAddress: string | null; enabledModules: string[]; permissionChecked: boolean; undetermined: string | null; summary: string; }

async function rpcCall(to: string, data: string): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
  if (!response.ok) throw new Error("RPC verification failed");
  const body = await response.json() as { result?: string; error?: unknown };
  if (body.error || !body.result) throw new Error("RPC verification failed");
  return body.result;
}
function encodeAddress(address: string): string { return address.slice(2).toLowerCase().padStart(64, "0"); }
function encodeUint(value: bigint): string { return value.toString(16).padStart(64, "0"); }
export function decodeModulesPaginated(hex: string): string[] {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length < 128) return [];
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const arrayStart = offset * 2;
  if (body.length < arrayStart + 64) return [];
  const length = Number(BigInt(`0x${body.slice(arrayStart, arrayStart + 64)}`));
  const modules: string[] = [];
  for (let i = 0; i < length; i++) {
    const start = arrayStart + 64 + i * 64;
    if (body.length < start + 64) break;
    modules.push(`0x${body.slice(start + 24, start + 64)}`);
  }
  return modules;
}
export async function detectZodiacModifier(safeAddress: string): Promise<{ enabledModules: string[]; modifier: string | null }> {
  const raw = await rpcCall(safeAddress, `${SELECTORS.getModulesPaginated}${encodeAddress(SENTINEL_MODULES)}${encodeUint(20n)}`);
  const enabledModules = decodeModulesPaginated(raw);
  for (const moduleAddress of enabledModules) {
    try { if (await verifyRolesModifier(moduleAddress as `0x${string}`, safeAddress as `0x${string}`)) return { enabledModules, modifier: moduleAddress }; }
    catch { /* incompatible or unreadable module, fail closed */ }
  }
  return { enabledModules, modifier: null };
}

export async function readAuthorizationStatus(safe: SafeForExecution & { isSandbox: boolean }, action: ExitAction): Promise<AuthorizationStatus> {
  if (safe.isSandbox) return { state: "protected", detectedModifierAddress: safe.rolesModifierAddress, enabledModules: [], permissionChecked: false, undetermined: null, summary: "This is your private demo sandbox - it's ready to use, and there's nothing to authorize." };
  if (safe.chainId !== AAVE_V3_BASE.chainId) return { state: "needs_module", detectedModifierAddress: null, enabledModules: [], permissionChecked: false, undetermined: "This Safe is not on Base.", summary: "Exit Keepa currently protects Safes on Base only." };

  let enabledModules: string[] = [];
  let modifier: string | null = null;
  try {
    const detected = await detectZodiacModifier(safe.safeAddress);
    enabledModules = detected.enabledModules; modifier = detected.modifier;
  } catch (err) {
    logger.warn({ err, safeAddress: safe.safeAddress }, "Could not inspect Safe modules");
    return { state: "needs_module", detectedModifierAddress: null, enabledModules: [], permissionChecked: false, undetermined: "Could not verify your Safe. Try again.", summary: "We couldn't check your Safe just now. Try again in a moment." };
  }
  if (!modifier) return { state: "needs_module", detectedModifierAddress: null, enabledModules, permissionChecked: false, undetermined: null, summary: "Your Safe needs one additional permission module before Exit Keepa can protect it." };

  const roleKey = canonicalRoleKey();
  let tx;
  try { tx = buildExitTransaction(action, { ...safe, rolesModifierAddress: modifier, rolesKey: roleKey }); }
  catch { return { state: "needs_permission", detectedModifierAddress: modifier, enabledModules, permissionChecked: false, undetermined: "Could not build the required exit. Try again.", summary: "Automatic exits are not enabled yet." }; }
  try {
    const result = await simulateExitTransaction(tx, safe.chainId);
    if (result.parsed?.wouldRevert === false) return { state: "protected", detectedModifierAddress: modifier, enabledModules, permissionChecked: true, undetermined: null, summary: "Exit Keepa is authorized to execute this exit automatically." };
    return { state: "needs_permission", detectedModifierAddress: modifier, enabledModules, permissionChecked: true, undetermined: null, summary: "Your Safe is compatible, but automatic exits are not enabled yet." };
  } catch (err) {
    logger.warn({ err, safeAddress: safe.safeAddress }, "Authorization permission check could not complete");
    return { state: "needs_permission", detectedModifierAddress: modifier, enabledModules, permissionChecked: false, undetermined: "Could not confirm automatic-exit permission. Try again.", summary: "We couldn't confirm your permission just now. Try again in a moment." };
  }
}
