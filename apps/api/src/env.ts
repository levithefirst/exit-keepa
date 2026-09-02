import { z } from "zod";

/**
 * All configuration is sourced from environment variables. Nothing here has
 * a default that would be safe to run in production with - missing
 * required values fail fast at boot instead of silently degrading.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((s) => s.trim()).filter(Boolean)),

  KEEPERHUB_API_KEY: z.string().min(1, "KEEPERHUB_API_KEY is required"),
  KEEPERHUB_API_BASE_URL: z.string().url().default("https://app.keeperhub.com/api"),
  KEEPERHUB_WEBHOOK_SECRET: z.string().min(1, "KEEPERHUB_WEBHOOK_SECRET is required"),

  BASE_CHAIN_ID: z.coerce.number().int().positive().default(8453),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),

  // The autonomous Exit Guardian loop. Off by default in any environment
  // that doesn't explicitly turn it on, so a `dev` run or a preview deploy
  // never starts silently polling live chain state and creating real
  // execution rows without someone deciding that's what they want.
  AGENT_POLL_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),
  // How long an approved-but-not-yet-broadcast decision stays fresh before
  // routes/executions.ts's broadcast route refuses it as stale.
  AGENT_DECISION_MAX_AGE_MS: z.coerce.number().int().positive().default(5 * 60_000),

  // Social sign-in (routes/oauth.ts) - an alternate login method alongside
  // a real wallet connection or the demo-session sandbox, for someone who
  // wants a persistent account without a wallet extension. All optional:
  // each provider's start/callback routes check for their own pair at
  // request time and answer "not configured" rather than ever faking a
  // login when a value is missing - see routes/oauth.ts. Client secrets
  // are never logged or echoed back to the browser.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  X_CLIENT_ID: z.string().min(1).optional(),
  X_CLIENT_SECRET: z.string().min(1).optional(),
  // Signs the self-contained OAuth state/PKCE token (auth/oauthState.ts) -
  // required for either provider to work, since there is no server-side
  // session store between the start and callback legs of the redirect.
  OAUTH_STATE_SECRET: z.string().min(16).optional(),
  // This API's own public base URL, used to build the exact redirect_uri
  // registered with each provider's console - must match byte-for-byte or
  // the provider rejects the callback.
  OAUTH_API_BASE_URL: z.string().url().optional(),
  // Where a completed (or failed) sign-in redirects back to.
  WEB_APP_URL: z.string().url().default("https://exit-keepa-web.vercel.app"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${formatted}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
