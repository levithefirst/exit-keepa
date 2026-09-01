import { describe, expect, it } from "vitest";
import { deriveExecutionOutcomeFromStatus } from "./statusOutcome";
import type { DirectExecutionStatusResponse } from "../keeperhub/types";

const HASH = "0x" + "a".repeat(64);

function status(overrides: Partial<DirectExecutionStatusResponse> = {}): DirectExecutionStatusResponse {
  return { executionId: "direct_123", status: "unconfirmed", receipts: [], ...overrides };
}

describe("deriveExecutionOutcomeFromStatus", () => {
  it("succeeds only once every claimed receipt is verified and the successful one is used as the hash", () => {
    const outcome = deriveExecutionOutcomeFromStatus(
      status({
        status: "completed",
        receipts: [{ hash: HASH, chainId: 8453, verified: true, receiptStatus: "success", blockNumber: 1 }],
      }),
      null,
    );
    expect(outcome).toEqual({ status: "succeeded", txHash: HASH, errorMessage: null });
  });

  it("stays non-terminal while a receipt exists but is not yet verified, even if the top-level status says completed", () => {
    const outcome = deriveExecutionOutcomeFromStatus(
      status({
        status: "completed",
        receipts: [{ hash: HASH, chainId: 8453, verified: false, receiptStatus: "success", blockNumber: 1 }],
      }),
      HASH,
    );
    expect(outcome.status).toBe("executing");
    expect(outcome.txHash).toBe(HASH);
  });

  it("fails on a verified reverted receipt and never reports a hash for it", () => {
    const outcome = deriveExecutionOutcomeFromStatus(
      status({
        status: "failed",
        receipts: [{ hash: HASH, chainId: 8453, verified: true, receiptStatus: "reverted", blockNumber: 1 }],
      }),
      HASH,
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.txHash).toBeNull();
    expect(outcome.errorMessage).toContain(HASH);
    expect(outcome.errorMessage).toContain("reverted");
  });

  it("fails on safe_inner_failure - the outer tx succeeded but the wrapped inner call failed", () => {
    const outcome = deriveExecutionOutcomeFromStatus(
      status({
        status: "failed",
        receipts: [{ hash: HASH, chainId: 8453, verified: true, receiptStatus: "safe_inner_failure", blockNumber: 1 }],
      }),
      HASH,
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toContain("inner call failed");
  });

  it("treats a real successful receipt as authoritative even when a second receipt on the same execution is still unverified", () => {
    // Receipts win over the self-reported status, but "all verified" is
    // required before declaring success outright - a mixed set stays
    // non-terminal rather than reporting success on partial information.
    const outcome = deriveExecutionOutcomeFromStatus(
      status({
        status: "completed",
        receipts: [
          { hash: HASH, chainId: 8453, verified: true, receiptStatus: "success", blockNumber: 1 },
          { hash: "0x" + "b".repeat(64), chainId: 8453, verified: false, receiptStatus: "success", blockNumber: 2 },
        ],
      }),
      null,
    );
    expect(outcome.status).toBe("executing");
  });

  it("stays non-terminal when every receipt is stuck at not_found/timeout - never guesses success or failure", () => {
    const outcome = deriveExecutionOutcomeFromStatus(
      status({
        status: "unconfirmed",
        receipts: [{ hash: HASH, chainId: 8453, verified: false, receiptStatus: "timeout", blockNumber: undefined }],
      }),
      HASH,
    );
    expect(outcome.status).toBe("executing");
    expect(outcome.txHash).toBe(HASH);
  });

  it("fails when the top-level status is failed and there are no receipts at all", () => {
    const outcome = deriveExecutionOutcomeFromStatus(status({ status: "failed", receipts: [], error: "reverted: x" }), null);
    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toBe("reverted: x");
  });

  it("does not invent success from a bare 'completed' status with zero receipts and no fallback hash", () => {
    const outcome = deriveExecutionOutcomeFromStatus(status({ status: "completed", receipts: [] }), null);
    expect(outcome.status).toBe("failed");
    expect(outcome.txHash).toBeNull();
  });

  it("stays executing (not succeeded) for a bare 'completed' status with zero receipts but a validated fallback hash - waiting for confirmation", () => {
    const outcome = deriveExecutionOutcomeFromStatus(status({ status: "completed", receipts: [] }), HASH);
    expect(outcome.status).toBe("executing");
    expect(outcome.txHash).toBeNull(); // only a verified receipt hash is ever returned as authoritative
  });

  it("stays executing for pending/running/unconfirmed statuses with no receipts yet", () => {
    for (const s of ["pending", "running", "unconfirmed"] as const) {
      const outcome = deriveExecutionOutcomeFromStatus(status({ status: s, receipts: [] }), null);
      expect(outcome.status).toBe("executing");
    }
  });

  it("treats an unrecognized status string as non-terminal rather than crashing or guessing", () => {
    const outcome = deriveExecutionOutcomeFromStatus(status({ status: "some_future_status" as never, receipts: [] }), null);
    expect(outcome.status).toBe("executing");
  });
});
