import { afterEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector } from "viem";
import {
  SAFE_V1_4_1_L2_SINGLETON,
  SAFE_V1_4_1_SINGLETON,
  inspectSafeForAuthorization,
  verifyNegativeRoleProbes,
} from "./authorizationTransactions";

const SAFE = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const MODIFIER = "0x3333333333333333333333333333333333333333" as const;
const OTHER_SINGLETON = "0x9646fDAD06d3e24444381f44362a3B0eB343D337";

const SELECTOR = {
  getOwners: toFunctionSelector("getOwners()"),
  getThreshold: toFunctionSelector("getThreshold()"),
  nonce: toFunctionSelector("nonce()"),
  version: toFunctionSelector("VERSION()"),
  masterCopy: toFunctionSelector("masterCopy()"),
};

const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
const rpcResult = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });

function encodeStringReturn(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  return `0x${word("0x20")}${word(BigInt(value.length).toString(16))}${hex.padEnd(64, "0")}`;
}

function stubSafe(options: { masterCopy?: string; version?: string; code?: string } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    if (body.method === "eth_getCode") return rpcResult(options.code ?? "0x6000");
    const data = String(body.params?.[0]?.data ?? "");
    if (data.startsWith(SELECTOR.getOwners)) return rpcResult(`0x${word("0x20")}${word("0x1")}${word(OWNER)}`);
    if (data.startsWith(SELECTOR.getThreshold)) return rpcResult(`0x${word("0x1")}`);
    if (data.startsWith(SELECTOR.nonce)) return rpcResult(`0x${word("0x5")}`);
    if (data.startsWith(SELECTOR.version)) return rpcResult(encodeStringReturn(options.version ?? "1.4.1"));
    if (data.startsWith(SELECTOR.masterCopy)) return rpcResult(`0x${word(options.masterCopy ?? SAFE_V1_4_1_L2_SINGLETON)}`);
    return rpcResult("0x");
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("Safe preflight - which deployments count as a supported Safe", () => {
  it("accepts the SafeL2 1.4.1 singleton every Base Safe is deployed against", async () => {
    stubSafe({ masterCopy: SAFE_V1_4_1_L2_SINGLETON });
    const inspection = await inspectSafeForAuthorization(SAFE, OWNER);
    expect(inspection.isSafe).toBe(true);
    expect(inspection.version).toBe("1.4.1");
    expect(inspection.isOwner).toBe(true);
  });

  it("accepts the non-L2 1.4.1 singleton", async () => {
    stubSafe({ masterCopy: SAFE_V1_4_1_SINGLETON });
    expect((await inspectSafeForAuthorization(SAFE, OWNER)).isSafe).toBe(true);
  });

  it("rejects any other singleton", async () => {
    stubSafe({ masterCopy: OTHER_SINGLETON });
    expect((await inspectSafeForAuthorization(SAFE, OWNER)).isSafe).toBe(false);
  });

  it("rejects a supported singleton reporting a different version", async () => {
    stubSafe({ masterCopy: SAFE_V1_4_1_L2_SINGLETON, version: "1.3.0" });
    expect((await inspectSafeForAuthorization(SAFE, OWNER)).isSafe).toBe(false);
  });

  it("rejects an address with no code at all", async () => {
    stubSafe({ masterCopy: SAFE_V1_4_1_L2_SINGLETON, code: "0x" });
    expect((await inspectSafeForAuthorization(SAFE, OWNER)).isSafe).toBe(false);
  });

  it("reports an empty answer as a clear failure rather than crashing on BigInt(\"0x\")", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return rpcResult(body.method === "eth_getCode" ? "0x" : "0x");
    }));
    await expect(inspectSafeForAuthorization(SAFE, OWNER)).rejects.toThrow(/does not answer as a Safe/i);
  });
});

describe("negative role probes fail closed", () => {
  const probeReverts = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } }), { status: 200 });

  it("passes only when every probe is rejected on-chain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => probeReverts()));
    expect(await verifyNegativeRoleProbes(MODIFIER, SAFE, OWNER)).toBe(true);
  });

  it("fails when the Roles modifier accepts a probe it should have refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rpcResult(`0x${word("0x1")}`)));
    expect(await verifyNegativeRoleProbes(MODIFIER, SAFE, OWNER)).toBe(false);
  });

  it("never treats an unreachable RPC as a probe being rejected", async () => {
    // The whole point: a transport failure used to be caught and counted as
    // "correctly refused", which would report an over-broad permission as
    // safe. It has to propagate instead.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 500 })));
    await expect(verifyNegativeRoleProbes(MODIFIER, SAFE, OWNER)).rejects.toThrow(/Could not reach the Base network/i);
  });
});

describe("RPC transport", () => {
  it("retries a transient 503 and succeeds, without reporting a false failure", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response("try later", { status: 503 });
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.method === "eth_getCode") return rpcResult("0x6000");
      const data = String(body.params?.[0]?.data ?? "");
      if (data.startsWith(SELECTOR.getOwners)) return rpcResult(`0x${word("0x20")}${word("0x1")}${word(OWNER)}`);
      if (data.startsWith(SELECTOR.getThreshold)) return rpcResult(`0x${word("0x1")}`);
      if (data.startsWith(SELECTOR.nonce)) return rpcResult(`0x${word("0x5")}`);
      if (data.startsWith(SELECTOR.version)) return rpcResult(encodeStringReturn("1.4.1"));
      if (data.startsWith(SELECTOR.masterCopy)) return rpcResult(`0x${word(SAFE_V1_4_1_L2_SINGLETON)}`);
      return rpcResult("0x");
    }));
    expect((await inspectSafeForAuthorization(SAFE, OWNER)).isSafe).toBe(true);
    expect(calls).toBeGreaterThan(1);
  });

  it("names the RPC method and HTTP status when it gives up, so an outage is not mistaken for an unprotected Safe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    await expect(inspectSafeForAuthorization(SAFE, OWNER)).rejects.toThrow(/eth_call: HTTP 502/);
  });
});
