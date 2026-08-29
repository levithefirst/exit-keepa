import { z } from "zod";

/**
 * Only NEXT_PUBLIC_* variables are available in the browser bundle; keep
 * anything secret out of this schema and out of the client entirely.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export const clientEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
