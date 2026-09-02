import crypto from "node:crypto";
import { env } from "../env";

/**
 * Self-contained OAuth `state` parameter for the Google/X sign-in flows
 * (routes/oauth.ts): there is no server-side session between the /start
 * redirect and the /callback request (a browser round-trip through the
 * provider's own consent screen, potentially minutes later, with nothing
 * in between that this API's own process is guaranteed to still hold in
 * memory), so instead of a DB row this signs the CSRF nonce and the PKCE
 * code_verifier directly into the state string the provider hands back
 * verbatim. HMAC-SHA256 over a server-only secret makes it infeasible to
 * forge or tamper with; `timingSafeEqual` avoids leaking the signature
 * byte-by-byte through response timing.
 */

const STATE_TTL_MS = 10 * 60_000;

export interface OAuthStatePayload {
  nonce: string;
  /** PKCE code_verifier - round-tripped through the provider via the
   * signed `code_challenge` derived from it at /start, then sent back to
   * the provider's token endpoint at /callback to prove this exact
   * process (not just anyone with the authorization code) started the
   * flow. */
  verifier: string;
  ts: number;
}

function requireStateSecret(): string {
  if (!env.OAUTH_STATE_SECRET) {
    throw new Error("OAUTH_STATE_SECRET is not configured - social sign-in is unavailable");
  }
  return env.OAUTH_STATE_SECRET;
}

function sign(encodedPayload: string): string {
  return crypto.createHmac("sha256", requireStateSecret()).update(encodedPayload).digest("hex");
}

export function createOAuthState(): { state: string; codeChallenge: string } {
  const payload: OAuthStatePayload = {
    nonce: crypto.randomBytes(16).toString("hex"),
    verifier: crypto.randomBytes(32).toString("base64url"),
    ts: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const state = `${encoded}.${sign(encoded)}`;
  const codeChallenge = crypto.createHash("sha256").update(payload.verifier).digest("base64url");
  return { state, codeChallenge };
}

/** Throws on a missing/tampered/expired state - callers redirect to a
 * clear error rather than ever treating a failed check as a login. */
export function verifyOAuthState(state: string): OAuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) throw new Error("Malformed OAuth state");

  const expected = sign(encoded);
  const signatureBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    throw new Error("OAuth state signature mismatch - possible CSRF or tampering");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    throw new Error("OAuth state expired - restart sign-in");
  }
  return payload;
}
