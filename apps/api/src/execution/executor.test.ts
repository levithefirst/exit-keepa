import { describe, expect, it, vi, beforeEach } from "vitest";
import { keeperHubClient } from "../keeperhub/client";
import { broadcastExitTransaction, simulateExitTransaction } from "./executor";
import type { BuiltTransaction } from "./buildTransaction";

vi.mock("../keeperhub/client", () => ({
  keeperHubClient: { callContractFunction: vi.fn() },
}));

const TX: BuiltTransaction = {
  to: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  value: "0",
  data: "0x69328dec",
  operation: 0,
  rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
  roleKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000",
  decodedFunction: "withdraw(address,uint256,address)",
  decodedArgs: {},
};

beforeEach(() => {
  vi.mocked(keeperHubClient.callContractFunction).mockReset();
});

describe("simulateExitTransaction", () => {
  it("sends simulate: true and never lets the caller override it", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: true,
      status: "simulated",
      wouldRevert: false,
    } as never);

    const result = await simulateExitTransaction(TX, 8453);
    expect(result.request.simulate).toBe(true);
    expect(result.parsed?.wouldRevert).toBe(false);
  });

  it("surfaces a revert reason from a rejected simulation", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: false,
      status: "simulated",
      wouldRevert: true,
      revertReason: "ConditionViolation(2,...)",
    } as never);

    const result = await simulateExitTransaction(TX, 8453);
    expect(result.parsed?.wouldRevert).toBe(true);
    expect(result.parsed?.revertReason).toContain("ConditionViolation");
  });
});

describe("broadcastExitTransaction", () => {
  it("sends simulate: false", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "0x" + "1".repeat(64),
    } as never);

    const result = await broadcastExitTransaction(TX, 8453);
    expect(result.request.simulate).toBe(false);
  });

  it("only trusts a well-formed 66-character hash", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "0x" + "1".repeat(64),
    } as never);

    const result = await broadcastExitTransaction(TX, 8453);
    expect(result.txHash).toBe("0x" + "1".repeat(64));
  });

  it("refuses to fabricate a transaction hash from a malformed/short value", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "not-a-real-hash",
    } as never);

    const result = await broadcastExitTransaction(TX, 8453);
    expect(result.txHash).toBeNull();
  });

  it("does not treat a reverting response as having a hash", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: false,
      wouldRevert: true,
      revertReason: "SomeError()",
    } as never);

    const result = await broadcastExitTransaction(TX, 8453);
    expect(result.txHash).toBeNull();
  });

  it("extracts the hash from a real successful-broadcast response (no wouldRevert key)", async () => {
    // Live-captured 2026-08-31: real successful broadcast
    // (0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b,
    // confirmed on Base, receipt status 0x1). This shape has no
    // `wouldRevert` field, so it never parses as
    // ExecTransactionWithRoleResult - regression test for the bug where
    // this exact response was reported as a failed execution.
    const REAL_HASH = "0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b";
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      status: "completed",
      executionId: "u9zr4vzbfurjvzgwz687g",
      transactionHash: REAL_HASH,
      transactionLink: `https://basescan.org/tx/${REAL_HASH}`,
    } as never);

    const result = await broadcastExitTransaction(TX, 8453);
    expect(result.txHash).toBe(REAL_HASH);
  });

  it.each([
    { shape: "txHash", body: { txHash: "0x" + "2".repeat(64) } },
    { shape: "hash", body: { hash: "0x" + "3".repeat(64) } },
    { shape: "result.transactionHash", body: { result: { transactionHash: "0x" + "4".repeat(64) } } },
    { shape: "data.transactionHash", body: { data: { transactionHash: "0x" + "5".repeat(64) } } },
  ])("also recognizes the $shape field name", async ({ body }) => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue(body as never);
    const result = await broadcastExitTransaction(TX, 8453);
    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
