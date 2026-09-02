import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { isAddress, recoverMessageAddress } from "viem";
import { z } from "zod";
import { db } from "../db";
import { authNonces, authSessions, safeAccounts, safeOwners } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { buildSignInMessage } from "../auth/nonceMessage";

export const authRouter = Router();

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 24 * 60 * 60_000;

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
function randomNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}
function randomAddress(): string {
  return "0x" + crypto.randomBytes(20).toString("hex");
}
function randomBytes32(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

const nonceSchema = z.object({ address: z.string() });

/** Step 1 of sign-in: issue a one-time challenge for this address to sign. */
authRouter.post("/auth/nonce", async (req, res) => {
  const { address } = nonceSchema.parse(req.body);
  if (!isAddress(address)) throw new HttpError(400, "Invalid Ethereum address");
  const normalized = address.toLowerCase();

  const nonce = randomNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  // A fresh request always invalidates whatever nonce that address had
  // outstanding before - delete-then-insert rather than an upsert, so this
  // works identically regardless of the underlying driver's support for
  // ON CONFLICT DO UPDATE.
  await db.delete(authNonces).where(eq(authNonces.address, normalized));
  await db.insert(authNonces).values({ address: normalized, nonce, expiresAt }).returning();

  res.status(200).json({ nonce, message: buildSignInMessage(normalized, nonce), expiresAt });
});

const verifySchema = z.object({ address: z.string(), signature: z.string() });

/** Step 2 of sign-in: verify the signed challenge and issue a session. */
authRouter.post("/auth/verify", async (req, res) => {
  const { address, signature } = verifySchema.parse(req.body);
  if (!isAddress(address)) throw new HttpError(400, "Invalid Ethereum address");
  const normalized = address.toLowerCase();

  const [record] = await db.select().from(authNonces).where(eq(authNonces.address, normalized)).limit(1);
  if (!record) throw new HttpError(401, "No sign-in challenge outstanding for this address - request a nonce first");
  if (record.expiresAt.getTime() < Date.now()) {
    throw new HttpError(401, "Sign-in challenge expired - request a new nonce");
  }

  const message = buildSignInMessage(normalized, record.nonce);
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  } catch {
    throw new HttpError(401, "Signature could not be verified");
  }
  if (recovered.toLowerCase() !== normalized) {
    throw new HttpError(401, "Signature does not match the claimed address");
  }

  // One-time use: the nonce is gone the instant it's consumed, so this
  // exact signature can never be replayed to mint a second session.
  await db.delete(authNonces).where(eq(authNonces.address, normalized));

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessions).values({ token, address: normalized, expiresAt }).returning();

  res.status(200).json({ token, address: normalized, expiresAt });
});

/**
 * Issues a session for a brand-new, private demo identity - no signature
 * required. Every call gets its OWN randomly-generated owner address and
 * its own auto-provisioned sandbox Safe (below), never a shared one: an
 * earlier version of this endpoint always logged in as the same fixed
 * address, which meant every visitor who clicked "Try demo" saw and acted
 * on the exact same Safe - including, briefly, the real production Safe
 * used for this project's own onchain proof. That's fixed structurally
 * here, not just cosmetically: there is no longer any address this
 * endpoint can return twice.
 *
 * The sandbox Safe's rolesModifierAddress/rolesKey are pre-set (to
 * synthetic values - nothing here is deployed on any real chain) so a
 * demo visitor never hits the real-Safe Roles setup wall. Because none of
 * it exists on-chain, execution/simulate.ts returns a mocked, clearly-
 * labeled simulation for it instead of calling KeeperHub, and
 * routes/executions.ts refuses to ever broadcast one for real - see both
 * files' own comments.
 */
authRouter.post("/auth/demo-session", async (_req, res) => {
  const token = randomToken();
  const ownerAddress = randomAddress();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const [safe] = await db
    .insert(safeAccounts)
    .values({
      chainId: 8453,
      safeAddress: randomAddress(),
      rolesModifierAddress: randomAddress(),
      rolesKey: randomBytes32(),
      isSandbox: true,
    })
    .returning();

  await db.insert(safeOwners).values({ safeId: safe.id, ownerAddress }).returning();
  await db.insert(authSessions).values({ token, address: ownerAddress, expiresAt }).returning();

  res.status(200).json({ token, address: ownerAddress, expiresAt });
});
