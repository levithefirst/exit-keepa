import "./setup";
process.env.GOOGLE_CLIENT_ID ??= "google-test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "google-test-client-secret";
process.env.X_CLIENT_ID ??= "x-test-client-id";
process.env.X_CLIENT_SECRET ??= "x-test-client-secret";
process.env.OAUTH_STATE_SECRET ??= "test-oauth-state-secret-1234567890";
process.env.OAUTH_API_BASE_URL ??= "https://api.example.test";
process.env.WEB_APP_URL ??= "https://web.example.test";

import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createFakeDb, eq, and } from "./fakeDb";

const fakeDb = createFakeDb();

vi.mock("../src/db", () => ({ db: fakeDb }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq, and };
});

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const { createApp } = await import("../src/app");
const app = createApp();

function stateFromRedirect(location: string): string {
  const url = new URL(location);
  const state = url.searchParams.get("state");
  if (!state) throw new Error("start redirect had no state param");
  return state;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("GET /api/auth/oauth/google/start", () => {
  it("redirects to Google's own authorize endpoint with PKCE params", async () => {
    const res = await request(app).get("/api/auth/oauth/google/start");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("google-test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe("https://api.example.test/api/auth/oauth/google/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toBeTruthy();
  });
});

describe("GET /api/auth/oauth/google/callback", () => {
  it("exchanges the code, provisions a sandbox Safe, and redirects with a working session token", async () => {
    const startRes = await request(app).get("/api/auth/oauth/google/start");
    const state = stateFromRedirect(startRes.headers.location);

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "fake-google-access-token" }), { status: 200 });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
        return new Response(JSON.stringify({ sub: "google-user-123", email: "person@example.com" }), { status: 200 });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const callbackRes = await request(app)
      .get("/api/auth/oauth/google/callback")
      .query({ code: "auth-code-abc", state });
    expect(callbackRes.status).toBe(302);
    const redirect = new URL(callbackRes.headers.location);
    expect(redirect.origin + redirect.pathname).toBe("https://web.example.test/auth/callback");
    const hashParams = new URLSearchParams(redirect.hash.slice(1));
    const token = hashParams.get("token");
    expect(token).toBeTruthy();
    expect(hashParams.get("provider")).toBe("google");
    expect(hashParams.get("identity")).toBe("social:google:google-user-123");
    expect(hashParams.get("label")).toBe("person@example.com");

    // The issued token actually works against a real protected route.
    const mySafes = await request(app).get("/api/safe-accounts").set("Authorization", `Bearer ${token}`);
    expect(mySafes.status).toBe(200);
    expect(mySafes.body.length).toBe(1);
    expect(mySafes.body[0].isSandbox).toBe(true);
  });

  it("reuses the same sandbox Safe for a returning identity instead of creating a second one", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
        return new Response(JSON.stringify({ sub: "returning-user-999", email: "again@example.com" }), { status: 200 });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    async function login() {
      const startRes = await request(app).get("/api/auth/oauth/google/start");
      const state = stateFromRedirect(startRes.headers.location);
      const callbackRes = await request(app).get("/api/auth/oauth/google/callback").query({ code: "c", state });
      const hashParams = new URLSearchParams(new URL(callbackRes.headers.location).hash.slice(1));
      return hashParams.get("token")!;
    }

    const firstToken = await login();
    const secondToken = await login();
    expect(firstToken).not.toBe(secondToken); // fresh session each login...

    const firstSafes = await request(app).get("/api/safe-accounts").set("Authorization", `Bearer ${firstToken}`);
    const secondSafes = await request(app).get("/api/safe-accounts").set("Authorization", `Bearer ${secondToken}`);
    expect(firstSafes.body[0].id).toBe(secondSafes.body[0].id); // ...but the same Safe both times.
  });

  it("redirects with an error and never calls the provider when the state is invalid", async () => {
    const res = await request(app)
      .get("/api/auth/oauth/google/callback")
      .query({ code: "auth-code-abc", state: "not-a-real-state" });
    expect(res.status).toBe(302);
    const redirect = new URL(res.headers.location);
    expect(redirect.searchParams.get("error")).toBe("invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects with the provider's own error and never calls the provider when the user denies consent", async () => {
    const res = await request(app).get("/api/auth/oauth/google/callback").query({ error: "access_denied" });
    expect(res.status).toBe(302);
    const redirect = new URL(res.headers.location);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects with token_exchange_failed and creates no session when Google's token endpoint rejects the code", async () => {
    const startRes = await request(app).get("/api/auth/oauth/google/start");
    const state = stateFromRedirect(startRes.headers.location);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));

    const res = await request(app).get("/api/auth/oauth/google/callback").query({ code: "bad-code", state });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get("error")).toBe("token_exchange_failed");
  });
});

describe("GET /api/auth/oauth/x/start and /callback", () => {
  it("redirects to X's own authorize endpoint, then completes sign-in with a Basic-authenticated token exchange", async () => {
    const startRes = await request(app).get("/api/auth/oauth/x/start");
    expect(startRes.status).toBe(302);
    const startUrl = new URL(startRes.headers.location);
    expect(startUrl.origin + startUrl.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    const state = startUrl.searchParams.get("state")!;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "https://api.twitter.com/2/oauth2/token") {
        expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
        return new Response(JSON.stringify({ access_token: "fake-x-access-token" }), { status: 200 });
      }
      if (url.startsWith("https://api.twitter.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "x-user-42", username: "exitkeepa" } }), { status: 200 });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const callbackRes = await request(app).get("/api/auth/oauth/x/callback").query({ code: "x-code", state });
    expect(callbackRes.status).toBe(302);
    const hashParams = new URLSearchParams(new URL(callbackRes.headers.location).hash.slice(1));
    expect(hashParams.get("provider")).toBe("x");
    expect(hashParams.get("identity")).toBe("social:x:x-user-42");
    expect(hashParams.get("label")).toBe("@exitkeepa");
    expect(hashParams.get("token")).toBeTruthy();
  });
});

describe("Social sign-in when a provider is not configured", () => {
  it("returns 503 from /start rather than ever redirecting to a broken flow", async () => {
    const original = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    vi.resetModules();
    const { createApp: createAppUnconfigured } = await import("../src/app");
    const unconfiguredApp = createAppUnconfigured();

    const res = await request(unconfiguredApp).get("/api/auth/oauth/google/start");
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/isn't configured/i);

    process.env.GOOGLE_CLIENT_ID = original;
  });
});
