import { describe, expect, it } from "vitest";
import { decideBroadcast } from "./stateMachine";

describe("decideBroadcast", () => {
  it("proceeds only when status is exactly 'simulated' and no tx hash exists", () => {
    expect(decideBroadcast({ status: "simulated", txHash: null })).toEqual({ action: "proceed" });
  });

  it("never re-broadcasts an execution that already has a tx hash, regardless of status", () => {
    expect(decideBroadcast({ status: "simulated", txHash: "0xabc" })).toEqual({ action: "already_broadcast" });
    expect(decideBroadcast({ status: "executing", txHash: "0xabc" })).toEqual({ action: "already_broadcast" });
  });

  it("treats status 'succeeded' as already broadcast even without a stored hash", () => {
    expect(decideBroadcast({ status: "succeeded", txHash: null })).toEqual({ action: "already_broadcast" });
  });

  it("rejects broadcasting before a successful simulation", () => {
    const result = decideBroadcast({ status: "pending", txHash: null });
    expect(result.action).toBe("reject");
  });

  it("rejects a duplicate/racing broadcast request while one is already executing", () => {
    const result = decideBroadcast({ status: "executing", txHash: null });
    expect(result.action).toBe("reject");
  });

  it("rejects broadcasting a failed simulation", () => {
    const result = decideBroadcast({ status: "failed", txHash: null });
    expect(result.action).toBe("reject");
  });
});
