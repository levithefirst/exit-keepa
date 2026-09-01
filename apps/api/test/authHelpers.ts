import crypto from "node:crypto";
import { authSessions } from "../src/db/schema";

/**
 * Inserts a session directly into the fake DB, bypassing the real
 * nonce/sign/verify flow - these are route/http tests exercising ownership
 * enforcement, not the signature-verification crypto itself (that has its
 * own dedicated tests in src/auth/*.test.ts and test/auth.e2e.test.ts).
 */
export async function createTestSession(fakeDb: { insert: (table: unknown) => any }, address: string): Promise<string> {
  const token = crypto.randomBytes(16).toString("hex");
  await fakeDb
    .insert(authSessions)
    .values({ token, address: address.toLowerCase(), expiresAt: new Date(Date.now() + 60_000) })
    .returning();
  return token;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
