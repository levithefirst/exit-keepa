import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

/**
 * CORS_ORIGINS is read once at module load time (env.ts calls loadEnv()
 * on import), so each case reloads the module graph with a different
 * env value rather than mutating `env` after the fact.
 */
async function createAppWithCorsOrigins(corsOrigins: string) {
  process.env.CORS_ORIGINS = corsOrigins;
  vi.resetModules();
  const { createApp } = await import("./app");
  return createApp();
}

const ORIGINAL_CORS_ORIGINS = process.env.CORS_ORIGINS;

beforeEach(() => {
  delete process.env.CORS_ORIGINS;
});

afterEach(() => {
  if (ORIGINAL_CORS_ORIGINS === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = ORIGINAL_CORS_ORIGINS;
});

describe("CORS configuration", () => {
  it("rejects all cross-origin requests when CORS_ORIGINS is unset (the previous, broken default)", async () => {
    const app = await createAppWithCorsOrigins("");
    const res = await request(app).get("/health").set("Origin", "https://example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows any browser origin when CORS_ORIGINS is '*' - required for the public deployed frontend", async () => {
    const app = await createAppWithCorsOrigins("*");
    const res = await request(app).get("/health").set("Origin", "https://exit-keepa-web.vercel.app");
    expect(res.headers["access-control-allow-origin"]).toBe("https://exit-keepa-web.vercel.app");
  });

  it("allows only explicitly listed origins when CORS_ORIGINS is a concrete list", async () => {
    const app = await createAppWithCorsOrigins("https://allowed.example.com");
    const allowed = await request(app).get("/health").set("Origin", "https://allowed.example.com");
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://allowed.example.com");

    const blocked = await request(app).get("/health").set("Origin", "https://not-allowed.example.com");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
