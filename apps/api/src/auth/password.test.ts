import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its own hash+salt", () => {
    const { hash, salt } = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", salt, hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const { hash, salt } = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("wrong-password", salt, hash)).toBe(false);
  });

  it("generates a different salt (and thus a different hash) each call for the same password", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("never crashes on a hash of unexpected length - fails closed instead", () => {
    expect(verifyPassword("anything", "somesalt", "00")).toBe(false);
  });
});
