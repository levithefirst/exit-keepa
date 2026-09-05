import { describe, expect, it } from "vitest";
import { buildRolesPermissionSpec } from "./rolesPermission";
import { canonicalRoleKey } from "@exit-keepa/shared";

describe("buildRolesPermissionSpec", () => {
  it("scopes to the Aave Pool, the withdraw selector, and fixes asset+recipient to this Safe", () => {
    const spec = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc", isSandbox: false });
    expect(spec.target).toBe("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5");
    expect(spec.selector).toBe("0x69328dec");
    expect(spec.executionOptions).toContain("None");
    expect(spec.roleKey).toBe(canonicalRoleKey());
    const assetCondition = spec.conditions.find((c) => c.param === "asset");
    const toCondition = spec.conditions.find((c) => c.param === "to");
    const amountCondition = spec.conditions.find((c) => c.param === "amount");
    expect(assetCondition?.rule).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(toCondition?.rule).toContain("0x1111111111111111111111111111111111111111");
    expect(amountCondition?.rule).toBe("unrestricted");
  });

  it("never uses allowTarget-style unrestricted access - always scopes to exactly one selector", () => {
    const spec = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc", isSandbox: false });
    expect(spec.selector).toBeTruthy();
    expect(spec.conditions.length).toBe(3);
  });

  it("does not expose a Safe or Zodiac setup URL", () => {
    const spec = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: null, roleKey: null, isSandbox: false });
    expect(spec.safeAppUrl).toBe("");
    expect(spec.zodiacAppUrl).toBe("");
  });

  it("flags when the Safe has no compatible permission module yet", () => {
    const spec = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: null, roleKey: null, isSandbox: false });
    expect(spec.note).toContain("no compatible permission module");
    expect(spec.needsModifier).toBe(true);
    expect(spec.setupState).toBe("modifier_missing");
  });
});

describe("buildRolesPermissionSpec - the three real-Safe setup states", () => {
  const base = { chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", isSandbox: false };

  it("a Safe with no Roles Modifier is modifier_missing and has no external setup path", () => {
    const spec = buildRolesPermissionSpec({ ...base, rolesModifierAddress: null, roleKey: null });
    expect(spec.setupState).toBe("modifier_missing");
    expect(spec.safeAppUrl).toBe("");
    expect(spec.zodiacAppUrl).toBe("");
  });

  it("a Safe whose Modifier exists but whose transaction still can't be built is permission_missing", () => {
    const spec = buildRolesPermissionSpec({ ...base, rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc", executable: false });
    expect(spec.setupState).toBe("permission_missing");
  });

  it("a fully-configured Safe is ready only when the exact executable transaction is available", () => {
    const spec = buildRolesPermissionSpec({ ...base, rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc", executable: true });
    expect(spec.setupState).toBe("ready");
  });

  it("does not infer readiness from a modifier and role key alone", () => {
    const spec = buildRolesPermissionSpec({ ...base, rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc" });
    expect(spec.setupState).toBe("permission_missing");
  });
});

describe("buildRolesPermissionSpec - sandbox and modifier flags", () => {
  it("clears needsModifier once the Safe already has a Roles Modifier", () => {
    const spec = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc", isSandbox: false });
    expect(spec.needsModifier).toBe(false);
  });

  it("carries isSandbox through unchanged", () => {
    const real = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: null, roleKey: null, isSandbox: false });
    expect(real.isSandbox).toBe(false);
    const sandbox = buildRolesPermissionSpec({ chainId: 8453, safeAddress: "0x1111111111111111111111111111111111111111", rolesModifierAddress: "0x2222222222222222222222222222222222222222", roleKey: "0xabc", isSandbox: true });
    expect(sandbox.isSandbox).toBe(true);
  });
});
