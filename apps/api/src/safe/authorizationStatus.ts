import { AAVE_V3_BASE, type ExitAction } from "@exit-keepa/shared";
import { env } from "../env";
import { logger } from "../logger";
import { buildExitTransaction, type SafeForExecution } from "../execution/buildTransaction";
import { simulateExitTransaction } from "../execution/executor";

/**
 * Function selectors used to read a Safe's module configuration. Every one
 * computed locally via viem's toFunctionSelector (keccak256 of the
 * signature), never recalled or copied - and re-derived in
 * authorizationStatus.test.ts so a typo here fails a test rather than
 * silently reading the wrong storage.
 *
 * `avatar()` and `target()` are the Zodiac Modifier interface's own
 * invariants: a Zodiac module configured for a Safe returns that Safe's
 * address from both. That pair is what identifies "this enabled module is
 * a Zodiac modifier wired to this Safe" without needing the Roles
 * mastercopy address, which this project has no way to verify from here.
 */
export const SELECTORS = {
  getModulesPaginated: "0xcc2f8452",
  avatar: "0x5aef7de6",
  target: "0xd4b83992",
} as const;

/** The sentinel Safe's linked module list starts and ends with. */
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";

/**
 * The three states a real Safe can be in, derived from actual chain state
 * rather than from what happens to be stored in Exit Keepa's database.
 *
 * - `needs_module`: the Safe has no Zodiac modifier enabled. Nothing Exit
 *   Keepa can do for it yet.
 * - `needs_permission`: a modifier is enabled, but the exact Aave
 *   withdrawal Exit Keepa would perform is not permitted through it.
 * - `protected`: that exact withdrawal is permitted. Exit Keepa can act.
 */
export type AuthorizationState = "needs_module" | "needs_permission" | "protected";

export interface AuthorizationStatus {
  state: AuthorizationState;
  /** The Zodiac modifier found enabled on this Safe, if any - detected, never typed in. */
  detectedModifierAddress: string | null;
  /** Every module the Safe currently has enabled, for the technical-details view. */
  enabledModules: string[];
  /** True when the permission proof actually ran (rather than being skipped or failing). */
  permissionChecked: boolean;
  /** Set when the status could not be fully determined - never silently treated as "protected". */
  undetermined: string | null;
  /** Plain-English summary of exactly what this Safe still needs. */
  summary: string;
}

async function rpcCall(to: string, data: string): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!response.ok) throw new Error(`Base RPC returned HTTP ${response.status}`);
  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Base RPC call failed");
  return body.result ?? "0x";
}

function encodeAddress(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** Reads one 32-byte word out of an ABI-encoded response as an address. */
function wordAsAddress(hex: string, wordIndex: number): string {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const word = body.slice(wordIndex * 64, wordIndex * 64 + 64);
  return `0x${word.slice(24)}`;
}

/**
 * Decodes Safe's `getModulesPaginated` return value: `(address[] array,
 * address next)`. Head is [offset_to_array, next]; the array itself is
 * [length, ...items].
 */
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

/**
 * True when this enabled module is a Zodiac modifier wired to this exact
 * Safe - both `avatar()` and `target()` must return the Safe's own
 * address. A module that doesn't implement those (a plain Safe module, a
 * recovery module) simply fails the call and is skipped.
 */
async function isZodiacModifierFor(moduleAddress: string, safeAddress: string): Promise<boolean> {
  try {
    const [avatar, target] = await Promise.all([
      rpcCall(moduleAddress, SELECTORS.avatar),
      rpcCall(moduleAddress, SELECTORS.target),
    ]);
    const safe = safeAddress.toLowerCase();
    return wordAsAddress(avatar, 0).toLowerCase() === safe && wordAsAddress(target, 0).toLowerCase() === safe;
  } catch {
    return false;
  }
}

/** Reads the Safe's enabled modules and returns the first Zodiac modifier wired to it. */
export async function detectZodiacModifier(
  safeAddress: string,
): Promise<{ enabledModules: string[]; modifier: string | null }> {
  const data = `${SELECTORS.getModulesPaginated}${encodeAddress(SENTINEL_MODULES)}${encodeUint(20n)}`;
  const raw = await rpcCall(safeAddress, data);
  const enabledModules = decodeModulesPaginated(raw);

  for (const moduleAddress of enabledModules) {
    if (await isZodiacModifierFor(moduleAddress, safeAddress)) {
      return { enabledModules, modifier: moduleAddress };
    }
  }
  return { enabledModules, modifier: null };
}

/**
 * The authoritative answer to "can Exit Keepa execute this Safe's exit
 * right now?", read from the chain rather than inferred from what's in
 * Exit Keepa's own database.
 *
 * The permission half deliberately reuses the canonical execution
 * machinery instead of trying to read Zodiac's permission storage
 * directly: it rebuilds the exact transaction with buildExitTransaction
 * and dry-runs it with simulateExitTransaction (`simulate: true`, never a
 * broadcast). If that exact call would go through, the Safe is authorized
 * for exactly the thing Exit Keepa would do - and if it wouldn't, no
 * amount of correct-looking Roles configuration matters. There is no
 * second permission model here, and no attempt to decode Zodiac's
 * ConditionFlat storage, which this project has never had a way to
 * cross-check.
 *
 * Fails closed: anything it cannot determine is reported as undetermined
 * with the reason, never as `protected`.
 */
export async function readAuthorizationStatus(
  safe: SafeForExecution & { isSandbox: boolean },
  action: ExitAction,
): Promise<AuthorizationStatus> {
  // A demo session's sandbox Safe exists on no chain. It is authorized by
  // construction and must never be sent into a real Safe authorization
  // flow, a real RPC read, or a real KeeperHub call.
  if (safe.isSandbox) {
    return {
      state: "protected",
      detectedModifierAddress: safe.rolesModifierAddress,
      enabledModules: [],
      permissionChecked: false,
      undetermined: null,
      summary: "This is your private demo sandbox - it's ready to use, and there's nothing to authorize.",
    };
  }

  if (safe.chainId !== AAVE_V3_BASE.chainId) {
    return {
      state: "needs_module",
      detectedModifierAddress: null,
      enabledModules: [],
      permissionChecked: false,
      undetermined: `This Safe is registered on chain ${safe.chainId}; Exit Keepa currently protects Base only.`,
      summary: "Exit Keepa currently protects Safes on Base only.",
    };
  }

  let enabledModules: string[] = [];
  let modifier: string | null = null;
  try {
    const detected = await detectZodiacModifier(safe.safeAddress);
    enabledModules = detected.enabledModules;
    modifier = detected.modifier;
  } catch (err) {
    return {
      state: "needs_module",
      detectedModifierAddress: null,
      enabledModules: [],
      permissionChecked: false,
      undetermined: `Couldn't read this Safe's settings from Base right now: ${(err as Error).message}`,
      summary: "We couldn't check your Safe just now. This is usually temporary - try again in a moment.",
    };
  }

  if (!modifier) {
    return {
      state: "needs_module",
      detectedModifierAddress: null,
      enabledModules,
      permissionChecked: false,
      undetermined: null,
      summary: "Your Safe hasn't authorized Exit Keepa yet. This is a one-time setup.",
    };
  }

  // A modifier is enabled. Does it actually permit the one withdrawal Exit
  // Keepa would perform? Answered by dry-running that exact transaction.
  const roleKey = safe.rolesKey;
  if (!roleKey) {
    return {
      state: "needs_permission",
      detectedModifierAddress: modifier,
      enabledModules,
      permissionChecked: false,
      undetermined: null,
      summary: "Your Safe is set up, but Exit Keepa hasn't been granted permission to perform this exit yet.",
    };
  }

  let tx;
  try {
    tx = buildExitTransaction(action, { ...safe, rolesModifierAddress: modifier, rolesKey: roleKey });
  } catch (err) {
    return {
      state: "needs_permission",
      detectedModifierAddress: modifier,
      enabledModules,
      permissionChecked: false,
      undetermined: (err as Error).message,
      summary: "Your Safe is set up, but Exit Keepa hasn't been granted permission to perform this exit yet.",
    };
  }

  try {
    const result = await simulateExitTransaction(tx, safe.chainId);
    const permitted = result.parsed?.wouldRevert === false;
    if (permitted) {
      return {
        state: "protected",
        detectedModifierAddress: modifier,
        enabledModules,
        permissionChecked: true,
        undetermined: null,
        summary: "Exit Keepa is authorized to execute this exit automatically.",
      };
    }
    return {
      state: "needs_permission",
      detectedModifierAddress: modifier,
      enabledModules,
      permissionChecked: true,
      undetermined: null,
      summary: "Your Safe is set up, but Exit Keepa hasn't been granted permission to perform this exit yet.",
    };
  } catch (err) {
    // The dry run itself failed - we do not know whether the permission is
    // in place. Never report that as protected.
    logger.warn({ err, safeAddress: safe.safeAddress }, "Authorization permission check could not complete");
    return {
      state: "needs_permission",
      detectedModifierAddress: modifier,
      enabledModules,
      permissionChecked: false,
      undetermined: `Couldn't confirm the permission just now: ${(err as Error).message}`,
      summary: "We couldn't confirm your permission just now. This is usually temporary - try again in a moment.",
    };
  }
}
