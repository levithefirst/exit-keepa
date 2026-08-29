import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * DIAGNOSTIC_SECRET must be set before ../env (and therefore ../app) is
 * first imported, since env.ts validates process.env once at module load.
 * Dynamic import() after setting it keeps this isolated from
 * diagnostics.test.ts, which relies on the secret being *unset*.
 */
describe("GET /internal/diagnostics/keeperhub/:resource (enabled)", () => {
  const secret = "test-diagnostic-secret-0123456789";
  let app: Express;

  beforeAll(async () => {
    process.env.DIAGNOSTIC_SECRET = secret;
    const { createApp } = await import("../app");
    app = createApp();
  });

  it("returns 401 when the secret header is missing", async () => {
    const res = await request(app).get("/internal/diagnostics/keeperhub/chains");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the secret header is wrong", async () => {
    const res = await request(app)
      .get("/internal/diagnostics/keeperhub/chains")
      .set("x-diagnostic-secret", "wrong-value-wrong-value-00");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a resource not on the allow-list", async () => {
    const res = await request(app)
      .get("/internal/diagnostics/keeperhub/execute")
      .set("x-diagnostic-secret", secret);
    expect(res.status).toBe(404);
    expect(res.body.allowed).toEqual(expect.arrayContaining(["chains", "keys"]));
  });
});
