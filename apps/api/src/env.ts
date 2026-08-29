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

  // Optional: enables the temporary /internal/diagnostics/keeperhub/* route
  // used to verify KeeperHub's live API from this deployment's own network.
  // Unset in any environment where that route should stay disabled (it
  // returns 503 when this is absent). Remove this variable and the route
  // once KeeperHub integration verification is complete.
  DIAGNOSTIC_SECRET: z.string().min(16).optional(),
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
