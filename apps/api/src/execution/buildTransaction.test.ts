import { describe, expect, it } from "vitest";
import { AAVE_V3_BASE, canonicalRoleKey } from "@exit-keepa/shared";
import { buildExitTransaction, type SafeForExecution } from "./buildTransaction";

const SAFE: SafeForExecution = {
  safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
  chainId: AAVE_V3_BASE.chainId,
  rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
  rolesKey: canonicalRoleKey(),
};

describe("buildExitTransaction", () => {
  it("builds the Aave v3 Base withdraw call against the correct target with a fixed amount", () => {
    const tx = buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "1000000" }, SAFE);
    expect(tx.to).toBe(AAVE_V3_BASE.pool);
    expect(tx.value).toBe("0");
    expect(tx.operation).toBe(0);
    expect(tx.rolesModifierAddress).toBe(SAFE.rolesModifierAddress);
    expect(tx.roleKey).toBe(canonicalRoleKey());
    expect(tx.decodedArgs).toEqual({ asset: AAVE_V3_BASE.usdc, amount: "1000000", to: SAFE.safeAddress });
    expect(tx.data.startsWith("0x69328dec")).toBe(true);
  });

  it("routes withdrawn funds back to the Safe itself, never anywhere else", () => {
    const tx = buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, SAFE);
    expect(tx.decodedArgs.to).toBe(SAFE.safeAddress);
  });

  it("throws when the Safe has no compatible permission module configured yet", () => {
    const noRoles: SafeForExecution = { ...SAFE, rolesModifierAddress: null };
    expect(() =>
      buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, noRoles),
    ).toThrow(/compatible permission module/);
  });

  it("uses the canonical role even when a legacy stored role key is absent", () => {
    const noKey: SafeForExecution = { ...SAFE, rolesKey: null };
    const tx = buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, noKey);
    expect(tx.roleKey).toBe(canonicalRoleKey());
  });

  it("fails closed for a Safe registered on any chain other than Base - never builds a Base-targeted tx for the wrong chain", () => {
    const wrongChain: SafeForExecution = { ...SAFE, chainId: 1 };
    expect(() =>
      buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, wrongChain),
    ).toThrow(/chainId 1.*Base \(chainId 8453\)/s);
  });
});
