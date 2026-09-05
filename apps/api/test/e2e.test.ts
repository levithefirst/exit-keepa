import "./setup";
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createFakeDb, eq, and } from "./fakeDb";
import { createTestSession, authHeader } from "./authHelpers";
import { KeeperHubApiError } from "../src/keeperhub/client";

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
  return {
    ...actual,
    keeperHubClient: { callContractFunction, getDirectExecutionStatus },
  };
});

const bigBalanceHex = `0x${(10n ** 12n).toString(16).padStart(64, "0")}`;
const emptyModulesRpc = `0x${"40".padStart(64, "0")}${"1".padStart(64, "0")}${"0".padStart(64, "0")}${"1".padStart(64, "0")}`;
vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: unknown, init?: RequestInit) => {
    const raw = (init?.body as string | undefined) ?? "{}";
    let body: { method?: string; params?: unknown[] } = {};
    try { body = JSON.parse(raw) as typeof body; } catch { /* non-RPC request */ }
    const data = String((body.params?.[0] as { data?: string } | undefined)?.data ?? "");
    if (body.method === "eth_call" && data.startsWith("0xcc2f8452")) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: emptyModulesRpc }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: bigBalanceHex }), { status: 200 });
  }),
);

const { createApp } = await import("../src/app");

const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const app = createApp();

let token: string;

beforeEach(async () => {
  callContractFunction.mockReset();
  getDirectExecutionStatus.mockReset();
  token = await createTestSession(fakeDb, "0xAbC0000000000000000000000000000000AbC1");
});

describe("end-to-end: create strategy -> condition true -> simulate -> execute -> recorded", () => {
  it("walks the full authorized-execution flow and records a real, validated tx hash", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" });
    expect(safeRes.status).toBe(201); const safeId = safeRes.body.id;
    const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId, name: "Exit when USDC supply APR drops below 2%", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "1000000" } });
    expect(strategyRes.status).toBe(201); const strategyId = strategyRes.body.id; expect(strategyRes.body.status).toBe("draft");
    const previewRes = await request(app).get(`/api/exit-strategies/${strategyId}/preview`).set(authHeader(token)); expect(previewRes.status).toBe(200); expect(previewRes.body.tx.to).toBe("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"); expect(previewRes.body.tx.data.startsWith("0x69328dec")).toBe(true);
    const activateRes = await request(app).post(`/api/exit-strategies/${strategyId}/activate`).set(authHeader(token)); expect(activateRes.status).toBe(200); expect(activateRes.body.status).toBe("active");
    const createExecRes = await request(app).post(`/api/exit-strategies/${strategyId}/executions`).set(authHeader(token)).send({ currentRateBps: 150 }); expect(createExecRes.status).toBe(201); const executionId = createExecRes.body.id; expect(createExecRes.body.status).toBe("pending");
    const rejectedRes = await request(app).post(`/api/exit-strategies/${strategyId}/executions`).set(authHeader(token)).send({ currentRateBps: 500 }); expect(rejectedRes.status).toBe(422);
    callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false });
    const simRes = await request(app).post(`/api/exit-strategies/${strategyId}/executions/${executionId}/simulate`).set(authHeader(token)); expect(simRes.status).toBe(200); expect(simRes.body.status).toBe("simulated"); expect(callContractFunction.mock.calls[0][0].simulate).toBe(true);
    const REAL_HASH = "0x" + "a".repeat(64); callContractFunction.mockResolvedValueOnce({ result: REAL_HASH });
    const broadcastRes = await request(app).post(`/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`).set(authHeader(token)); expect(broadcastRes.status).toBe(200); expect(broadcastRes.body.status).toBe("succeeded"); expect(broadcastRes.body.txHash).toBe(REAL_HASH); expect(callContractFunction.mock.calls[1][0].simulate).toBe(false);
    const listRes = await request(app).get(`/api/exit-strategies/${strategyId}/executions`).set(authHeader(token)); expect(listRes.status).toBe(200); expect(listRes.body[0].txHash).toBe(REAL_HASH);
    const secondBroadcastRes = await request(app).post(`/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`).set(authHeader(token)); expect(secondBroadcastRes.status).toBe(200); expect(secondBroadcastRes.body.txHash).toBe(REAL_HASH); expect(callContractFunction).toHaveBeenCalledTimes(2);
  });

  it("Safe First-Write Sequence: persists KeeperHub's executionId, polls status, and trusts receipts over the self-reported hash", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" });
    const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Poll-status strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "1000000" } });
    await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const execRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 150 });
    callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`).set(authHeader(token));
    const KH_EXECUTION_ID = "direct_abc123"; const REAL_HASH = "0x" + "b".repeat(64); callContractFunction.mockResolvedValueOnce({ status: "completed", executionId: KH_EXECUTION_ID, transactionHash: REAL_HASH, transactionLink: `https://basescan.org/tx/${REAL_HASH}` }); getDirectExecutionStatus.mockResolvedValueOnce({ status: { executionId: KH_EXECUTION_ID, status: "completed", receipts: [{ hash: REAL_HASH, chainId: 8453, verified: true, receiptStatus: "success", blockNumber: 123 }] }, pollIntervalHintSeconds: 0 });
    const broadcastRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(token)); expect(broadcastRes.status).toBe(200); expect(broadcastRes.body.status).toBe("succeeded"); expect(broadcastRes.body.txHash).toBe(REAL_HASH); expect(broadcastRes.body.keeperhubExecutionId).toBe(KH_EXECUTION_ID); expect(getDirectExecutionStatus).toHaveBeenCalledWith(KH_EXECUTION_ID); expect(callContractFunction.mock.calls[1][1]).toEqual({ idempotencyKey: execRes.body.idempotencyKey });
  });

  it("Safe First-Write Sequence: a reverted receipt fails the execution even though the self-reported status said completed", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" }); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Reverted-receipt strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "1000000" } }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const execRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 150 }); callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`).set(authHeader(token)); const KH_EXECUTION_ID = "direct_reverted"; const REAL_HASH = "0x" + "c".repeat(64); callContractFunction.mockResolvedValueOnce({ status: "completed", executionId: KH_EXECUTION_ID, transactionHash: REAL_HASH, transactionLink: `https://basescan.org/tx/${REAL_HASH}` }); getDirectExecutionStatus.mockResolvedValueOnce({ status: { executionId: KH_EXECUTION_ID, status: "failed", receipts: [{ hash: REAL_HASH, chainId: 8453, verified: true, receiptStatus: "reverted", blockNumber: 456 }] }, pollIntervalHintSeconds: 0 }); const broadcastRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(token)); expect(broadcastRes.status).toBe(502); expect(broadcastRes.body.status).toBe("failed"); expect(broadcastRes.body.txHash).toBeNull(); expect(broadcastRes.body.errorMessage).toContain(REAL_HASH);
  });

  it("rejects a simulation-rejected execution and never lets it be broadcast", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" }); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Rejected-simulation strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" } }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const execRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 }); callContractFunction.mockResolvedValueOnce({ success: false, wouldRevert: true, revertReason: "TargetAddressNotAllowed" }); const simRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`).set(authHeader(token)); expect(simRes.body.status).toBe("failed"); const broadcastRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(token)); expect(broadcastRes.status).toBe(409); expect(callContractFunction).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a confirmed KeeperHub rejection from an ambiguous network failure on broadcast, and never lets either be retried through the same execution", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" }); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Ambiguous-broadcast-failure strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" } }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const execRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 }); callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`).set(authHeader(token)); callContractFunction.mockRejectedValueOnce(new TypeError("fetch failed")); const ambiguousRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(token)); expect(ambiguousRes.status).toBe(502); expect(ambiguousRes.body.status).toBe("failed"); expect(ambiguousRes.body.errorMessage).toMatch(/could not be confirmed/i); expect(ambiguousRes.body.txHash).toBeFalsy(); const retryRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(token)); expect(retryRes.status).toBe(409); expect(callContractFunction).toHaveBeenCalledTimes(2);
  });

  it("reports a confirmed KeeperHub rejection plainly, without the ambiguous-outcome wording", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" }); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Confirmed-rejection strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" } }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const execRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 }); callContractFunction.mockResolvedValueOnce({ success: true, status: "simulated", wouldRevert: false }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`).set(authHeader(token)); callContractFunction.mockRejectedValueOnce(new KeeperHubApiError(500, "internal server error")); const rejectedRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(token)); expect(rejectedRes.status).toBe(502); expect(rejectedRes.body.status).toBe("failed"); expect(rejectedRes.body.errorMessage).not.toMatch(/could not be confirmed/i); expect(rejectedRes.body.errorMessage).toMatch(/KeeperHub API error 500/);
  });

  it("returns the same in-flight execution instead of opening a second one on a duplicate create request", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" }); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Duplicate-create-guard strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" } }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const first = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 }); expect(first.status).toBe(201); const duplicate = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 }); expect(duplicate.status).toBe(200); expect(duplicate.body.id).toBe(first.body.id); const listRes = await request(app).get(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)); expect(listRes.body.length).toBe(1);
  });

  it("never creates two in-flight executions for genuinely concurrent create requests (P0 race)", async () => {
    const safeRes = await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9", rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE", rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000" }); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(token)).send({ safeId: safeRes.body.id, name: "Concurrent-create-guard strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" } }); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(token)); const [a, b] = await Promise.all([request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 }), request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)).send({ currentRateBps: 100 })]); expect([a.status, b.status].sort()).toEqual([200, 201]); expect(a.body.id).toBe(b.body.id); const listRes = await request(app).get(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(token)); expect(listRes.body.length).toBe(1);
  });
});

describe("demo sandbox Safe: the whole lifecycle runs, nothing reaches a chain", () => {
  it("simulates without ever calling KeeperHub, then completes the lifecycle as a labelled demo - never as a real success", async () => {
    const demoRes = await request(app).post("/api/auth/demo-session").send({}); expect(demoRes.status).toBe(200); const demoToken: string = demoRes.body.token; const mySafes = await request(app).get("/api/safe-accounts").set(authHeader(demoToken)); expect(mySafes.status).toBe(200); expect(mySafes.body.length).toBe(1); const sandboxSafe = mySafes.body[0]; expect(sandboxSafe.isSandbox).toBe(true); expect(sandboxSafe.rolesModifierAddress).toBeTruthy(); const strategyRes = await request(app).post("/api/exit-strategies").set(authHeader(demoToken)).send({ safeId: sandboxSafe.id, name: "Sandbox strategy", condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 }, action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" } }); expect(strategyRes.status).toBe(201); await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`).set(authHeader(demoToken)); const execRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions`).set(authHeader(demoToken)).send({ currentRateBps: 150 }); expect(execRes.status).toBe(201); const simRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`).set(authHeader(demoToken)); expect(simRes.status).toBe(200); expect(simRes.body.status).toBe("simulated"); expect(callContractFunction).not.toHaveBeenCalled(); const broadcastRes = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(demoToken)); expect(broadcastRes.status).toBe(200); expect(broadcastRes.body.status).toBe("demo_completed"); expect(broadcastRes.body.status).not.toBe("succeeded"); expect(broadcastRes.body.txHash).toBeNull(); expect(broadcastRes.body.broadcastAt).toBeNull(); expect(broadcastRes.body.responsePayload.sandbox).toBe(true); expect(broadcastRes.body.responsePayload.note).toMatch(/nothing was sent to any blockchain/i); expect(callContractFunction).not.toHaveBeenCalled(); const replay = await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`).set(authHeader(demoToken)); expect(replay.status).toBe(409); expect(callContractFunction).not.toHaveBeenCalled();
  });
  it("gives every demo session its own isolated identity and sandbox Safe", async () => { const first = await request(app).post("/api/auth/demo-session").send({}); const second = await request(app).post("/api/auth/demo-session").send({}); expect(first.body.address).not.toBe(second.body.address); const firstSafes = await request(app).get("/api/safe-accounts").set(authHeader(first.body.token)); const secondSafes = await request(app).get("/api/safe-accounts").set(authHeader(second.body.token)); expect(firstSafes.body.length).toBe(1); expect(secondSafes.body.length).toBe(1); expect(firstSafes.body[0].id).not.toBe(secondSafes.body[0].id); expect(firstSafes.body[0].safeAddress).not.toBe(secondSafes.body[0].safeAddress); const crossRead = await request(app).get(`/api/safe-accounts/${secondSafes.body[0].id}`).set(authHeader(first.body.token)); expect(crossRead.status).toBe(403); });
});

describe("Safe authorization status - onboarding reads chain, not assumptions", () => {
  async function registerRealSafe(safeAddress: string) { return await request(app).post("/api/safe-accounts").set(authHeader(token)).send({ chainId: 8453, safeAddress }); }
  it("registers a Safe from its address alone - no module address, no role key", async () => { const res = await registerRealSafe("0x00000000000000000000000000000000000000aa"); expect(res.status).toBe(201); expect(res.body.rolesModifierAddress).toBeNull(); expect(res.body.rolesKey).toBeNull(); });
  it("STATE 1: a Safe with no Zodiac module reports needs_module and stays unprotected", async () => { const safe = await registerRealSafe("0x00000000000000000000000000000000000000bb"); const res = await request(app).get(`/api/safe-accounts/${safe.body.id}/authorization`).set(authHeader(token)); expect(res.status).toBe(200); expect(res.body.state).toBe("needs_module"); expect(res.body.state).not.toBe("protected"); expect(res.body.detectedModifierAddress).toBeNull(); expect(res.body.undetermined).toBeNull(); expect(res.body.enabledModules).toEqual([]); expect(res.body.summary).toMatch(/one-time setup/i); });
  it("a demo sandbox Safe is protected without any chain read or KeeperHub call", async () => { const demoRes = await request(app).post("/api/auth/demo-session").send({}); const demoToken: string = demoRes.body.token; const safes = await request(app).get("/api/safe-accounts").set(authHeader(demoToken)); const res = await request(app).get(`/api/safe-accounts/${safes.body[0].id}/authorization`).set(authHeader(demoToken)); expect(res.status).toBe(200); expect(res.body.state).toBe("protected"); expect(res.body.permissionChecked).toBe(false); expect(res.body.summary).toMatch(/demo sandbox/i); expect(callContractFunction).not.toHaveBeenCalled(); });
  it("refuses to report authorization for a Safe the session does not own", async () => { const safe = await registerRealSafe("0x00000000000000000000000000000000000000cc"); const otherToken = await createTestSession(fakeDb, "0xDdD0000000000000000000000000000000000dDd"); const res = await request(app).get(`/api/safe-accounts/${safe.body.id}/authorization`).set(authHeader(otherToken)); expect(res.status).toBe(403); });
});
