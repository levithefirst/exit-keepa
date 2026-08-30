import "./setup";
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createFakeDb, eq, and } from "./fakeDb";

const fakeDb = createFakeDb();

vi.mock("../src/db", () => ({ db: fakeDb }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq, and };
});

const callContractFunction = vi.fn();
vi.mock("../src/keeperhub/client", () => ({
  keeperHubClient: { callContractFunction },
}));

// Imported after the mocks above so every route picks up the fakes.
const { createApp } = await import("../src/app");

const AAVE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const app = createApp();

beforeEach(() => {
  callContractFunction.mockReset();
});

describe("end-to-end: create strategy -> condition true -> simulate -> execute -> recorded", () => {
  it("walks the full authorized-execution flow and records a real, validated tx hash", async () => {
    // 1. Register the Safe with Roles already configured (as if the
    //    minimal-scope permission from the Roles spec had been granted).
    const safeRes = await request(app)
      .post("/api/safe-accounts")
      .send({
        chainId: 8453,
        safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
        rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
        rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000",
      });
    expect(safeRes.status).toBe(201);
    const safeId = safeRes.body.id;

    // 2. Create the strategy.
    const strategyRes = await request(app)
      .post("/api/exit-strategies")
      .send({
        safeId,
        name: "Exit when USDC supply APR drops below 2%",
        condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
        action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "1000000" },
      });
    expect(strategyRes.status).toBe(201);
    const strategyId = strategyRes.body.id;
    expect(strategyRes.body.status).toBe("draft");

    // 3. Preview the exact transaction before doing anything irreversible.
    const previewRes = await request(app).get(`/api/exit-strategies/${strategyId}/preview`);
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.tx.to).toBe("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5");
    expect(previewRes.body.tx.data.startsWith("0x69328dec")).toBe(true);

    // 4. Activate.
    const activateRes = await request(app).post(`/api/exit-strategies/${strategyId}/activate`);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.status).toBe("active");

    // 5. Condition becomes true (rate at 150bps < 200bps threshold) ->
    //    create an execution attempt. Server re-verifies the condition
    //    itself rather than trusting the caller's claim blindly.
    const createExecRes = await request(app)
      .post(`/api/exit-strategies/${strategyId}/executions`)
      .send({ currentRateBps: 150 });
    expect(createExecRes.status).toBe(201);
    const executionId = createExecRes.body.id;
    expect(createExecRes.body.status).toBe("pending");

    // A rate that does NOT satisfy the condition must be rejected.
    const rejectedRes = await request(app)
      .post(`/api/exit-strategies/${strategyId}/executions`)
      .send({ currentRateBps: 500 });
    expect(rejectedRes.status).toBe(422);

    // 6. Simulate - KeeperHub reports the call would succeed.
    callContractFunction.mockResolvedValueOnce({
      success: true,
      status: "simulated",
      wouldRevert: false,
    });
    const simRes = await request(app).post(
      `/api/exit-strategies/${strategyId}/executions/${executionId}/simulate`,
    );
    expect(simRes.status).toBe(200);
    expect(simRes.body.status).toBe("simulated");
    expect(callContractFunction.mock.calls[0][0].simulate).toBe(true);

    // 7. Broadcast (authorized execution) - KeeperHub returns a real hash.
    const REAL_HASH = "0x" + "a".repeat(64);
    callContractFunction.mockResolvedValueOnce({ result: REAL_HASH });
    const broadcastRes = await request(app).post(
      `/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`,
    );
    expect(broadcastRes.status).toBe(200);
    expect(broadcastRes.body.status).toBe("succeeded");
    expect(broadcastRes.body.txHash).toBe(REAL_HASH);
    expect(callContractFunction.mock.calls[1][0].simulate).toBe(false);

    // 8. The result is recorded and visible.
    const listRes = await request(app).get(`/api/exit-strategies/${strategyId}/executions`);
    expect(listRes.status).toBe(200);
    expect(listRes.body[0].txHash).toBe(REAL_HASH);

    // 9. Idempotency: retrying the broadcast must NEVER call KeeperHub
    //    again or change the recorded hash.
    const secondBroadcastRes = await request(app).post(
      `/api/exit-strategies/${strategyId}/executions/${executionId}/broadcast`,
    );
    expect(secondBroadcastRes.status).toBe(200);
    expect(secondBroadcastRes.body.txHash).toBe(REAL_HASH);
    expect(callContractFunction).toHaveBeenCalledTimes(2); // not 3
  });

  it("rejects a simulation-rejected execution and never lets it be broadcast", async () => {
    const safeRes = await request(app)
      .post("/api/safe-accounts")
      .send({
        chainId: 8453,
        safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
        rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
        rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000",
      });
    const strategyRes = await request(app)
      .post("/api/exit-strategies")
      .send({
        safeId: safeRes.body.id,
        name: "Rejected-simulation strategy",
        condition: { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 200 },
        action: { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_USDC, amount: "max" },
      });
    await request(app).post(`/api/exit-strategies/${strategyRes.body.id}/activate`);
    const execRes = await request(app)
      .post(`/api/exit-strategies/${strategyRes.body.id}/executions`)
      .send({ currentRateBps: 100 });

    callContractFunction.mockResolvedValueOnce({
      success: false,
      wouldRevert: true,
      revertReason: "TargetAddressNotAllowed",
    });
    const simRes = await request(app).post(
      `/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/simulate`,
    );
    expect(simRes.body.status).toBe("failed");

    const broadcastRes = await request(app).post(
      `/api/exit-strategies/${strategyRes.body.id}/executions/${execRes.body.id}/broadcast`,
    );
    expect(broadcastRes.status).toBe(409);
    expect(callContractFunction).toHaveBeenCalledTimes(1); // simulate only, never broadcast
  });
});
