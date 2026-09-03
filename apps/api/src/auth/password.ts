import crypto from "node:crypto";

const KEY_LENGTH = 64;

/** Hashes `password` against a freshly generated random salt. */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

/**
 * Timing-safe check of `password` against a previously stored hash+salt.
 * Recomputes the digest rather than trusting string equality, so an
 * attacker who can measure response time can't learn the hash byte by byte.
 */
export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const candidate = crypto.scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}
