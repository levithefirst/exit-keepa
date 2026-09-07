import { z } from "zod";

/**
 * All configuration is sourced from environment variables. Nothing here has
 * a default that would be safe to run in production with - missing
 * required values fail fast at boot instead of silently degrading.
 */
const envSchema = z
  .object({
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
  // Verifying one Safe is a handful of batched reads, and a single public
  // endpoint will rate-limit partway through - which fails closed and
  // shows the owner of a protected Safe an "unverifiable" card. These are
  // tried in turn when the primary refuses, so a public deployment can
  // still finish a read. Independent operators, so a quota on one is not a
  // quota on the next. Set BASE_RPC_URL to a key-authenticated endpoint
  // and these become a fallback rather than the load-bearing path.
  BASE_RPC_FALLBACKS: z
    .string()
    .default("https://base.publicnode.com,https://1rpc.io/base,https://base.drpc.org")
    .transform((value) => value.split(",").map((s) => s.trim()).filter(Boolean)),

  // The autonomous Exit Guardian loop - the thing that makes Exit Keepa
  // watch a condition and execute an exit without anyone present. On by
  // default in production, because a deployed Exit Keepa that isn't
  // watching isn't the product; off by default everywhere else, so a `dev`
  // run, a test, or a preview deploy never starts silently polling live
  // chain state and creating real execution rows without someone deciding
  // that's what they want. An explicit AGENT_POLL_ENABLED wins in either
  // direction (see the object-level transform below).
  AGENT_POLL_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),
  // How long an approved-but-not-yet-broadcast decision stays fresh before
  // routes/executions.ts's broadcast route refuses it as stale.
  AGENT_DECISION_MAX_AGE_MS: z.coerce.number().int().positive().default(5 * 60_000),
  })
  .transform((raw) => ({
    ...raw,
    // Resolved here rather than as a field default so "unset" and
    // "explicitly false" stay distinguishable above.
    AGENT_POLL_ENABLED: raw.AGENT_POLL_ENABLED ?? raw.NODE_ENV === "production",
    /** Every Base endpoint to try, primary first, de-duplicated. */
    BASE_RPC_URLS: [...new Set([raw.BASE_RPC_URL, ...raw.BASE_RPC_FALLBACKS])],
  }));

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
