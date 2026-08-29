import { afterEach, describe, expect, it, vi } from "vitest";
import { KeeperHubClient } from "./client";
import type { KeeperHubChain } from "./types";

/**
 * These fixtures are trimmed from the REAL response captured on 2026-08-29
 * by calling the live KeeperHub API (GET /chains, Bearer kh_... auth) from
 * a Railway-hosted deployment of this service - see
 * docs/keeperhub-integration.md for the full record. They are not
 * invented shapes.
 */
const LIVE_BASE_CHAIN: KeeperHubChain = {
  id: "9wr4m6zv2dwflb1trbzsx",
  chainId: 8453,
  name: "Base",
  symbol: "BASE",
  chainType: "evm",
  explorerUrl: "https://basescan.org",
  explorerAddressPath: "/address/{address}",
  explorerApiUrl: "https://api.etherscan.io/v2/api",
  explorerApiType: "etherscan",
  isTestnet: false,
  isEnabled: true,
  usePrivateMempoolRpc: false,
};

const LIVE_ETH_MAINNET_CHAIN: KeeperHubChain = {
  id: "8wwunraqp7z0901rirvbo",
  chainId: 1,
  name: "Ethereum Mainnet",
  symbol: "ETH",
  chainType: "evm",
  explorerUrl: "https://etherscan.io",
  explorerAddressPath: "/address/{address}",
  explorerApiUrl: "https://api.etherscan.io/v2/api",
  explorerApiType: "etherscan",
  isTestnet: false,
  isEnabled: true,
  usePrivateMempoolRpc: true,
};

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("KeeperHubClient", () => {
  const client = new KeeperHubClient("https://app.keeperhub.com/api", "kh_test_key");

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("listChains() calls the verified endpoint with Bearer auth and parses the response", async () => {
    const fetchMock = mockFetchOnce(200, [LIVE_BASE_CHAIN, LIVE_ETH_MAINNET_CHAIN]);

    const chains = await client.listChains();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.keeperhub.com/api/chains",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer kh_test_key" }),
      }),
    );
    expect(chains).toHaveLength(2);
    expect(chains[0]).toEqual(LIVE_BASE_CHAIN);
  });

  it("isChainSupported() returns true for Base (8453) when it is enabled", async () => {
    mockFetchOnce(200, [LIVE_BASE_CHAIN]);
    await expect(client.isChainSupported(8453)).resolves.toBe(true);
  });

  it("isChainSupported() returns false for a chain not present in the response", async () => {
    mockFetchOnce(200, [LIVE_ETH_MAINNET_CHAIN]);
    await expect(client.isChainSupported(8453)).resolves.toBe(false);
  });

  it("isChainSupported() returns false when the chain is present but disabled", async () => {
    mockFetchOnce(200, [{ ...LIVE_BASE_CHAIN, isEnabled: false }]);
    await expect(client.isChainSupported(8453)).resolves.toBe(false);
  });

  it("typed request methods throw with the status code on a non-2xx response", async () => {
    mockFetchOnce(401, { error: "invalid_api_key" });
    await expect(client.listChains()).rejects.toThrow(/401/);
  });

  it("rawGet() never throws on a non-2xx response and returns status/headers/body verbatim", async () => {
    mockFetchOnce(500, { error: "internal" }, { "x-request-id": "req-123" });

    const result = await client.rawGet("/chains");

    expect(result.status).toBe(500);
    expect(result.headers["x-request-id"]).toBe("req-123");
    expect(result.body).toEqual({ error: "internal" });
  });

  it("rawGet() never leaks the Authorization header into its returned headers", async () => {
    mockFetchOnce(200, [LIVE_BASE_CHAIN]);
    const result = await client.rawGet("/chains");
    expect(Object.keys(result.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
  });

  it("simulateSafeTransaction() throws rather than fabricating an unverified endpoint", () => {
    expect(() => client.simulateSafeTransaction()).toThrow(/not implemented/i);
  });
});
