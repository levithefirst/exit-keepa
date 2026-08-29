import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";

const app = createApp();

describe("GET /internal/diagnostics/keeperhub/:resource", () => {
  it("returns 503 when DIAGNOSTIC_SECRET is not configured", async () => {
    // test/setup.ts never sets DIAGNOSTIC_SECRET, so the route stays disabled.
    const res = await request(app).get("/internal/diagnostics/keeperhub/chains");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "diagnostics_disabled" });
  });
});
