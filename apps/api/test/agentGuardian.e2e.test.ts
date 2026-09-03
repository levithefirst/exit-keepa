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

const { callContractFunction, getDirectExecutionStatus } = vi.hoisted(() => ({
  callContractFunction: vi.fn(),
  getDirectExecutionStatus: vi.fn(),
}));
vi.mock("../src/keeperhub/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/keeperhub/client")>();
  return { ...actual, keeperHubClient: { callContractFunction, getDirectExecutionStatus } };
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
const REAL_TX_HASH = "0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b";

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

/** A clean simulate answer, followed by a broadcast that KeeperHub accepts. */
function mockCleanSimulateThenBroadcast(executionId = "direct_test_1") {
  callContractFunction.mockImplementation(async (req: { simulate?: boolean }) => {
    if (req.simulate) return { success: true, status: "simulated", wouldRevert: false };
    return { status: "completed", executionId, transactionHash: REAL_TX_HASH, transactionLink: "https://basescan.org" };
  });
}

/** KeeperHub's status endpoint answering with a verified on-chain receipt (terminal). */
function mockVerifiedSuccessStatus(executionId = "direct_test_1") {
  getDirectExecutionStatus.mockResolvedValue({
    status: {
      executionId,
      status: "completed",
      receipts: [{ hash: REAL_TX_HASH, chainId: 8453, verified: true, receiptStatus: "success" }],
    },
    pollIntervalHintSeconds: 0,
  });
}

function executionsOf(strategyId: string) {
  return request(app).get(`/api/exit-strategies/${strategyId}/executions`).set(authHeader(token));
}

beforeEach(async () => {
  callContractFunction.mockReset();
  getDirectExecutionStatus.mockReset();
  currentSupplyRateBps = 100;
  currentPositionBalance = 10n ** 12n;
  token = await createTestSession(fakeDb, "0xAbC0000000000000000000000000000000AbC2");
});

describe("Exit Guardian - the autonomous lifecycle runs to completion on its own", () => {
  it("F+G: a clean simulation is broadcast automatically, and the confirmed onchain status is persisted - no manual step anywhere", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    mockVerifiedSuccessStatus();

    // One evaluate tick. Nothing else is called - no create, no simulate,
    // no broadcast, no status refresh.
    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("triggered");
    expect(res.body.conditionMet).toBe(true);
    expect(res.body.policyPassed).toBe(true);

    // The receipt the tick returns already describes a COMPLETE lifecycle:
    // confirmed onchain, with the hash and KeeperHub's own execution id.
    expect(res.body.execution.status).toBe("succeeded");
    expect(res.body.execution.txHash).toBe(REAL_TX_HASH);
    expect(res.body.execution.keeperhubExecutionId).toBe("direct_test_1");
    expect(res.body.execution.broadcastAt).toBeTruthy();

    // Simulate first, then broadcast - in that order, exactly once each.
    expect(callContractFunction).toHaveBeenCalledTimes(2);
    expect(callContractFunction.mock.calls[0][0].simulate).toBe(true);
    expect(callContractFunction.mock.calls[1][0].simulate).toBe(false);
    // The broadcast carried the execution row's own stable Idempotency-Key.
    expect(callContractFunction.mock.calls[1][1]).toEqual({ idempotencyKey: res.body.executionId });
    // The status endpoint - not the self-reported broadcast body - is what
    // settled this as succeeded.
    expect(getDirectExecutionStatus).toHaveBeenCalledWith("direct_test_1");

    // And the persisted row agrees with the receipt.
    const receiptRes = await request(app)
      .get(`/api/agent/decisions/${res.body.decisionId}`)
      .set(authHeader(token));
    expect(receiptRes.body.finalOnchainResult.status).toBe("succeeded");
    expect(receiptRes.body.finalOnchainResult.txHash).toBe(REAL_TX_HASH);
  });

  it("H: an ambiguous KeeperHub outcome is never reported as successful", async () => {
    const strategyId = await createActiveStrategy();
    callContractFunction.mockImplementation(async (req: { simulate?: boolean }) => {
      if (req.simulate) return { success: true, status: "simulated", wouldRevert: false };
      // No HTTP response at all - we genuinely do not know whether
      // KeeperHub received and broadcast this.
      throw new Error("fetch failed: socket hang up");
    });

    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));

    expect(res.body.execution.status).not.toBe("succeeded");
    expect(res.body.execution.txHash).toBeFalsy();
    expect(res.body.execution.errorMessage).toMatch(/could not be confirmed/i);
    expect(res.body.execution.errorMessage).toMatch(/BaseScan/i);
  });

  it("H: a broadcast left non-terminal stays 'executing' - not succeeded, not failed", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    // Broadcast accepted, but the receipt is not yet verified on-chain.
    getDirectExecutionStatus.mockResolvedValue({
      status: {
        executionId: "direct_test_1",
        status: "unconfirmed",
        receipts: [{ hash: REAL_TX_HASH, chainId: 8453, verified: false, receiptStatus: "not_found" }],
      },
      pollIntervalHintSeconds: 0,
    });

    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));

    expect(res.body.execution.status).toBe("executing");
    expect(res.body.execution.broadcastAt).toBeNull();
    expect(res.body.execution.keeperhubExecutionId).toBe("direct_test_1");
  });

  it("E: a failing simulation is never broadcast", async () => {
    const strategyId = await createActiveStrategy();
    callContractFunction.mockImplementation(async (req: { simulate?: boolean }) => {
      if (req.simulate) return { success: false, status: "simulated", wouldRevert: true, revertReason: "ConditionViolation()" };
      throw new Error("A broadcast must never be attempted after a failed simulation");
    });

    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));

    expect(res.body.execution.status).toBe("failed");
    expect(res.body.execution.txHash).toBeFalsy();
    // The simulate call and nothing else.
    expect(callContractFunction).toHaveBeenCalledTimes(1);
    expect(callContractFunction.mock.calls[0][0].simulate).toBe(true);
    expect(getDirectExecutionStatus).not.toHaveBeenCalled();
  });

  it("K: a demo sandbox Safe runs the same lifecycle to a clearly-labelled demo completion, with no chain call and no tx hash", async () => {
    const demoRes = await request(app).post("/api/auth/demo-session").send({});
    const demoToken: string = demoRes.body.token;
    const safes = await request(app).get("/api/safe-accounts").set(authHeader(demoToken));
    const sandboxSafe = safes.body[0];
    expect(sandboxSafe.isSandbox).toBe(true);

    const strategyRes = await request(app)
      .post("/api/exit-strategies")
      .set(authHeader(demoToken))
      .send({
        safeId: sandboxSafe.id,
        name: "Sandbox autonomous strategy",
        condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
        action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" },
      });
    await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(demoToken));

    const res = await request(app)
      .post(`/api/exit-strategies/${strategyRes.body.id}/agent/evaluate`)
      .set(authHeader(demoToken));

    expect(res.body.decision).toBe("triggered");
    expect(res.body.policyPassed).toBe(true);
    expect(res.body.execution.status).toBe("demo_completed");
    // The one thing a demo must never do: claim a transaction happened.
    expect(res.body.execution.status).not.toBe("succeeded");
    expect(res.body.execution.txHash).toBeNull();
    expect(res.body.execution.broadcastAt).toBeNull();
    expect(callContractFunction).not.toHaveBeenCalled();
    expect(getDirectExecutionStatus).not.toHaveBeenCalled();
  });
});

describe("Exit Guardian - the unattended poller drives the same path with no HTTP call at all", () => {
  it("activating a strategy is the last thing a user does: one background poll tick takes it all the way to a finished exit", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    mockVerifiedSuccessStatus();

    // No request(app) anywhere here - this is the loop agent/poller.ts runs
    // on its own interval in production, with nobody watching.
    const { runPollTick } = await import("../src/agent/poller");
    const tick = await runPollTick();
    expect(tick.errored).toBe(0);
    expect(tick.evaluated).toBeGreaterThan(0);

    const executions = await executionsOf(strategyId);
    expect(executions.body).toHaveLength(1);
    expect(executions.body[0].status).toBe("succeeded");
    expect(executions.body[0].txHash).toBe(REAL_TX_HASH);

    // And a second tick, with the condition still true, changes nothing.
    await runPollTick();
    const after = await executionsOf(strategyId);
    expect(after.body).toHaveLength(1);
    expect(callContractFunction).toHaveBeenCalledTimes(2);
  });
});

describe("Exit Guardian - refusal and pre-broadcast guards stop short of the chain", () => {
  // The "missing permission" branch of checkPolicy() is unit-tested
  // directly in src/agent/policy.test.ts. It's deliberately not exercised
  // here through real HTTP routes: POST /exit-strategies/:id/activate
  // itself calls buildExitTransaction and rejects with 409 if the Safe has
  // no Roles Modifier/key configured, so a strategy can never reach
  // `active` - the only status Exit Guardian evaluates - without Roles
  // already being configured.

  it("D: a strategy whose configured amount exceeds the Safe's live Aave position is blocked before anything is broadcast", async () => {
    const strategyId = await createActiveStrategyWithAmount("5000000"); // 5 USDC
    currentPositionBalance = 1_000_000n; // only 1 USDC actually in the position now
    mockCleanSimulateThenBroadcast();

    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));

    expect(res.body.execution.status).toBe("blocked");
    expect(res.body.execution.errorMessage).toMatch(/Amount exceeded/);
    // The auto-simulate only - the guard fired before the broadcast.
    expect(callContractFunction).toHaveBeenCalledTimes(1);
    expect(callContractFunction.mock.calls[0][0].simulate).toBe(true);

    // A blocked row is a dead end - decideBroadcast rejects it same as
    // `failed`, never silently retried, including through the manual
    // recovery route.
    const retryRes = await request(app)
      .post(`/api/exit-strategies/${strategyId}/executions/${res.body.executionId}/broadcast`)
      .set(authHeader(token));
    expect(retryRes.status).toBe(409);
    expect(callContractFunction).toHaveBeenCalledTimes(1);
  });

  it("A: does not attempt anything at all when the condition isn't met - 'normal', not a refusal", async () => {
    const strategyId = await createActiveStrategy();
    currentSupplyRateBps = 500; // above the 200bps threshold - condition not met

    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("normal");
    expect(res.body.conditionMet).toBe(false);
    expect(res.body.executionId).toBeNull();
    expect(callContractFunction).not.toHaveBeenCalled();

    const list = await executionsOf(strategyId);
    expect(list.body).toHaveLength(0);
  });
});

describe("Exit Guardian - edge-trigger prevents double execution under repeated polling", () => {
  it("B+C+I: attempts exactly once across repeated evaluate calls while the condition stays true", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    mockVerifiedSuccessStatus();

    const first = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
    expect(first.body.decision).toBe("triggered");
    expect(first.body.execution.status).toBe("succeeded");
    const firstExecutionId = first.body.executionId;

    // Five more poll ticks with the condition still true - none may create
    // a second execution or reach KeeperHub again.
    for (let i = 0; i < 5; i++) {
      const held = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
      expect(held.status).toBe(200);
      expect(held.body.decision).toBe("held");
      expect(held.body.executionId).toBeNull();
    }

    // The one simulate + the one broadcast from the first tick, and nothing more.
    expect(callContractFunction).toHaveBeenCalledTimes(2);

    const executions = await executionsOf(strategyId);
    expect(executions.body).toHaveLength(1);
    expect(executions.body[0].id).toBe(firstExecutionId);
  });

  it("C: concurrent poll ticks racing the same crossing produce exactly one execution", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    mockVerifiedSuccessStatus();

    const [a, b, c] = await Promise.all([
      request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token)),
      request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token)),
      request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token)),
    ]);

    const triggered = [a, b, c].filter((r) => r.body.decision === "triggered");
    expect(triggered).toHaveLength(1);

    const executions = await executionsOf(strategyId);
    expect(executions.body).toHaveLength(1);
    expect(callContractFunction).toHaveBeenCalledTimes(2); // one simulate, one broadcast
  });

  it("J: a manual retry against an already-executed row never broadcasts a second time under the same key", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    mockVerifiedSuccessStatus();

    const res = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
    expect(res.body.execution.status).toBe("succeeded");
    const callsAfterAutonomousRun = callContractFunction.mock.calls.length;

    // Someone hits the manual recovery endpoint on the same row.
    const retry = await request(app)
      .post(`/api/exit-strategies/${strategyId}/executions/${res.body.executionId}/broadcast`)
      .set(authHeader(token));
    expect(retry.status).toBe(200);
    expect(retry.body.txHash).toBe(REAL_TX_HASH);
    // Short-circuited as "already broadcast" - nothing new was sent.
    expect(callContractFunction).toHaveBeenCalledTimes(callsAfterAutonomousRun);
  });

  it("re-arms after the condition clears, allowing a genuinely new crossing to trigger a second attempt", async () => {
    const strategyId = await createActiveStrategy();
    mockCleanSimulateThenBroadcast();
    mockVerifiedSuccessStatus();

    const first = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
    expect(first.body.decision).toBe("triggered");

    currentSupplyRateBps = 500; // condition clears
    const cleared = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
    expect(cleared.body.decision).toBe("normal");

    currentSupplyRateBps = 50; // crosses true again - a genuinely new occurrence
    const second = await request(app).post(`/api/exit-strategies/${strategyId}/agent/evaluate`).set(authHeader(token));
    expect(second.body.decision).toBe("triggered");
    expect(second.body.executionId).not.toBe(first.body.executionId);

    const executions = await executionsOf(strategyId);
    expect(executions.body).toHaveLength(2);
  });
});
