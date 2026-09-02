import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { authSessions, safeAccounts, safeOwners } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { env } from "../env";
import { createOAuthState, verifyOAuthState } from "../auth/oauthState";

/**
 * "Sign in with Google" / "Sign in with X" - an alternate login method
 * alongside a real wallet connection (auth.ts's nonce/verify flow) or the
 * demo-session sandbox: a persistent account for someone who wants to come
 * back to the same strategies without a wallet extension. Standard OAuth
 * 2.0 Authorization Code + PKCE against each provider's own endpoints -
 * this API never sees or stores a Google/X password, only the short-lived
 * access token it exchanges the authorization code for, used exactly once
 * to read the caller's own public profile (sub/email or id/username) and
 * then discarded (never persisted).
 *
 * Each route checks its own provider's env vars at request time and
 * refuses cleanly (503, or a redirect carrying `?error=not_configured`)
 * rather than ever faking a login - this whole flow is inert until real
 * OAuth app credentials are set (see README's "Social sign-in setup").
 */
export const oauthRouter = Router();

const SESSION_TTL_MS = 24 * 60 * 60_000; // matches auth.ts's wallet/demo sessions

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
function randomAddress(): string {
  return "0x" + crypto.randomBytes(20).toString("hex");
}
function randomBytes32(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

function errorRedirectUrl(code: string): string {
  const url = new URL("/auth/callback", env.WEB_APP_URL);
  url.searchParams.set("error", code);
  return url.toString();
}

/**
 * Finds or creates this social identity's own sandbox Safe - the same
 * mechanism POST /api/auth/demo-session uses for a throwaway demo
 * session, except persistent: a returning Google/X user gets back the
 * exact same Safe and strategies every time, keyed to their stable
 * provider subject id, not regenerated per login. Nothing here is
 * deployed on any real chain (see execution/simulate.ts and
 * routes/executions.ts's isSandbox handling), same as a demo sandbox.
 */
async function ensureSocialSandboxSafe(identity: string): Promise<void> {
  const [existing] = await db.select().from(safeOwners).where(eq(safeOwners.ownerAddress, identity)).limit(1);
  if (existing) return;

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
  await db.insert(safeOwners).values({ safeId: safe.id, ownerAddress: identity }).returning();
}

async function issueSocialSession(identity: string): Promise<string> {
  await ensureSocialSandboxSafe(identity);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessions).values({ token, address: identity, expiresAt }).returning();
  return token;
}

function successRedirectUrl(params: { token: string; provider: "google" | "x"; identity: string; label: string }): string {
  const url = new URL("/auth/callback", env.WEB_APP_URL);
  // In the fragment, not the query string: a URL fragment is never sent to
  // any server (this API's own redirect target included) and never
  // appears in Referer headers, so the bearer token can't leak through
  // server logs or a downstream request the callback page itself makes.
  url.hash = new URLSearchParams(params).toString();
  return url.toString();
}

// ---------------------------------------------------------------- Google --

oauthRouter.get("/auth/oauth/google/start", (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.OAUTH_STATE_SECRET || !env.OAUTH_API_BASE_URL) {
    throw new HttpError(503, "Google sign-in isn't configured yet");
  }
  const { state, codeChallenge } = createOAuthState();
  const redirectUri = new URL("/api/auth/oauth/google/callback", env.OAUTH_API_BASE_URL).toString();

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

oauthRouter.get("/auth/oauth/google/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) {
    logger.info({ error }, "Google sign-in was not completed by the user");
    return res.redirect(errorRedirectUrl(error));
  }
  if (!code || !state) return res.redirect(errorRedirectUrl("missing_code"));
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.OAUTH_API_BASE_URL) {
    return res.redirect(errorRedirectUrl("not_configured"));
  }

  let payload;
  try {
    payload = verifyOAuthState(state);
  } catch (err) {
    logger.warn({ err }, "Google OAuth state verification failed");
    return res.redirect(errorRedirectUrl("invalid_state"));
  }

  const redirectUri = new URL("/api/auth/oauth/google/callback", env.OAUTH_API_BASE_URL).toString();
  let tokenBody: { access_token?: string };
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: payload.verifier,
      }),
    });
    if (!tokenRes.ok) {
      logger.error({ status: tokenRes.status, body: await tokenRes.text() }, "Google token exchange failed");
      return res.redirect(errorRedirectUrl("token_exchange_failed"));
    }
    tokenBody = (await tokenRes.json()) as { access_token?: string };
  } catch (err) {
    logger.error({ err }, "Google token exchange request failed");
    return res.redirect(errorRedirectUrl("token_exchange_failed"));
  }
  if (!tokenBody.access_token) return res.redirect(errorRedirectUrl("token_exchange_failed"));

  let profile: { sub?: string; email?: string; name?: string };
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!userRes.ok) {
      logger.error({ status: userRes.status }, "Google userinfo fetch failed");
      return res.redirect(errorRedirectUrl("userinfo_failed"));
    }
    profile = (await userRes.json()) as { sub?: string; email?: string; name?: string };
  } catch (err) {
    logger.error({ err }, "Google userinfo request failed");
    return res.redirect(errorRedirectUrl("userinfo_failed"));
  }
  if (!profile.sub) return res.redirect(errorRedirectUrl("userinfo_failed"));

  const identity = `social:google:${profile.sub}`;
  const token = await issueSocialSession(identity);
  logger.info({ identity }, "Google sign-in completed");
  res.redirect(
    successRedirectUrl({ token, provider: "google", identity, label: profile.email ?? profile.name ?? "Google account" }),
  );
});

// -------------------------------------------------------------------- X --

oauthRouter.get("/auth/oauth/x/start", (_req, res) => {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.OAUTH_STATE_SECRET || !env.OAUTH_API_BASE_URL) {
    throw new HttpError(503, "X sign-in isn't configured yet");
  }
  const { state, codeChallenge } = createOAuthState();
  const redirectUri = new URL("/api/auth/oauth/x/callback", env.OAUTH_API_BASE_URL).toString();

  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("client_id", env.X_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  // X's OAuth 2.0 Authorization Code + PKCE requires at least one scope;
  // these three are the minimum for reading the caller's own public
  // profile - no posting/DM/follow permission is ever requested.
  url.searchParams.set("scope", "tweet.read users.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(url.toString());
});

oauthRouter.get("/auth/oauth/x/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) {
    logger.info({ error }, "X sign-in was not completed by the user");
    return res.redirect(errorRedirectUrl(error));
  }
  if (!code || !state) return res.redirect(errorRedirectUrl("missing_code"));
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.OAUTH_API_BASE_URL) {
    return res.redirect(errorRedirectUrl("not_configured"));
  }

  let payload;
  try {
    payload = verifyOAuthState(state);
  } catch (err) {
    logger.warn({ err }, "X OAuth state verification failed");
    return res.redirect(errorRedirectUrl("invalid_state"));
  }

  const redirectUri = new URL("/api/auth/oauth/x/callback", env.OAUTH_API_BASE_URL).toString();
  const basicAuth = Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString("base64");
  let tokenBody: { access_token?: string };
  try {
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: env.X_CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: payload.verifier,
      }),
    });
    if (!tokenRes.ok) {
      logger.error({ status: tokenRes.status, body: await tokenRes.text() }, "X token exchange failed");
      return res.redirect(errorRedirectUrl("token_exchange_failed"));
    }
    tokenBody = (await tokenRes.json()) as { access_token?: string };
  } catch (err) {
    logger.error({ err }, "X token exchange request failed");
    return res.redirect(errorRedirectUrl("token_exchange_failed"));
  }
  if (!tokenBody.access_token) return res.redirect(errorRedirectUrl("token_exchange_failed"));

  let profile: { data?: { id?: string; username?: string; name?: string } };
  try {
    const userRes = await fetch("https://api.twitter.com/2/users/me?user.fields=username,name", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!userRes.ok) {
      logger.error({ status: userRes.status }, "X userinfo fetch failed");
      return res.redirect(errorRedirectUrl("userinfo_failed"));
    }
    profile = (await userRes.json()) as { data?: { id?: string; username?: string; name?: string } };
  } catch (err) {
    logger.error({ err }, "X userinfo request failed");
    return res.redirect(errorRedirectUrl("userinfo_failed"));
  }
  if (!profile.data?.id) return res.redirect(errorRedirectUrl("userinfo_failed"));

  const identity = `social:x:${profile.data.id}`;
  const token = await issueSocialSession(identity);
  logger.info({ identity }, "X sign-in completed");
  res.redirect(
    successRedirectUrl({
      token,
      provider: "x",
      identity,
      label: profile.data.username ? `@${profile.data.username}` : (profile.data.name ?? "X account"),
    }),
  );
});
