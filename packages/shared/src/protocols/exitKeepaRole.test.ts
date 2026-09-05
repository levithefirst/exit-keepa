import { describe, expect, it } from "vitest";
import { canonicalRoleKey, EXIT_KEEPA_ROLE_KEY, EXIT_KEEPA_ROLE_NAME } from "./exitKeepaRole";

describe("Exit Keepa canonical Roles key", () => {
  it("uses the fixed role name", () => {
    expect(EXIT_KEEPA_ROLE_NAME).toBe("exit_keepa");
  });

  it("returns one deterministic bytes32 value", () => {
    expect(canonicalRoleKey()).toBe("0x657869745f6b6565706100000000000000000000000000000000000000000000");
    expect(canonicalRoleKey()).toBe(EXIT_KEEPA_ROLE_KEY);
    expect(canonicalRoleKey()).toHaveLength(66);
  });
});
