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

  it("rejects broadcasting an execution the Guardian already refused by policy", () => {
    const result = decideBroadcast({ status: "refused", txHash: null });
    expect(result.action).toBe("reject");
  });

  it("rejects broadcasting an execution blocked at broadcast time (stale intent / amount exceeded)", () => {
    const result = decideBroadcast({ status: "blocked", txHash: null });
    expect(result.action).toBe("reject");
  });

  it("never replays a broadcast whose outcome was left ambiguous by a network error - a retried request against the same row sees status 'failed' and is rejected, not silently re-sent", () => {
    // executor.ts marks an execution `failed` on both a confirmed KeeperHub
    // rejection AND an unconfirmed network/timeout error (see
    // routes/executions.ts's broadcast catch block) - decideBroadcast has
    // no "unknown" status to special-case, by design: whatever caused the
    // ambiguity, a second automatic attempt through this same row must
    // never happen. A genuinely new attempt requires a fresh execution row
    // (a new idempotencyKey/UUID), a deliberate new decision, not a retry.
    const ambiguousOutcome = decideBroadcast({ status: "failed", txHash: null });
    expect(ambiguousOutcome.action).toBe("reject");

    // Retrying the identical request again changes nothing about the
    // decision - it's still a rejection, not a second broadcast attempt.
    const retried = decideBroadcast({ status: "failed", txHash: null });
    expect(retried.action).toBe("reject");
  });
});
