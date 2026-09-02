import { describe, expect, it } from "vitest";
import { buildRolesPermissionSpec } from "./rolesPermission";

describe("buildRolesPermissionSpec", () => {
  it("scopes to the Aave Pool, the withdraw selector, and fixes asset+recipient to this Safe", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
    });

    expect(spec.target).toBe("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5");
    expect(spec.selector).toBe("0x69328dec");
    expect(spec.executionOptions).toContain("None");

    const assetCondition = spec.conditions.find((c) => c.param === "asset");
    const toCondition = spec.conditions.find((c) => c.param === "to");
    const amountCondition = spec.conditions.find((c) => c.param === "amount");

    expect(assetCondition?.rule).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(toCondition?.rule).toContain("0x1111111111111111111111111111111111111111");
    expect(amountCondition?.rule).toBe("unrestricted");
  });

  it("never uses allowTarget-style unrestricted access - always scopes to exactly one selector", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
    });
    expect(spec.selector).toBeTruthy();
    expect(spec.conditions.length).toBe(3);
  });

  it("builds a Safe App deep link scoped to this exact Safe on Base", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: null,
      roleKey: null,
    });
    expect(spec.safeAppUrl).toContain("app.safe.global/apps/open");
    expect(spec.safeAppUrl).toContain("base:0x1111111111111111111111111111111111111111");
    expect(spec.safeAppUrl).toContain(encodeURIComponent("https://roles.gnosisguild.org"));
  });

  it("flags when the Safe has no Roles Modifier enabled yet", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: null,
      roleKey: null,
    });
    expect(spec.note).toContain("no Roles Modifier enabled");
    expect(spec.needsModifier).toBe(true);
  });

  it("clears needsModifier once the Safe already has a Roles Modifier", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
    });
    expect(spec.needsModifier).toBe(false);
  });
});
