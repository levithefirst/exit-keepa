import { describe, expect, it } from "vitest";
import { AAVE_V3_BASE } from "@exit-keepa/shared";
import { buildExitTransaction, type SafeForExecution } from "./buildTransaction";

const SAFE: SafeForExecution = {
  safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
  rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
  rolesKey: "0x657869745f6b6565706100000000000000000000000000000000000000000000",
};

describe("buildExitTransaction", () => {
  it("builds the Aave v3 Base withdraw call against the correct target with a fixed amount", () => {
    const tx = buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "1000000" }, SAFE);
    expect(tx.to).toBe(AAVE_V3_BASE.pool);
    expect(tx.value).toBe("0");
    expect(tx.operation).toBe(0);
    expect(tx.rolesModifierAddress).toBe(SAFE.rolesModifierAddress);
    expect(tx.roleKey).toBe(SAFE.rolesKey);
    expect(tx.decodedArgs).toEqual({ asset: AAVE_V3_BASE.usdc, amount: "1000000", to: SAFE.safeAddress });
    expect(tx.data.startsWith("0x69328dec")).toBe(true);
  });

  it("routes withdrawn funds back to the Safe itself, never anywhere else", () => {
    const tx = buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, SAFE);
    expect(tx.decodedArgs.to).toBe(SAFE.safeAddress);
  });

  it("throws (409-mapped) when the Safe has no Roles Modifier configured yet", () => {
    const noRoles: SafeForExecution = { ...SAFE, rolesModifierAddress: null };
    expect(() =>
      buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, noRoles),
    ).toThrow(/Roles Modifier/);
  });

  it("throws when the Safe has a Roles Modifier but no role key yet", () => {
    const noKey: SafeForExecution = { ...SAFE, rolesKey: null };
    expect(() =>
      buildExitTransaction({ protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" }, noKey),
    ).toThrow(/role key/);
  });
});
