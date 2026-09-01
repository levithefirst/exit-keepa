import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { authSessions, safeOwners } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";

/**
 * Resolves the Bearer token on a request to the wallet address it
 * authenticates as - the only way any route below gets to know "who is
 * calling." Throws 401 for anything short of a live, unexpired session;
 * there is no anonymous/fallback identity.
 */
export async function requireSession(req: Request): Promise<string> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new HttpError(401, "Missing Authorization: Bearer <token> - sign in first");

  const [session] = await db.select().from(authSessions).where(eq(authSessions.token, token)).limit(1);
  if (!session) throw new HttpError(401, "Invalid session - sign in again");
  if (session.expiresAt.getTime() < Date.now()) throw new HttpError(401, "Session expired - sign in again");

  return session.address;
}

/**
 * Throws 403 unless `address` is the address that registered `safeId`.
 * Every route that reads or acts on a Safe, a strategy, an execution, or
 * an agent decision funnels through this (directly, or via a strategy's
 * own `safeId`) - see routes/safeAccounts.ts, routes/exitStrategies.ts,
 * routes/executions.ts, routes/agent.ts.
 */
export async function requireSafeOwnership(safeId: string, address: string): Promise<void> {
  const [owner] = await db.select().from(safeOwners).where(eq(safeOwners.safeId, safeId)).limit(1);
  if (!owner || owner.ownerAddress !== address) {
    throw new HttpError(403, "You do not have access to this Safe");
  }
}
