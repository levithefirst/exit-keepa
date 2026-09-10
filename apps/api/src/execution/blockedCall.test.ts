import { describe, expect, it } from "vitest";
import { AAVE_V3_BASE, canonicalRoleKey, type ExitAction } from "@exit-keepa/shared";
import { BLOCKED_CALL_DEMO_RECIPIENT, buildBlockedCallDemo } from "./blockedCall";
import type { SafeForExecution } from "./buildTransaction";

const SAFE: SafeForExecution = {
  safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
  chainId: AAVE_V3_BASE.chainId,
  rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
  rolesKey: canonicalRoleKey(),
};

const ACTION: ExitAction = {
  protocol: "aave-v3-base",
  action: "withdraw",
  asset: AAVE_V3_BASE.usdc,
  amount: "max",
};

describe("buildBlockedCallDemo", () => {
  it("fails the recipient bound and nothing else", () => {
    const result = buildBlockedCallDemo(ACTION, SAFE);

    expect(result.blocked).toBe(true);
    expect(result.policyPassed).toBe(false);
    expect(result.failedChecks).toEqual(["recipientBound"]);
    expect(result.refusalReasons).toEqual(["Policy check failed: recipientBound"]);
  });

  it("keeps every other policy check passing, so the refusal is unambiguous", () => {
    const { policy } = buildBlockedCallDemo(ACTION, SAFE);

    // The transaction is legitimate in every other respect - right chain,
    // right contract, right function, right asset. Only the destination is
    // wrong, which is exactly the claim under test.
    expect(policy.chainAllowed).toBe(true);
    expect(policy.targetAllowed).toBe(true);
    expect(policy.actionAllowed).toBe(true);
    expect(policy.selectorBound).toBe(true);
    expect(policy.assetBound).toBe(true);
    expect(policy.rolesConfigured).toBe(true);
    expect(policy.recipientBound).toBe(false);
  });

  it("encodes the diverted recipient into the calldata it refuses", () => {
    const result = buildBlockedCallDemo(ACTION, SAFE);

    expect(result.attempted.recipient).toBe(BLOCKED_CALL_DEMO_RECIPIENT);
    expect(result.attempted.data.toLowerCase()).toContain(BLOCKED_CALL_DEMO_RECIPIENT.slice(2).toLowerCase());
    expect(result.attempted.data.toLowerCase()).not.toContain(SAFE.safeAddress.slice(2).toLowerCase());
    // Same selector and same target as the real thing - the only
    // difference is where the money would go.
    expect(result.attempted.data.slice(0, 10)).toBe(result.permitted.data.slice(0, 10));
    expect(result.attempted.to).toBe(result.permitted.to);
  });

  it("shows the permitted transaction returning funds to the Safe", () => {
    const result = buildBlockedCallDemo(ACTION, SAFE);

    expect(result.permitted.recipient).toBe(SAFE.safeAddress);
    expect(result.permitted.data.toLowerCase()).toContain(SAFE.safeAddress.slice(2).toLowerCase());
  });

  it("reports that KeeperHub was never contacted and nothing was broadcast", () => {
    const result = buildBlockedCallDemo(ACTION, SAFE);

    expect(result.keeperhubContacted).toBe(false);
    expect(result.broadcast).toBe(false);
  });

  it("refuses to run at all for a Safe with no Roles Modifier", () => {
    expect(() => buildBlockedCallDemo(ACTION, { ...SAFE, rolesModifierAddress: null })).toThrow();
  });
});
