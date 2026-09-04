import { afterEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector } from "viem";
import { AAVE_V3_BASE, type ExitAction } from "@exit-keepa/shared";
import { SELECTORS, decodeModulesPaginated, readAuthorizationStatus } from "./authorizationStatus";

const SAFE = "0x1111111111111111111111111111111111111111";
const MODIFIER = "0x2222222222222222222222222222222222222222";
const UNRELATED_MODULE = "0x3333333333333333333333333333333333333333";
const ROLE_KEY = `0x${"ab".repeat(32)}`;

const ACTION: ExitAction = {
  protocol: "aave-v3-base",
  action: "withdraw",
  asset: AAVE_V3_BASE.usdc,
  amount: "max",
};

const { callContractFunction } = vi.hoisted(() => ({ callContractFunction: vi.fn() }));
vi.mock("../keeperhub/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../keeperhub/client")>();
  return { ...actual, keeperHubClient: { callContractFunction } };
});

function word(hex: string): string {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

/** ABI-encodes `(address[] modules, address next)` the way Safe returns it. */
function encodeModules(modules: string[]): string {
  const head = word("0x40") + word("0x1");
  const body = word(BigInt(modules.length).toString(16)) + modules.map((m) => word(m)).join("");
  return `0x${head}${body}`;
}

/** Routes an eth_call to the right canned answer by `to` + selector. */
function stubChain(options: {
  modules?: string[];
  modifierAvatar?: string;
  modifierTarget?: string;
  failModulesRead?: boolean;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const call = body?.params?.[0] ?? {};
      const to = String(call.to ?? "").toLowerCase();
      const data = String(call.data ?? "");

      if (data.startsWith(SELECTORS.getModulesPaginated)) {
        if (options.failModulesRead) return new Response("boom", { status: 500 });
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeModules(options.modules ?? []) }),
          { status: 200 },
        );
      }
      if (to === MODIFIER.toLowerCase() && data.startsWith(SELECTORS.avatar)) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word(options.modifierAvatar ?? SAFE)}` }),
          { status: 200 },
        );
      }
      if (to === MODIFIER.toLowerCase() && data.startsWith(SELECTORS.target)) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word(options.modifierTarget ?? SAFE)}` }),
          { status: 200 },
        );
      }
      // Any other module: not a Zodiac modifier, the call reverts.
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } }), {
        status: 200,
      });
    }),
  );
}

const realSafe = {
  safeAddress: SAFE,
  chainId: 8453,
  rolesModifierAddress: null as string | null,
  rolesKey: null as string | null,
  isSandbox: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  callContractFunction.mockReset();
});

describe("authorization selectors", () => {
  it("are the real keccak selectors, recomputed rather than trusted", () => {
    expect(SELECTORS.getModulesPaginated).toBe(toFunctionSelector("getModulesPaginated(address,uint256)"));
    expect(SELECTORS.avatar).toBe(toFunctionSelector("avatar()"));
    expect(SELECTORS.target).toBe(toFunctionSelector("target()"));
  });
});

describe("decodeModulesPaginated", () => {
  it("decodes the Safe's enabled-module list", () => {
    expect(decodeModulesPaginated(encodeModules([MODIFIER, UNRELATED_MODULE]))).toEqual([
      MODIFIER.toLowerCase(),
      UNRELATED_MODULE.toLowerCase(),
    ]);
  });

  it("returns nothing for an empty list or a truncated response", () => {
    expect(decodeModulesPaginated(encodeModules([]))).toEqual([]);
    expect(decodeModulesPaginated("0x")).toEqual([]);
  });
});

describe("STATE 1 - the Safe has no Zodiac modifier enabled", () => {
  it("reports needs_module and never claims the Safe is protected", async () => {
    stubChain({ modules: [] });
    const status = await readAuthorizationStatus(realSafe, ACTION);

    expect(status.state).toBe("needs_module");
    expect(status.detectedModifierAddress).toBeNull();
    expect(status.summary).toMatch(/one-time setup/i);
    // Nothing was dry-run: there is no modifier to run anything through.
    expect(callContractFunction).not.toHaveBeenCalled();
  });

  it("ignores an enabled module that isn't a Zodiac modifier for this Safe", async () => {
    stubChain({ modules: [UNRELATED_MODULE] });
    const status = await readAuthorizationStatus(realSafe, ACTION);
    expect(status.state).toBe("needs_module");
    expect(status.enabledModules).toEqual([UNRELATED_MODULE.toLowerCase()]);
  });

  it("ignores a Zodiac modifier pointed at a DIFFERENT Safe", async () => {
    stubChain({ modules: [MODIFIER], modifierAvatar: UNRELATED_MODULE, modifierTarget: UNRELATED_MODULE });
    const status = await readAuthorizationStatus(realSafe, ACTION);
    expect(status.state).toBe("needs_module");
    expect(status.detectedModifierAddress).toBeNull();
  });
});

describe("STATE 2 - a modifier is enabled but the exit isn't permitted", () => {
  it("detects the modifier address from chain so the user never types one", async () => {
    stubChain({ modules: [MODIFIER] });
    const status = await readAuthorizationStatus(realSafe, ACTION);

    expect(status.state).toBe("needs_permission");
    expect(status.detectedModifierAddress).toBe(MODIFIER.toLowerCase());
  });

  it("reports needs_permission when the dry run says the exit would revert", async () => {
    stubChain({ modules: [MODIFIER] });
    callContractFunction.mockResolvedValue({ wouldRevert: true, revertReason: "ConditionViolation()" });

    const status = await readAuthorizationStatus({ ...realSafe, rolesKey: ROLE_KEY }, ACTION);
    expect(status.state).toBe("needs_permission");
    expect(status.permissionChecked).toBe(true);
  });
});

describe("STATE 3 - fully authorized", () => {
  it("reports protected only when the exact exit transaction dry-runs clean", async () => {
    stubChain({ modules: [MODIFIER] });
    callContractFunction.mockResolvedValue({ wouldRevert: false });

    const status = await readAuthorizationStatus({ ...realSafe, rolesKey: ROLE_KEY }, ACTION);
    expect(status.state).toBe("protected");
    expect(status.permissionChecked).toBe(true);
    expect(status.summary).toMatch(/authorized to execute this exit automatically/i);

    // Proof came from a dry run, never a broadcast.
    expect(callContractFunction).toHaveBeenCalledTimes(1);
    expect(callContractFunction.mock.calls[0][0].simulate).toBe(true);
  });
});

describe("fails closed - an unknown state is never 'protected'", () => {
  it("does not claim protected when the Safe's modules can't be read", async () => {
    stubChain({ failModulesRead: true });
    const status = await readAuthorizationStatus(realSafe, ACTION);

    expect(status.state).toBe("needs_module");
    expect(status.undetermined).toMatch(/HTTP 500/);
    expect(status.summary).toMatch(/couldn't check your Safe/i);
  });

  it("does not claim protected when the permission dry run itself fails", async () => {
    stubChain({ modules: [MODIFIER] });
    callContractFunction.mockRejectedValue(new Error("KeeperHub unavailable"));

    const status = await readAuthorizationStatus({ ...realSafe, rolesKey: ROLE_KEY }, ACTION);
    expect(status.state).toBe("needs_permission");
    expect(status.permissionChecked).toBe(false);
    expect(status.undetermined).toMatch(/KeeperHub unavailable/);
  });

  it("refuses a Safe registered on another chain", async () => {
    stubChain({ modules: [MODIFIER] });
    const status = await readAuthorizationStatus({ ...realSafe, chainId: 1 }, ACTION);
    expect(status.state).toBe("needs_module");
    expect(status.undetermined).toMatch(/Base only/i);
  });
});

describe("a sandbox Safe never enters the real authorization flow", () => {
  it("is protected by construction, with no chain read and no KeeperHub call", async () => {
    // Deliberately no fetch stub: any RPC attempt would throw here.
    const status = await readAuthorizationStatus(
      { ...realSafe, isSandbox: true, rolesModifierAddress: MODIFIER, rolesKey: ROLE_KEY },
      ACTION,
    );

    expect(status.state).toBe("protected");
    expect(status.summary).toMatch(/demo sandbox/i);
    expect(status.permissionChecked).toBe(false);
    expect(callContractFunction).not.toHaveBeenCalled();
  });
});
