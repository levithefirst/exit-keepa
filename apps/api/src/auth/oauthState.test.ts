import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../env", () => ({ env: { OAUTH_STATE_SECRET: "test-secret-at-least-16-bytes" } }));

describe("oauthState", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("round-trips a freshly created state back to its own payload", async () => {
    const { createOAuthState, verifyOAuthState } = await import("./oauthState");
    const { state, codeChallenge } = createOAuthState();
    const payload = verifyOAuthState(state);
    expect(payload.verifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    // The challenge must be independently reproducible from the verifier
    // (S256 per RFC 7636) - not just present.
    const crypto = await import("node:crypto");
    const recomputed = crypto.createHash("sha256").update(payload.verifier).digest("base64url");
    expect(recomputed).toBe(codeChallenge);
  });

  it("rejects a tampered payload even with the original signature", async () => {
    const { createOAuthState, verifyOAuthState } = await import("./oauthState");
    const { state } = createOAuthState();
    const [encoded, signature] = state.split(".");
    const tamperedPayload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    tamperedPayload.verifier = "attacker-supplied-verifier";
    const tamperedEncoded = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    expect(() => verifyOAuthState(`${tamperedEncoded}.${signature}`)).toThrow(/signature mismatch/);
  });

  it("rejects a state signed under a different secret", async () => {
    const { createOAuthState } = await import("./oauthState");
    const { state } = createOAuthState();

    vi.resetModules();
    vi.doMock("../env", () => ({ env: { OAUTH_STATE_SECRET: "a-completely-different-secret-16" } }));
    const { verifyOAuthState: verifyUnderDifferentSecret } = await import("./oauthState");
    expect(() => verifyUnderDifferentSecret(state)).toThrow(/signature mismatch/);
  });

  it("rejects a malformed state", async () => {
    const { verifyOAuthState } = await import("./oauthState");
    expect(() => verifyOAuthState("not-a-real-state")).toThrow(/Malformed/);
  });

  it("rejects an expired state", async () => {
    vi.useFakeTimers();
    const { createOAuthState, verifyOAuthState } = await import("./oauthState");
    const { state } = createOAuthState();
    vi.advanceTimersByTime(11 * 60_000);
    expect(() => verifyOAuthState(state)).toThrow(/expired/);
    vi.useRealTimers();
  });

  it("throws a clear error when OAUTH_STATE_SECRET is not configured", async () => {
    vi.resetModules();
    vi.doMock("../env", () => ({ env: {} }));
    const { createOAuthState } = await import("./oauthState");
    expect(() => createOAuthState()).toThrow(/OAUTH_STATE_SECRET is not configured/);
  });
});
