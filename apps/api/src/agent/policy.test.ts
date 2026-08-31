import { describe, expect, it } from "vitest";
import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR } from "@exit-keepa/shared";
import { checkPolicy } from "./policy";
import type { BuiltTransaction, SafeForExecution } from "../execution/buildTransaction";

const SAFE: SafeForExecution = {
  safeAddress: "0xFfd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
  chainId: 8453,
  rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
  rolesKey: "0x657869745f6b65657061000000000000000000000000000000000000000000",
};

function validTx(): BuiltTransaction {
  return {
    to: AAVE_V3_BASE.pool,
    value: "0",
    data: `${AAVE_V3_WITHDRAW_SELECTOR}${"0".repeat(128)}`,
    operation: 0,
    rolesModifierAddress: SAFE.rolesModifierAddress!,
    roleKey: SAFE.rolesKey!,
    decodedFunction: "withdraw(address asset, uint256 amount, address to)",
    decodedArgs: { asset: AAVE_V3_BASE.usdc, amount: "1000000", to: SAFE.safeAddress },
  };
}

describe("checkPolicy - the Guardian's real-code refusal gate", () => {
  it("passes every check for a correctly-built, correctly-scoped transaction", () => {
    const result = checkPolicy(validTx(), SAFE, null);
    expect(result.policyPassed).toBe(true);
    expect(result.refusalReasons).toEqual([]);
    expect(Object.values(result.policy).every(Boolean)).toBe(true);
  });

  it("refuses with 'missing permission' when the transaction could not be built at all (no Roles configured)", () => {
    const result = checkPolicy(null, SAFE, "Safe has no Roles Modifier / role key configured yet");
    expect(result.policyPassed).toBe(false);
    expect(result.refusalReasons.some((r) => r.includes("Missing permission"))).toBe(true);
  });

  it("refuses on the wrong chain even if a transaction happened to build", () => {
    const wrongChainSafe = { ...SAFE, chainId: 1 };
    const result = checkPolicy(validTx(), wrongChainSafe, null);
    expect(result.policyPassed).toBe(false);
    expect(result.policy.chainAllowed).toBe(false);
    expect(result.refusalReasons.some((r) => r.includes("chainAllowed"))).toBe(true);
  });

  it("refuses when the Safe has no Roles Modifier / key recorded", () => {
    const noRoles = { ...SAFE, rolesModifierAddress: null, rolesKey: null };
    const result = checkPolicy(validTx(), noRoles, null);
    expect(result.policyPassed).toBe(false);
    expect(result.policy.rolesConfigured).toBe(false);
  });

  it("refuses a transaction whose target contract isn't the Aave Pool", () => {
    const tx = { ...validTx(), to: "0x0000000000000000000000000000000000dEaD" };
    const result = checkPolicy(tx, SAFE, null);
    expect(result.policyPassed).toBe(false);
    expect(result.policy.targetAllowed).toBe(false);
  });

  it("refuses a transaction whose calldata selector doesn't match the exact withdraw function", () => {
    const tx = { ...validTx(), data: `0xdeadbeef${"0".repeat(128)}` };
    const result = checkPolicy(tx, SAFE, null);
    expect(result.policyPassed).toBe(false);
    expect(result.policy.selectorBound).toBe(false);
  });

  it("refuses a transaction whose decoded asset isn't USDC", () => {
    const tx = { ...validTx(), decodedArgs: { ...validTx().decodedArgs, asset: "0x1111111111111111111111111111111111111" + "1" } };
    const result = checkPolicy(tx, SAFE, null);
    expect(result.policyPassed).toBe(false);
    expect(result.policy.assetBound).toBe(false);
  });

  it("refuses a transaction whose recipient isn't the Safe itself - the core anti-drain check", () => {
    const tx = { ...validTx(), decodedArgs: { ...validTx().decodedArgs, to: "0x000000000000000000000000000000000000ff" } };
    const result = checkPolicy(tx, SAFE, null);
    expect(result.policyPassed).toBe(false);
    expect(result.policy.recipientBound).toBe(false);
    expect(result.refusalReasons.some((r) => r.includes("recipientBound"))).toBe(true);
  });

  it("accumulates every failing reason, not just the first one found", () => {
    const brokenTx = {
      ...validTx(),
      to: "0x0000000000000000000000000000000000dEaD",
      decodedArgs: { ...validTx().decodedArgs, to: "0x000000000000000000000000000000000000ff" },
    };
    const wrongChainSafe = { ...SAFE, chainId: 1 };
    const result = checkPolicy(brokenTx, wrongChainSafe, null);
    expect(result.refusalReasons.length).toBeGreaterThanOrEqual(3);
  });
});
