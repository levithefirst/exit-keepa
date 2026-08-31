import { afterEach, describe, expect, it, vi } from "vitest";
import { KeeperHubClient } from "./client";
import type { ContractCallRequest, KeeperHubChain } from "./types";

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

  describe("callContractFunction()", () => {
    /**
     * Exact request/response captured on 2026-08-30 from a real call to
     * POST /execute/contract-call: decimals() on Base's WETH9 predeploy,
     * with Authorization: Bearer <real key> from a Railway-hosted
     * deployment. See docs/keeperhub-integration.md for the full
     * round-by-round record (this was the 4th of 5 probes; each earlier
     * probe hit a 400 revealing the next missing required field).
     */
    const LIVE_REQUEST = {
      contractAddress: "0x4200000000000000000000000000000000000006",
      chainId: 8453,
      functionName: "decimals",
    };
    const LIVE_RESPONSE = { result: "18" };

    it("posts the verified minimal request shape and returns the flat result", async () => {
      const fetchMock = mockFetchOnce(200, LIVE_RESPONSE);

      const result = await client.callContractFunction(LIVE_REQUEST);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://app.keeperhub.com/api/execute/contract-call",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(LIVE_REQUEST),
          headers: expect.objectContaining({ Authorization: "Bearer kh_test_key" }),
        }),
      );
      expect(result).toEqual(LIVE_RESPONSE);
    });

    it("adding simulate: true to the same request has no effect on the response shape (live-observed)", async () => {
      mockFetchOnce(200, LIVE_RESPONSE);
      const result = await client.callContractFunction({ ...LIVE_REQUEST, simulate: true });
      expect(result).toEqual(LIVE_RESPONSE);
    });

    it.each([
      { body: {}, field: "contractAddress" },
      { body: { contractAddress: "0x4200000000000000000000000000000000000006" }, field: "chainId" },
      {
        body: { contractAddress: "0x4200000000000000000000000000000000000006", chainId: 8453 },
        field: "functionName",
      },
    ])("surfaces the real per-field validation error for an incomplete request (missing $field)", async ({ body, field }) => {
      mockFetchOnce(400, {
        error: "Missing required field",
        field,
        details: `${field} is required`,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(client.callContractFunction(body as any)).rejects.toThrow(/400/);
    });

    describe("with a single argument (functionArgs)", () => {
      /**
       * Exact request/response captured on 2026-08-30: balanceOf(address)
       * on the same WETH9 contract, queried against the zero address.
       * The real value returned (WETH held at 0x0 on Base) - not a stub.
       * See docs/keeperhub-integration.md for the full round-by-round
       * record, including the two rejected encodings before this one.
       */
      const LIVE_ARGS_REQUEST = {
        contractAddress: "0x4200000000000000000000000000000000000006",
        chainId: 8453,
        functionName: "balanceOf",
        functionArgs: JSON.stringify(["0x0000000000000000000000000000000000000000"]),
        simulate: true,
      };
      const LIVE_ARGS_RESPONSE = { result: "3328703018194595557" };

      it("accepts functionArgs as a JSON-stringified array and returns the real result", async () => {
        const fetchMock = mockFetchOnce(200, LIVE_ARGS_RESPONSE);

        const result = await client.callContractFunction(LIVE_ARGS_REQUEST);

        expect(fetchMock).toHaveBeenCalledWith(
          "https://app.keeperhub.com/api/execute/contract-call",
          expect.objectContaining({ body: JSON.stringify(LIVE_ARGS_REQUEST) }),
        );
        expect(result).toEqual(LIVE_ARGS_RESPONSE);
      });

      it("documents that a native array under functionArgs is REJECTED - must be JSON.stringify()'d", () => {
        // TypeScript itself enforces this: functionArgs is typed as
        // `string`, so passing a native array is a compile error. This
        // test exists to make that constraint visible/searchable, not to
        // exercise runtime behavior.
        // @ts-expect-error functionArgs must be a JSON string, not an array - live-verified 2026-08-30
        const invalid: ContractCallRequest = { ...LIVE_ARGS_REQUEST, functionArgs: ["0x0"] };
        expect(invalid).toBeDefined();
      });

      it("surfaces KeeperHub's real execution-error shape for a mismatched argument count (distinct from the pre-flight validation error)", async () => {
        // Live-captured: passing 2 args to balanceOf (which takes 1)
        // produces an ethers.js "no matching fragment" error via
        // KeeperHub's RPC layer, at 400, NOT the
        // {error, field, details} pre-flight validation shape used for
        // missing top-level fields.
        mockFetchOnce(400, {
          error:
            'Contract call failed: RPC failed on both endpoints. Primary: no matching fragment (operation="fragment", info={ "args": [ "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000" ], "key": "balanceOf" }, code=UNSUPPORTED_OPERATION). Fallback: no matching fragment (operation="fragment", info={ "args": [ "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000" ], "key": "balanceOf" }, code=UNSUPPORTED_OPERATION)',
        });

        await expect(
          client.callContractFunction({
            ...LIVE_ARGS_REQUEST,
            functionArgs: JSON.stringify([
              "0x0000000000000000000000000000000000000000",
              "0x0000000000000000000000000000000000000000",
            ]),
          }),
        ).rejects.toThrow(/400/);
      });
    });

    describe("on Safe's own canonical singleton contract", () => {
      const SAFE_SINGLETON_V141 = "0x41675C099F32341bf84BFc5382aF534df5C7461a";

      it("getThreshold() succeeds - a real Safe-specific view function is recognized", async () => {
        const request = {
          contractAddress: SAFE_SINGLETON_V141,
          chainId: 8453,
          functionName: "getThreshold",
          simulate: true,
        };
        mockFetchOnce(200, { result: "1" });

        const result = await client.callContractFunction(request);

        expect(result).toEqual({ result: "1" });
      });

      it("isValidSignature(bytes32,bytes) FAILS with a distinct 'not found in ABI' error, even on the same contract getThreshold() succeeded on", async () => {
        // Live-captured 2026-08-30: this is the key finding for the
        // Zodiac question - KeeperHub's function resolution is bounded
        // by an internal per-contract-type ABI, not the contract's real
        // full ABI. Distinct error shape from both
        // ContractCallValidationError (has a `details` field) and
        // ContractCallExecutionError (wraps an ethers fragment-mismatch
        // message) - this one is `{error, field: "functionName"}` with
        // no `details`.
        const request = {
          contractAddress: SAFE_SINGLETON_V141,
          chainId: 8453,
          functionName: "isValidSignature",
          functionArgs: JSON.stringify([`0x${"00".repeat(32)}`, "0x1234"]),
          simulate: true,
        };
        mockFetchOnce(400, {
          error: "Function 'isValidSignature' not found in ABI",
          field: "functionName",
        });

        await expect(client.callContractFunction(request)).rejects.toThrow(/400/);
      });
    });

    describe("HTTP 400 that represents a simulated revert (not a request error)", () => {
      /**
       * Live-captured 2026-08-30 (docs/zodiac-verification-evidence.md):
       * execTransactionWithRole simulated against an address with no role
       * membership returns HTTP 400 with this exact shape - KeeperHub's
       * status code for "the simulated call would revert", not a
       * validation failure. Regression test for the bug where this was
       * being converted into a thrown error (surfaced as a 502 at the
       * route level) instead of a normal simulation result.
       */
      const SIMULATED_REVERT_BODY = {
        success: false,
        status: "simulated",
        from: "0xc68f0e22dc6ed7e883873b36f23ddbbc1b3968ac",
        to: "0x856dD89c7925977119b5C7330186B5238aD355a0",
        value: "0",
        failureKind: "revert",
        wouldRevert: true,
        revertReason: "NotAuthorized(0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac)",
        error: "NotAuthorized(0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac)",
      };

      it("resolves with the parsed body instead of throwing", async () => {
        mockFetchOnce(400, SIMULATED_REVERT_BODY);

        const result = await client.callContractFunction({
          contractAddress: "0x856dD89c7925977119b5C7330186B5238aD355a0",
          chainId: 8453,
          functionName: "execTransactionWithRole",
          simulate: true,
        });

        expect(result).toEqual(SIMULATED_REVERT_BODY);
      });

      it("still throws for a genuine 400 that has no wouldRevert field", async () => {
        mockFetchOnce(400, { error: "Missing required field", field: "contractAddress", details: "x" });
        await expect(
          client.callContractFunction({ contractAddress: "", chainId: 8453, functionName: "x" }),
        ).rejects.toThrow(/400/);
      });
    });
  });
});
