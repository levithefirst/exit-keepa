import { describe, expect, it } from "vitest";
import { buildRolesPermissionSpec } from "./rolesPermission";

describe("buildRolesPermissionSpec", () => {
  it("scopes to the Aave Pool, the withdraw selector, and fixes asset+recipient to this Safe", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
      isSandbox: false,
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
      isSandbox: false,
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
      isSandbox: false,
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
      isSandbox: false,
    });
    expect(spec.note).toContain("no Roles Modifier enabled");
    expect(spec.needsModifier).toBe(true);
  });
});

describe("buildRolesPermissionSpec - the three real-Safe setup states", () => {
  const base = {
    chainId: 8453,
    safeAddress: "0x1111111111111111111111111111111111111111",
    isSandbox: false,
  };

  it("L: a Safe with no Roles Modifier is 'modifier_missing' and is pointed at the Zodiac app, NOT the Roles editor", () => {
    const spec = buildRolesPermissionSpec({ ...base, rolesModifierAddress: null, roleKey: null });

    expect(spec.setupState).toBe("modifier_missing");
    // The dead end this replaces: the Roles app configures permissions on a
    // Modifier that must already exist, so it has nothing to show here.
    expect(spec.zodiacAppUrl).toContain(encodeURIComponent("https://zodiac.gnosisguild.org"));
    expect(spec.zodiacAppUrl).toContain("base:0x1111111111111111111111111111111111111111");
    expect(spec.note).toContain("Zodiac app");
  });

  it("a Safe whose Modifier exists but whose transaction still can't be built is 'permission_missing'", () => {
    const spec = buildRolesPermissionSpec({
      ...base,
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
      executable: false,
    });
    expect(spec.setupState).toBe("permission_missing");
  });

  it("M: a fully-configured Safe is 'ready' - autonomous execution allowed", () => {
    const spec = buildRolesPermissionSpec({
      ...base,
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
      executable: true,
    });
    expect(spec.setupState).toBe("ready");
  });

  it("without an explicit `executable`, having both a Modifier and a role key counts as ready", () => {
    const spec = buildRolesPermissionSpec({
      ...base,
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
    });
    expect(spec.setupState).toBe("ready");
  });
});

describe("buildRolesPermissionSpec - sandbox and modifier flags", () => {

  it("clears needsModifier once the Safe already has a Roles Modifier", () => {
    const spec = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
      isSandbox: false,
    });
    expect(spec.needsModifier).toBe(false);
  });

  it("carries isSandbox through unchanged - the frontend's only signal to hard-gate against a real-Safe setup link", () => {
    const real = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: null,
      roleKey: null,
      isSandbox: false,
    });
    expect(real.isSandbox).toBe(false);

    const sandbox = buildRolesPermissionSpec({
      chainId: 8453,
      safeAddress: "0x1111111111111111111111111111111111111111",
      rolesModifierAddress: "0x2222222222222222222222222222222222222222",
      roleKey: "0xabc",
      isSandbox: true,
    });
    expect(sandbox.isSandbox).toBe(true);
  });
});
