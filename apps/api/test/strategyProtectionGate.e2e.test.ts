import "./setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeDb, eq, and } from "./fakeDb";
import { protectedSafeRpc } from "./chainStubs";
import { createTestSession, authHeader } from "./authHelpers";

const fakeDb = createFakeDb();
vi.mock("../src/db", () => ({ db: fakeDb }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq, and };
});

const { callContractFunction } = vi.hoisted(() => ({ callContractFunction: vi.fn() }));
vi.mock("../src/keeperhub/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/keeperhub/client")>();
  return { ...actual, keeperHubClient: { callContractFunction, getDirectExecutionStatus: vi.fn() } };
});

const SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
/** Real ABI shape: array offset, `next` in the head at word1, then length - nothing after the items. */
const noModulesEnabled = `0x${word("0x40")}${word("0x1")}${word("0x0")}`;

/**
 * What the chain says right now. Each test sets this before acting, so the
 * gate is exercised against a real read rather than a stored flag.
 */
let chainMode: "protected" | "needs_module" | "needs_permission" | "unreachable" = "protected";

const RAY = 10n ** 27n;
const GET_RESERVE_DATA_SELECTOR = "0x35ea6a75";
/** Supply APR of 1.00%, which satisfies the "below 2%" condition these strategies use. */
function reserveDataHex(): string {
  const words = Array.from({ length: 15 }, () => 0n);
  words[2] = (100n * RAY) / 10_000n;
  return `0x${words.map((w) => w.toString(16).padStart(64, "0")).join("")}`;
}

vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
  let body: any = {};
  try { body = JSON.parse((init?.body as string) ?? "{}"); } catch { /* non-RPC request */ }
  // The rate read is a separate concern from authorization and always
  // answers, so a refusal below is unambiguously the protection gate.
  if (String(body?.params?.[0]?.data ?? "").startsWith(GET_RESERVE_DATA_SELECTOR)) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: reserveDataHex() }), { status: 200 });
  }
  if (chainMode === "unreachable") return new Response("upstream down", { status: 500 });

  if (chainMode === "needs_module") {
    const data = String(body?.params?.[0]?.data ?? "");
    if (body.method === "eth_call" && data.startsWith("0xcc2f8452")) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: noModulesEnabled }), { status: 200 });
    }
  }

  if (chainMode === "needs_permission") {
    // The module is there and valid, but the role's storage is empty - the
    // permission was never finished (or has been revoked).
    if (body.method === "eth_getStorageAt") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word("0x0")}` }), { status: 200 });
    }
  }

  const authorization = protectedSafeRpc({ safeAddress: SAFE, modifierAddress: MODIFIER }, body);
  if (authorization) return authorization;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${(10n ** 12n).toString(16).padStart(64, "0")}` }), { status: 200 });
}));

const { createApp } = await import("../src/app");
const app = createApp();

const strategyBody = (safeId: string) => ({
  safeId,
  name: "Gated strategy",
  condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
  action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" },
});

let token: string;
beforeEach(async () => {
  chainMode = "protected";
  callContractFunction.mockReset();
  token = await createTestSession(fakeDb, "0xAbC0000000000000000000000000000000AbC1");
});

async function registerSafe() {
  const res = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: SAFE });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("a real Safe cannot get a strategy until the chain says it is protected", () => {
  it.each(["needs_module", "needs_permission", "unreachable"] as const)(
    "refuses to create a strategy when the live read says %s",
    async (mode) => {
      const safeId = await registerSafe();
      chainMode = mode;
      const res = await request(app).post("/api/exit-strategies").set(authHeader(token)).send(strategyBody(safeId));
      expect(res.status).toBe(409);
      const listed = await request(app).get(`/api/exit-strategies?safeId=${safeId}`).set(authHeader(token));
      expect(listed.body).toEqual([]);
    },
  );

  it.each(["needs_module", "needs_permission", "unreachable"] as const)(
    "refuses to activate an existing strategy once the live read says %s",
    async (mode) => {
      const safeId = await registerSafe();
      const created = await request(app).post("/api/exit-strategies").set(authHeader(token)).send(strategyBody(safeId));
      expect(created.status).toBe(201);

      // Protection is re-read at activation, so a permission revoked after
      // creation stops the strategy from ever going active.
      chainMode = mode;
      const res = await request(app).post(`/api/exit-strategies/${created.body.id}/activate`).set(authHeader(token));
      expect(res.status).toBe(409);
      const after = await request(app).get(`/api/exit-strategies/${created.body.id}`).set(authHeader(token));
      expect(after.body.status).toBe("draft");
    },
  );

  it("creates and activates once the chain genuinely reports protected, and stores the module verification proved", async () => {
    const safeId = await registerSafe();
    const created = await request(app).post("/api/exit-strategies").set(authHeader(token)).send(strategyBody(safeId));
    expect(created.status).toBe(201);
    const activated = await request(app).post(`/api/exit-strategies/${created.body.id}/activate`).set(authHeader(token));
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("active");

    // Registration never stores a client-supplied module; the address here
    // can only have come from a verification that just passed.
    const safe = await request(app).get(`/api/safe-accounts/${safeId}`).set(authHeader(token));
    expect(safe.body.rolesModifierAddress.toLowerCase()).toBe(MODIFIER.toLowerCase());
  });

  it("refuses to let the Guardian act once protection disappears, and never broadcasts", async () => {
    const safeId = await registerSafe();
    const created = await request(app).post("/api/exit-strategies").set(authHeader(token)).send(strategyBody(safeId));
    await request(app).post(`/api/exit-strategies/${created.body.id}/activate`).set(authHeader(token));

    chainMode = "needs_module";
    const res = await request(app).post(`/api/exit-strategies/${created.body.id}/agent/evaluate`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.policy.safeProtectedOnChain).toBe(false);
    expect(res.body.policyPassed).toBe(false);
    expect(res.body.refusalReasons.join(" ")).toMatch(/not verifiably protected/i);
    expect(res.body.execution.status).toBe("refused");
    expect(callContractFunction).not.toHaveBeenCalled();
  });
});
