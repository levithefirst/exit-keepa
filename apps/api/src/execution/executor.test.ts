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
});
