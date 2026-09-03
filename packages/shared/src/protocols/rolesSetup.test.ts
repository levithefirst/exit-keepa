import { describe, expect, it } from "vitest";
import { buildRolesSafeAppUrl, buildZodiacModulesSafeAppUrl, buildCreateSafeUrl } from "./rolesSetup";

describe("buildRolesSafeAppUrl", () => {
  it("builds a Safe App deep link scoped to this exact Safe on Base", () => {
    const url = buildRolesSafeAppUrl(8453, "0x1111111111111111111111111111111111111111");
    expect(url).toContain("app.safe.global/apps/open");
    expect(url).toContain("safe=base:0x1111111111111111111111111111111111111111");
    expect(url).toContain(encodeURIComponent("https://roles.gnosisguild.org"));
  });

  it("falls back to the raw chain id for an unnamed chain", () => {
    const url = buildRolesSafeAppUrl(1, "0x1111111111111111111111111111111111111111");
    expect(url).toContain("safe=1:0x1111111111111111111111111111111111111111");
  });
});

describe("buildCreateSafeUrl", () => {
  it("points at Safe{Wallet}'s own new-Safe creation flow, pre-selected to Base", () => {
    const url = buildCreateSafeUrl(8453);
    expect(url).toBe("https://app.safe.global/new-safe/create?chain=base");
  });

  it("falls back to the raw chain id for an unnamed chain", () => {
    const url = buildCreateSafeUrl(1);
    expect(url).toBe("https://app.safe.global/new-safe/create?chain=1");
  });
});

describe("buildZodiacModulesSafeAppUrl", () => {
  it("opens the Zodiac app (which installs modules), not the Roles app (which only edits an existing one)", () => {
    const url = buildZodiacModulesSafeAppUrl(8453, "0x1111111111111111111111111111111111111111");
    expect(url).toContain("app.safe.global/apps/open");
    expect(url).toContain("safe=base:0x1111111111111111111111111111111111111111");
    expect(url).toContain(encodeURIComponent("https://zodiac.gnosisguild.org"));
    expect(url).not.toContain(encodeURIComponent("https://roles.gnosisguild.org"));
  });
});
