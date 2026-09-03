import "./setup";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createFakeDb, eq, and } from "./fakeDb";
import { authNonces, authSessions } from "../src/db/schema";

const fakeDb = createFakeDb();

vi.mock("../src/db", () => ({ db: fakeDb }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq, and };
});

const { createApp } = await import("../src/app");
const app = createApp();

async function signIn(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const nonceRes = await request(app).post("/api/auth/nonce").send({ address: account.address });
  expect(nonceRes.status).toBe(200);
  const signature = await account.signMessage({ message: nonceRes.body.message });
  const verifyRes = await request(app)
    .post("/api/auth/verify")
    .send({ address: account.address, signature });
  return { account, verifyRes };
}

describe("POST /api/auth/nonce + /api/auth/verify - real signature verification", () => {
  it("issues a working session for a wallet that actually signs the challenge", async () => {
    const { account, verifyRes } = await signIn(generatePrivateKey());
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeTruthy();
    expect(verifyRes.body.address).toBe(account.address.toLowerCase());

    // The token actually works against a real protected route.
    const safeRes = await request(app)
      .post("/api/safe-accounts")
      .set("Authorization", `Bearer ${verifyRes.body.token}`)
      .send({ chainId: 8453, safeAddress: "0x000000000000000000000000000000000000dEaD" });
    expect(safeRes.status).toBe(201);
  });

  it("rejects a signature from a different key than the one claiming the address", async () => {
    const claimed = privateKeyToAccount(generatePrivateKey());
    const impostor = privateKeyToAccount(generatePrivateKey());

    const nonceRes = await request(app).post("/api/auth/nonce").send({ address: claimed.address });
    const badSignature = await impostor.signMessage({ message: nonceRes.body.message });

    const verifyRes = await request(app)
      .post("/api/auth/verify")
      .send({ address: claimed.address, signature: badSignature });
    expect(verifyRes.status).toBe(401);
  });

  it("rejects a signature over the wrong message (e.g. a stale/reused nonce string)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await request(app).post("/api/auth/nonce").send({ address: account.address });
    const wrongMessage = "Sign in to Exit Keepa.\n\nAddress: 0xdead\nNonce: not-the-real-nonce\n";
    const signature = await account.signMessage({ message: wrongMessage });

    const verifyRes = await request(app)
      .post("/api/auth/verify")
      .send({ address: account.address, signature });
    expect(verifyRes.status).toBe(401);
  });

  it("consumes the nonce on first use - the identical signature cannot mint a second session", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonceRes = await request(app).post("/api/auth/nonce").send({ address: account.address });
    const signature = await account.signMessage({ message: nonceRes.body.message });

    const first = await request(app).post("/api/auth/verify").send({ address: account.address, signature });
    expect(first.status).toBe(200);

    const replay = await request(app).post("/api/auth/verify").send({ address: account.address, signature });
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/request a nonce first/i);
  });

  it("rejects verify against an address with no outstanding nonce request", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: "anything" });
    const verifyRes = await request(app).post("/api/auth/verify").send({ address: account.address, signature });
    expect(verifyRes.status).toBe(401);
  });

  it("rejects an expired nonce even with a correct signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const normalized = account.address.toLowerCase();
    // Insert an already-expired nonce directly - simpler and more precise
    // than faking wall-clock time for a 5-minute TTL.
    const nonce = "deadbeef";
    await fakeDb
      .insert(authNonces)
      .values({ address: normalized, nonce, expiresAt: new Date(Date.now() - 1000) })
      .returning();

    const { buildSignInMessage } = await import("../src/auth/nonceMessage");
    const signature = await account.signMessage({ message: buildSignInMessage(normalized, nonce) });

    const verifyRes = await request(app).post("/api/auth/verify").send({ address: account.address, signature });
    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body.message).toMatch(/expired/i);
  });
});

describe("Session enforcement", () => {
  it("rejects any protected route with no Authorization header", async () => {
    const res = await request(app).post("/api/safe-accounts").send({ chainId: 8453, safeAddress: "0xdead" });
    expect(res.status).toBe(401);
  });

  it("rejects a well-formed but unknown token", async () => {
    const res = await request(app)
      .post("/api/safe-accounts")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ chainId: 8453, safeAddress: "0xdead" });
    expect(res.status).toBe(401);
  });

  it("rejects an expired session token", async () => {
    const token = "expired-token-fixture";
    await fakeDb
      .insert(authSessions)
      .values({ token, address: "0xabc", expiresAt: new Date(Date.now() - 1000) })
      .returning();

    const res = await request(app)
      .post("/api/safe-accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ chainId: 8453, safeAddress: "0xdead" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/demo-session", () => {
  it("issues a working session with no signature, auto-provisioning its own private sandbox Safe", async () => {
    const res = await request(app).post("/api/auth/demo-session").send({});
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.address).toMatch(/^0x[0-9a-f]{40}$/);

    const mySafes = await request(app)
      .get("/api/safe-accounts")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(mySafes.status).toBe(200);
    expect(mySafes.body.length).toBe(1);
    expect(mySafes.body[0].isSandbox).toBe(true);
    expect(mySafes.body[0].rolesModifierAddress).toBeTruthy();
    expect(mySafes.body[0].rolesKey).toBeTruthy();
  });

  it("never issues the same identity or sandbox Safe twice - each demo click is its own private session", async () => {
    const a = await request(app).post("/api/auth/demo-session").send({});
    const b = await request(app).post("/api/auth/demo-session").send({});
    expect(a.body.address).not.toBe(b.body.address);
    expect(a.body.token).not.toBe(b.body.token);
  });
});

describe("Ownership enforcement across resource types", () => {
  it("prevents a different wallet from reading or acting on someone else's Safe, strategy, executions, and agent decisions", async () => {
    const { verifyRes: ownerAuth } = await signIn(generatePrivateKey());
    const ownerToken = ownerAuth.body.token;
    const { verifyRes: strangerAuth } = await signIn(generatePrivateKey());
    const strangerToken = strangerAuth.body.token;

    const safeRes = await request(app)
      .post("/api/safe-accounts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        chainId: 8453,
        safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
        rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
        rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000",
      });
    const safeId = safeRes.body.id;

    const strategyRes = await request(app)
      .post("/api/exit-strategies")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        safeId,
        name: "Owner's strategy",
        condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
        action: {
          protocol: "aave-v3-base",
          action: "withdraw",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "max",
        },
      });
    const strategyId = strategyRes.body.id;

    // Every read/action the stranger attempts against the owner's
    // resources is refused - 403 (a session exists, it's just not
    // authorized for this resource), never a silent 200.
    const strangerAuthHeader = { Authorization: `Bearer ${strangerToken}` };

    expect((await request(app).get(`/api/safe-accounts/${safeId}`).set(strangerAuthHeader)).status).toBe(403);
    expect((await request(app).get(`/api/safe-accounts/${safeId}/balances`).set(strangerAuthHeader)).status).toBe(403);
    expect(
      (await request(app).get(`/api/exit-strategies?safeId=${safeId}`).set(strangerAuthHeader)).status,
    ).toBe(403);
    expect((await request(app).get(`/api/exit-strategies/${strategyId}`).set(strangerAuthHeader)).status).toBe(403);
    expect(
      (await request(app).get(`/api/exit-strategies/${strategyId}/preview`).set(strangerAuthHeader)).status,
    ).toBe(403);
    expect(
      (await request(app).post(`/api/exit-strategies/${strategyId}/activate`).set(strangerAuthHeader)).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/exit-strategies/${strategyId}/executions`).set(strangerAuthHeader)).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/exit-strategies/${strategyId}/executions`)
          .set(strangerAuthHeader)
          .send({ currentRateBps: 100 })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(strangerAuthHeader)).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/exit-strategies/${strategyId}/agent/decisions`).set(strangerAuthHeader)).status,
    ).toBe(403);

    // Trying to REGISTER a strategy against someone else's safeId is
    // refused just as firmly as reading one.
    expect(
      (
        await request(app)
          .post("/api/exit-strategies")
          .set(strangerAuthHeader)
          .send({
            safeId,
            name: "Stranger trying to attach a strategy to someone else's Safe",
            condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
            action: {
              protocol: "aave-v3-base",
              action: "withdraw",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              amount: "max",
            },
          })
      ).status,
    ).toBe(403);

    // Meanwhile the actual owner can do all of this normally.
    const ownerAuthHeader = { Authorization: `Bearer ${ownerToken}` };
    expect((await request(app).get(`/api/safe-accounts/${safeId}`).set(ownerAuthHeader)).status).toBe(200);
    expect((await request(app).get(`/api/exit-strategies/${strategyId}`).set(ownerAuthHeader)).status).toBe(200);
  });
});

describe("POST /api/auth/signup + /api/auth/login - username/password accounts", () => {
  it("signs up, auto-provisions a private sandbox Safe, and the token works against a real protected route", async () => {
    const res = await request(app).post("/api/auth/signup").send({ username: "Alice", password: "correct-horse" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    // Username is normalized (lowercased) into the account's identity string.
    expect(res.body.address).toBe("local:alice");

    const mySafes = await request(app)
      .get("/api/safe-accounts")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(mySafes.status).toBe(200);
    expect(mySafes.body.length).toBe(1);
    expect(mySafes.body[0].isSandbox).toBe(true);
  });

  it("rejects a signup with a username that's already taken (case-insensitively)", async () => {
    await request(app).post("/api/auth/signup").send({ username: "bob", password: "correct-horse" });
    const dup = await request(app).post("/api/auth/signup").send({ username: "BOB", password: "another-password" });
    expect(dup.status).toBe(409);
  });

  it("rejects a signup with too short a password", async () => {
    const res = await request(app).post("/api/auth/signup").send({ username: "carol", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects a signup with a username containing invalid characters", async () => {
    const res = await request(app).post("/api/auth/signup").send({ username: "dan!!", password: "correct-horse" });
    expect(res.status).toBe(400);
  });

  it("logs in with the right password and reuses the exact same identity/Safe created at signup", async () => {
    const signupRes = await request(app)
      .post("/api/auth/signup")
      .send({ username: "erin", password: "correct-horse" });
    const signupSafes = await request(app)
      .get("/api/safe-accounts")
      .set("Authorization", `Bearer ${signupRes.body.token}`);

    const loginRes = await request(app).post("/api/auth/login").send({ username: "erin", password: "correct-horse" });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.address).toBe(signupRes.body.address);
    expect(loginRes.body.token).not.toBe(signupRes.body.token);

    const loginSafes = await request(app)
      .get("/api/safe-accounts")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(loginSafes.body.map((s: { id: string }) => s.id)).toEqual(signupSafes.body.map((s: { id: string }) => s.id));
  });

  it("rejects login with the wrong password", async () => {
    await request(app).post("/api/auth/signup").send({ username: "frank", password: "correct-horse" });
    const res = await request(app).post("/api/auth/login").send({ username: "frank", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects login for a username that was never signed up", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "ghost", password: "correct-horse" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/safe-accounts - lets the dashboard auto-resolve a returning wallet's Safe", () => {
  it("returns only the Safes the calling session's address registered, never another wallet's", async () => {
    const { verifyRes: owner } = await signIn(generatePrivateKey());
    const { verifyRes: stranger } = await signIn(generatePrivateKey());
    const ownerAuthHeader = { Authorization: `Bearer ${owner.body.token}` };
    const strangerAuthHeader = { Authorization: `Bearer ${stranger.body.token}` };

    const created = await request(app)
      .post("/api/safe-accounts")
      .set(ownerAuthHeader)
      .send({ chainId: 8453, safeAddress: "0x000000000000000000000000000000000000dEaD" });
    expect(created.status).toBe(201);

    const ownerList = await request(app).get("/api/safe-accounts").set(ownerAuthHeader);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.map((s: { id: string }) => s.id)).toEqual([created.body.id]);

    const strangerList = await request(app).get("/api/safe-accounts").set(strangerAuthHeader);
    expect(strangerList.status).toBe(200);
    expect(strangerList.body).toEqual([]);
  });

  it("returns an empty array (not an error) for a session that owns no Safes yet", async () => {
    const { verifyRes } = await signIn(generatePrivateKey());
    const res = await request(app)
      .get("/api/safe-accounts")
      .set("Authorization", `Bearer ${verifyRes.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("requires a session - 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/safe-accounts");
    expect(res.status).toBe(401);
  });
});
