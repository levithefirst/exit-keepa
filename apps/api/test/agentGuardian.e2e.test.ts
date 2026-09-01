import "./setup";
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createFakeDb, eq, and } from "./fakeDb";
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
  return { ...actual, keeperHubClient: { callContractFunction } };
});

const GET_RESERVE_DATA_SELECTOR = "0x35ea6a75";
const BALANCE_OF_SELECTOR = "0x70a08231";
const RAY = 10n ** 27n;

/** rateBps=100 -> supply APR 1.00% (below a 200bps threshold => condition met). */
function reserveDataHexForSupplyBps(bps: number): string {
  const words = Array.from({ length: 15 }, () => 0n);
  words[2] = (BigInt(bps) * RAY) / 10_000n; // currentLiquidityRate
  return `0x${words.map((w) => w.toString(16).padStart(64, "0")).join("")}`;
}

let currentSupplyRateBps = 100; // 1.00%, satisfies "< 200bps" by default
let currentPositionBalance = 10n ** 12n; // comfortably covers every amount these tests configure, unless overridden

vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const data: string = body?.params?.[0]?.data ?? "";
    if (data.startsWith(GET_RESERVE_DATA_SELECTOR)) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: reserveDataHexForSupplyBps(currentSupplyRateBps) }),
        { status: 200 },
      );
    }
    if (data.startsWith(BALANCE_OF_SELECTOR)) {
      const balanceHex = `0x${currentPositionBalance.toString(16).padStart(64, "0")}`;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: balanceHex }), { status: 200 });
    }
    throw new Error(`Unexpected RPC call in test: ${JSON.stringify(body)}`);
  }),
);

const { createApp } = await import("../src/app");
const app = createApp();

const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SAFE_ADDRESS = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const ROLE_KEY = "0x657869745f6b6565706100000000000000000000000000000000000000000000";

let token: string;

async function registerSafe() {
  const safeRes = await request(app)
    .post("/api/safe-accounts")
    .set(authHeader(token))
    .send({ chainId: 8453, safeAddress: SAFE_ADDRESS, rolesModifierAddress: ROLES_MODIFIER, rolesKey: ROLE_KEY });
  return safeRes.body.id as string;
}

async function createActiveStrategy() {
  return createActiveStrategyWithAmount("max");
}

async function createActiveStrategyWithAmount(amount: string) {
  const safeId = await registerSafe();
  const strategyRes = await request(app)
    .post("/api/exit-strategies")
    .set(authHeader(token))
    .send({
      safeId,
      name: "Guardian test strategy",
      condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
      action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount },
    });
  await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token));
  return strategyRes.body.id as string;
}

beforeEach(async () => {
  callContractFunction.mockReset();
  currentSupplyRateBps = 100;
  currentPositionBalance = 10n ** 12n;
  token = await createTestSession(fakeDb, "0xAbC0000000000000000000000000000000AbC2");
});

describe("Exit Guardian - approval path", () => {
  it("observes a live rate, approves, and auto-simulates - landing on 'simulated' without a manual click", async () => {
    const strategyId = await createActiveStrategy();
    callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false });

    const res = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("triggered");
    expect(res.body.conditionMet).toBe(true);
    expect(res.body.policyPassed).toBe(true);
    expect(res.body.execution.status).toBe("simulated");
    expect(res.body.executionId).toBeTruthy();

    // The receipt is independently fetchable and carries the full chain of
    // claims: intent, observation, policy check, and simulation result.
    const receiptRes = await request(app)
      .get(`/api/agent/decisions/${res.body.decisionId}`)
      .set(authHeader(token));
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.observation.rateBps).toBe(100);
    expect(receiptRes.body.policyCheck.policyPassed).toBe(true);
    expect(receiptRes.body.simulationResult.status).toBe("simulated");
  });
});

describe("Exit Guardian - refusal path", () => {
  // The "missing permission" branch of checkPolicy() is unit-tested
  // directly in src/agent/policy.test.ts. It's deliberately not exercised
  // here through real HTTP routes: POST /exit-strategies/:id/activate
  // itself calls buildExitTransaction and rejects with 409 if the Safe has
  // no Roles Modifier/key configured, so a strategy can never reach
  // `active` - the only status Exit Guardian evaluates - without Roles
  // already being configured. Given today's single-action-type schema,
  // every other policy check is in the same position: each one is a real,
  // load-bearing check (it stops a malformed transaction from ever
  // reaching KeeperHub), but none of them can currently fail for a
  // strategy that made it to `active`, because buildExitTransaction's own
  // deterministic output is what activation already required to succeed.
  // The two refusal/block categories genuinely reachable end-to-end today
  // are a simulation revert (see test/e2e.test.ts) and the broadcast-time
  // guards below.

  it("blocks a broadcast whose configured amount exceeds the Safe's live Aave position", async () => {
    const strategyId = await createActiveStrategyWithAmount("5000000"); // 5 USDC
    currentPositionBalance = 1_000_000n; // only 1 USDC actually in the position now
    callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false });

    const evalRes = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(evalRes.body.execution.status).toBe("simulated");
    const executionId = evalRes.body.executionId;

    const broadcastRes = await request(app)
      .post(`/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`)
      .set(authHeader(token));
    expect(broadcastRes.status).toBe(200);
    expect(broadcastRes.body.status).toBe("blocked");
    expect(broadcastRes.body.errorMessage).toMatch(/Amount exceeded/);
    expect(callContractFunction).toHaveBeenCalledTimes(1); // the auto-simulate only, never a broadcast attempt

    // A blocked row is a dead end - decideBroadcast rejects it same as
    // `failed`, never silently retried.
    const retryRes = await request(app)
      .post(`/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`)
      .set(authHeader(token));
    expect(retryRes.status).toBe(409);
  });

  it("does not attempt anything at all when the condition isn't met - 'normal', not a refusal", async () => {
    const strategyId = await createActiveStrategy();
    currentSupplyRateBps = 500; // above the 200bps threshold - condition not met

    const res = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("normal");
    expect(res.body.conditionMet).toBe(false);
    expect(res.body.executionId).toBeNull();
    expect(callContractFunction).not.toHaveBeenCalled();
  });
});

describe("Exit Guardian - edge-trigger prevents double execution under repeated polling", () => {
  it("attempts exactly once across repeated evaluate calls while the condition stays true", async () => {
    const strategyId = await createActiveStrategy();
    callContractFunction.mockResolvedValue({ success: true, status: "simulated", wouldRevert: false });

    const first = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(first.body.decision).toBe("triggered");
    const firstExecutionId = first.body.executionId;
    expect(firstExecutionId).toBeTruthy();

    // Simulate 5 more poll ticks with the condition still true - none of
    // them may create a second execution or call KeeperHub again.
    for (let i = 0; i < 5; i++) {
      const held = await request(app)
        .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
        .set(authHeader(token));
      expect(held.status).toBe(200);
      expect(held.body.decision).toBe("held");
      expect(held.body.executionId).toBeNull();
    }

    expect(callContractFunction).toHaveBeenCalledTimes(1); // the one auto-simulate call, never a second

    const executions = await request(app)
      .get(`/api/exit-strategies/${strategyId}/executions`)
      .set(authHeader(token));
    expect(executions.body).toHaveLength(1);
    expect(executions.body[0].id).toBe(firstExecutionId);
  });

  it("re-arms after the condition clears, allowing a genuinely new crossing to trigger a second attempt", async () => {
    const strategyId = await createActiveStrategy();
    callContractFunction.mockResolvedValue({ success: true, status: "simulated", wouldRevert: false });

    const first = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(first.body.decision).toBe("triggered");

    currentSupplyRateBps = 500; // condition clears
    const cleared = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(cleared.body.decision).toBe("normal");

    currentSupplyRateBps = 50; // crosses true again - a genuinely new occurrence
    const second = await request(app)
      .post(`/api/exit-strategies/${strategyId}/agent/evaluate`)
      .set(authHeader(token));
    expect(second.body.decision).toBe("triggered");
    expect(second.body.executionId).not.toBe(first.body.executionId);

    const executions = await request(app)
      .get(`/api/exit-strategies/${strategyId}/executions`)
      .set(authHeader(token));
    expect(executions.body).toHaveLength(2);
  });
});
