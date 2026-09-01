import { describe, expect, it } from "vitest";
import { buildSignInMessage } from "./nonceMessage";

describe("buildSignInMessage", () => {
  it("is deterministic for the same address and nonce", () => {
    const a = buildSignInMessage("0xabc", "nonce1");
    const b = buildSignInMessage("0xabc", "nonce1");
    expect(a).toBe(b);
  });

  it("produces a different message for a different nonce - so a stale signature can never be replayed", () => {
    const a = buildSignInMessage("0xabc", "nonce1");
    const b = buildSignInMessage("0xabc", "nonce2");
    expect(a).not.toBe(b);
  });

  it("produces a different message for a different address", () => {
    const a = buildSignInMessage("0xabc", "nonce1");
    const b = buildSignInMessage("0xdef", "nonce1");
    expect(a).not.toBe(b);
  });

  it("embeds both the address and the nonce in the visible text", () => {
    const message = buildSignInMessage("0xabc", "nonce1");
    expect(message).toContain("0xabc");
    expect(message).toContain("nonce1");
  });
});
