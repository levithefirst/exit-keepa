import { describe, expect, it, vi, beforeEach } from "vitest";
import { keeperHubClient, KeeperHubApiError, KeeperHubIdempotencyInProgressError } from "../keeperhub/client";
import {
  broadcastExitTransaction,
  broadcastWithIdempotencyRetry,
  isAmbiguousKeeperHubError,
  pollDirectExecutionStatus,
  simulateExitTransaction,
} from "./executor";
import type { BuiltTransaction } from "./buildTransaction";
import type { DirectExecutionStatusResponse } from "../keeperhub/types";

// importOriginal so the real error classes (KeeperHubApiError and its
// idempotency subclasses) survive the mock - only keeperHubClient itself
// is replaced. Without this, `instanceof KeeperHubApiError` checks in
// executor.ts would compare against `undefined` and throw.
vi.mock("../keeperhub/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../keeperhub/client")>();
  return {
    ...actual,
    keeperHubClient: { callContractFunction: vi.fn(), getDirectExecutionStatus: vi.fn() },
  };
});

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
  vi.mocked(keeperHubClient.getDirectExecutionStatus).mockReset();
});

function statusResponse(overrides: Partial<DirectExecutionStatusResponse> = {}): DirectExecutionStatusResponse {
  return { executionId: "direct_123", status: "unconfirmed", receipts: [], ...overrides };
}

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

  it("never attaches an Idempotency-Key to a simulate: true call, per KeeperHub's docs that dry runs are unaffected", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: true,
      status: "simulated",
      wouldRevert: false,
    } as never);

    await simulateExitTransaction(TX, 8453);
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledWith(
      expect.objectContaining({ simulate: true }),
      undefined,
    );
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

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.request.simulate).toBe(false);
  });

  it("attaches the given Idempotency-Key to the real broadcast call", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "0x" + "1".repeat(64),
    } as never);

    await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledWith(
      expect.objectContaining({ simulate: false }),
      { idempotencyKey: "test-idem-key" },
    );
  });

  it("only trusts a well-formed 66-character hash", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "0x" + "1".repeat(64),
    } as never);

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.txHash).toBe("0x" + "1".repeat(64));
  });

  it("refuses to fabricate a transaction hash from a malformed/short value", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "not-a-real-hash",
    } as never);

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.txHash).toBeNull();
  });

  it("does not treat a reverting response as having a hash", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: false,
      wouldRevert: true,
      revertReason: "SomeError()",
    } as never);

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
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

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.txHash).toBe(REAL_HASH);
  });

  it.each([
    { shape: "txHash", body: { txHash: "0x" + "2".repeat(64) } },
    { shape: "hash", body: { hash: "0x" + "3".repeat(64) } },
    { shape: "result.transactionHash", body: { result: { transactionHash: "0x" + "4".repeat(64) } } },
    { shape: "data.transactionHash", body: { data: { transactionHash: "0x" + "5".repeat(64) } } },
  ])("also recognizes the $shape field name", async ({ body }) => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue(body as never);
    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("persists keeperhubExecutionId from a real broadcast response, and idempotentReplay when present", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      status: "completed",
      executionId: "direct_abc",
      transactionHash: "0x" + "9".repeat(64),
      idempotentReplay: true,
    } as never);

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.keeperhubExecutionId).toBe("direct_abc");
    expect(result.idempotentReplay).toBe(true);
  });

  it("keeperhubExecutionId is undefined (not fabricated) when the response never carried one", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      result: "0x" + "1".repeat(64),
    } as never);

    const result = await broadcastExitTransaction(TX, 8453, "test-idem-key");
    expect(result.keeperhubExecutionId).toBeUndefined();
    expect(result.idempotentReplay).toBe(false);
  });
});

describe("pollDirectExecutionStatus", () => {
  it("returns immediately, terminal, when the first poll's hint is 0", async () => {
    vi.mocked(keeperHubClient.getDirectExecutionStatus).mockResolvedValueOnce({
      status: statusResponse({ status: "completed" }),
      pollIntervalHintSeconds: 0,
    });

    const result = await pollDirectExecutionStatus("direct_123");
    expect(result.terminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(keeperHubClient.getDirectExecutionStatus).toHaveBeenCalledTimes(1);
  });

  it("backs off using the poll-interval hint between non-terminal polls, then returns once terminal", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(keeperHubClient.getDirectExecutionStatus)
      .mockResolvedValueOnce({ status: statusResponse({ status: "unconfirmed" }), pollIntervalHintSeconds: 2 })
      .mockResolvedValueOnce({ status: statusResponse({ status: "unconfirmed" }), pollIntervalHintSeconds: 2 })
      .mockResolvedValueOnce({ status: statusResponse({ status: "completed" }), pollIntervalHintSeconds: 0 });

    const result = await pollDirectExecutionStatus("direct_123", { sleep, budgetMs: 60_000 });

    expect(result.terminal).toBe(true);
    expect(keeperHubClient.getDirectExecutionStatus).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000); // the server's hint, honored verbatim (within min/max bounds)
  });

  it("stops and reports timedOut once the budget is exhausted, without exceeding it", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(keeperHubClient.getDirectExecutionStatus).mockResolvedValue({
      status: statusResponse({ status: "unconfirmed" }),
      pollIntervalHintSeconds: 10, // clamps to maxIntervalMs, still never reaches terminal
    });

    const result = await pollDirectExecutionStatus("direct_123", {
      sleep,
      budgetMs: 1, // effectively zero - the first check should already exceed it
    });

    expect(result.terminal).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("propagates a poll error immediately rather than retrying an ambiguous status check", async () => {
    vi.mocked(keeperHubClient.getDirectExecutionStatus).mockRejectedValueOnce(new KeeperHubApiError(500, "internal"));
    await expect(pollDirectExecutionStatus("direct_123")).rejects.toBeInstanceOf(KeeperHubApiError);
    expect(keeperHubClient.getDirectExecutionStatus).toHaveBeenCalledTimes(1);
  });

  it("defaults the wait to minIntervalMs when the server sends no poll-interval hint at all", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(keeperHubClient.getDirectExecutionStatus)
      .mockResolvedValueOnce({ status: statusResponse({ status: "pending" }), pollIntervalHintSeconds: null })
      .mockResolvedValueOnce({ status: statusResponse({ status: "completed" }), pollIntervalHintSeconds: 0 });

    await pollDirectExecutionStatus("direct_123", { sleep, minIntervalMs: 1_500, budgetMs: 60_000 });
    expect(sleep).toHaveBeenCalledWith(1_500);
  });
});

describe("isAmbiguousKeeperHubError", () => {
  it("is false for a confirmed KeeperHubApiError", () => {
    expect(isAmbiguousKeeperHubError(new KeeperHubApiError(500, "x"))).toBe(false);
  });

  it("is true for a plain network-level error", () => {
    expect(isAmbiguousKeeperHubError(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("broadcastWithIdempotencyRetry", () => {
  it("returns the result immediately on a normal success - no retry needed", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({ result: "0x" + "1".repeat(64) } as never);
    const result = await broadcastWithIdempotencyRetry(TX, 8453, "key-1");
    expect(result.txHash).toBe("0x" + "1".repeat(64));
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledTimes(1);
  });

  it("retries with the SAME idempotency key on idempotency_in_progress, per the docs' explicit guidance", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(keeperHubClient.callContractFunction)
      .mockRejectedValueOnce(new KeeperHubIdempotencyInProgressError(409, "in progress"))
      .mockResolvedValueOnce({ status: "completed", executionId: "direct_1", transactionHash: "0x" + "2".repeat(64) } as never);

    const result = await broadcastWithIdempotencyRetry(TX, 8453, "key-1", { sleep, retryDelayMs: 500 });

    expect(result.txHash).toBe("0x" + "2".repeat(64));
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledTimes(2);
    // Every call must have used the identical key - never rotated.
    for (const call of vi.mocked(keeperHubClient.callContractFunction).mock.calls) {
      expect(call[1]).toEqual({ idempotencyKey: "key-1" });
    }
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("gives up after maxAttempts and rethrows the in-progress error rather than looping forever", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(keeperHubClient.callContractFunction).mockRejectedValue(
      new KeeperHubIdempotencyInProgressError(409, "still in progress"),
    );

    await expect(
      broadcastWithIdempotencyRetry(TX, 8453, "key-1", { sleep, maxAttempts: 3, retryDelayMs: 10 }),
    ).rejects.toBeInstanceOf(KeeperHubIdempotencyInProgressError);
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledTimes(3);
  });

  it("never retries any other error, including a plain ambiguous network failure", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.mocked(keeperHubClient.callContractFunction).mockRejectedValue(new TypeError("fetch failed"));

    await expect(broadcastWithIdempotencyRetry(TX, 8453, "key-1", { sleep })).rejects.toBeInstanceOf(TypeError);
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
