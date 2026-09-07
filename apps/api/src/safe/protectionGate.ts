import { eq } from "drizzle-orm";
import { canonicalRoleKey } from "@exit-keepa/shared";
import { db } from "../db";
import { safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { readProtectionState, type AuthorizationStatus, type SafeForProtectionCheck } from "./authorizationStatus";

type SafeRow = SafeForProtectionCheck & { id: string };

export interface ProtectionCheck<T extends SafeRow> {
  isProtected: boolean;
  status: AuthorizationStatus;
  /** The Safe as verification proved it to be - carries the modifier that was just confirmed on-chain. */
  safe: T;
}

/**
 * The single gate every fund-moving path goes through: verify protection
 * against the chain, then converge the stored Safe row on the modifier
 * that verification actually proved.
 *
 * Registration deliberately never stores a client-supplied module address,
 * and the transaction builder reads `rolesModifierAddress` off the row - so
 * this is the only thing that writes it outside the authorization flow, and
 * it writes it only from a verification that just passed. A module that was
 * revoked, re-pointed at another Safe, or downgraded to the vulnerable
 * Roles v2.1.0 fails `readProtectionState` and is never written back, so a
 * real exit can never be built against a module the chain did not confirm
 * moments earlier.
 *
 * Sandbox Safes short-circuit inside readProtectionState without any chain
 * read, and their row is left exactly as provisioned.
 */
export async function verifyProtection<T extends SafeRow>(safe: T): Promise<ProtectionCheck<T>> {
  const { isProtected, status } = await readProtectionState(safe);
  if (!isProtected) return { isProtected: false, status, safe };
  if (safe.isSandbox) return { isProtected: true, status, safe };

  const detected = status.detectedModifierAddress;
  // "Protected" without a detected module would mean the read agreed to
  // something it could not name - refuse rather than persist a guess.
  if (!detected) return { isProtected: false, status, safe };

  const roleKey = canonicalRoleKey();
  if (safe.rolesModifierAddress?.toLowerCase() !== detected.toLowerCase() || safe.rolesKey !== roleKey) {
    await db.update(safeAccounts).set({ rolesModifierAddress: detected, rolesKey: roleKey }).where(eq(safeAccounts.id, safe.id)).returning();
  }
  return { isProtected: true, status, safe: { ...safe, rolesModifierAddress: detected, rolesKey: roleKey } };
}

/** `verifyProtection` as a route guard: throws 409 with the user-facing summary unless the Safe is verifiably protected right now. */
export async function requireProtectedSafe<T extends SafeRow>(safe: T): Promise<T> {
  const result = await verifyProtection(safe);
  if (!result.isProtected) throw new HttpError(409, result.status.summary);
  return result.safe;
}
