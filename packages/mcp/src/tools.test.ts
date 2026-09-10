import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The KeeperHub client is mocked at its own module path - the same module
 * apps/api/src/execution/executor.ts imports - so these tests exercise the
 * real executor, the real buildExitTransaction, and the real policy check,
 * and stop only at the network boundary. That is what makes
 * "simulate_exit never sends simulate: false" a meaningful assertion: the
 * request under inspection is the one the production code actually builds.
 */
vi.mock("../../../apps/api/src/keeperhub/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../apps/api/src/keeperhub/client")>();
  return {
    ...actual,
    keeperHubClient: {
      callContractFunction: vi.fn(),
      getDirectExecutionStatus: vi.fn(),
    },
  };
});

vi.mock("../../../apps/api/src/agent/aaveRateOracle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../apps/api/src/agent/aaveRateOracle")>();
  return { ...actual, readAaveUsdcRate: vi.fn() };
});

const { keeperHubClient } = await import("../../../apps/api/src/keeperhub/client");
const { readAaveUsdcRate } = await import("../../../apps/api/src/agent/aaveRateOracle");

const {
  buildExitCalldata,
  evaluateExitCondition,
  getExecutionStatus,
  getLiveProof,
  simulateExit,
} = await import("./tools");
const { BroadcastNotPermittedError, BROADCAST_ENV_FLAG, refuseBroadcast } = await import("./broadcast");
const { EXIT_KEEPA_LIVE_PROOF } = await import("@exit-keepa/shared");

const SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const ROLES = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

beforeEach(() => {
  vi.mocked(keeperHubClient.callContractFunction).mockReset();
  vi.mocked(keeperHubClient.getDirectExecutionStatus).mockReset();
  vi.mocked(readAaveUsdcRate).mockReset();
  delete process.env[BROADCAST_ENV_FLAG];
});

/** Every `simulate` value this test file's mocked client was ever handed. */
function simulateFlagsSent(): unknown[] {
  return vi
    .mocked(keeperHubClient.callContractFunction)
    .mock.calls.map(([request]) => (request as { simulate?: unknown }).simulate);
}

describe("simulate_exit", () => {
  it("only ever sends simulate: true, never simulate: false", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: true,
      status: "simulated",
      wouldRevert: false,
    } as never);

    const result = await simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES });

    expect(result.simulated).toBe(true);
    expect(result.broadcast).toBe(false);
    expect(result.wouldRevert).toBe(false);
    expect(keeperHubClient.callContractFunction).toHaveBeenCalledTimes(1);
    expect(simulateFlagsSent()).toEqual([true]);
    expect(simulateFlagsSent()).not.toContain(false);
    expect(result.keeperhubRequest?.simulate).toBe(true);
  });

  it("never attaches an Idempotency-Key, which only a real broadcast carries", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: true,
      status: "simulated",
      wouldRevert: false,
    } as never);

    await simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES });

    const [, options] = vi.mocked(keeperHubClient.callContractFunction).mock.calls[0];
    expect(options).toBeUndefined();
  });

  it("targets the Roles Modifier with execTransactionWithRole, not the Pool directly", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: true,
      status: "simulated",
      wouldRevert: false,
    } as never);

    const result = await simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES });

    expect(result.keeperhubRequest?.contractAddress).toBe(ROLES);
    expect(result.keeperhubRequest?.functionName).toBe("execTransactionWithRole");
    expect(result.transaction.to).toBe(AAVE_POOL);
  });

  it("reports a simulated revert as an answer, still without broadcasting", async () => {
    vi.mocked(keeperHubClient.callContractFunction).mockResolvedValue({
      success: false,
      status: "reverted",
      wouldRevert: true,
      revertReason: "ConditionViolation(2)",
    } as never);

    const result = await simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES });

    expect(result.wouldRevert).toBe(true);
    expect(result.revertReason).toBe("ConditionViolation(2)");
    expect(simulateFlagsSent()).toEqual([true]);
  });

  it("refuses a broadcast request with a typed error naming the env flag", async () => {
    await expect(simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES, broadcast: true })).rejects.toThrow(
      BroadcastNotPermittedError,
    );
    expect(keeperHubClient.callContractFunction).not.toHaveBeenCalled();

    await expect(
      simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES, broadcast: true }),
    ).rejects.toMatchObject({
      code: "broadcast_not_permitted",
      envFlag: BROADCAST_ENV_FLAG,
      requiredValue: "1",
    });
  });

  it("still refuses to broadcast even with the env flag set - there is no such path here", async () => {
    process.env[BROADCAST_ENV_FLAG] = "1";

    await expect(simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES, broadcast: true })).rejects.toThrow(
      /no broadcast implementation/,
    );
    expect(keeperHubClient.callContractFunction).not.toHaveBeenCalled();
  });

  it("does not contact KeeperHub at all when the policy check refuses", async () => {
    // A Safe registered on the wrong chain fails chainAllowed. buildExitTransaction
    // refuses to build it, so this throws before any network call - the same
    // fail-closed behaviour the API has.
    await expect(
      simulateExit({ safeAddress: SAFE, rolesModifierAddress: ROLES, chainId: 1 as never }),
    ).rejects.toThrow();
    expect(keeperHubClient.callContractFunction).not.toHaveBeenCalled();
  });
});

describe("broadcast gating", () => {
  it.each([undefined, "", "0", "true", "yes", "1 ", "01"])(
    "refuses with a flag-not-set reason when EXIT_KEEPA_ALLOW_BROADCAST is %j",
    (value) => {
      const environment: NodeJS.ProcessEnv = {};
      if (value !== undefined) environment[BROADCAST_ENV_FLAG] = value;

      expect(() => refuseBroadcast("simulate_exit", environment)).toThrow(BroadcastNotPermittedError);
      try {
        refuseBroadcast("simulate_exit", environment);
      } catch (err) {
        expect((err as Error).message).toContain(BROADCAST_ENV_FLAG);
        expect((err as Error).message).toContain("is not set to");
      }
    },
  );

  it('refuses for a different, explicit reason when the flag is exactly "1"', () => {
    expect(() => refuseBroadcast("simulate_exit", { [BROADCAST_ENV_FLAG]: "1" })).toThrow(
      /no broadcast implementation at all/,
    );
  });

  it("names the flag in every refusal, whatever the reason", () => {
    for (const environment of [{}, { [BROADCAST_ENV_FLAG]: "1" }]) {
      try {
        refuseBroadcast("simulate_exit", environment);
        throw new Error("expected a refusal");
      } catch (err) {
        expect(err).toBeInstanceOf(BroadcastNotPermittedError);
        expect((err as Error).message).toContain(BROADCAST_ENV_FLAG);
      }
    }
  });
});

describe("build_exit_calldata", () => {
  it("builds the one permitted call and passes the policy check", async () => {
    const result = await buildExitCalldata({ safeAddress: SAFE, rolesModifierAddress: ROLES });

    expect(result.policyPassed).toBe(true);
    expect(result.refusalReasons).toEqual([]);
    expect(result.transaction.to).toBe(AAVE_POOL);
    expect(result.transaction.data.slice(0, 10)).toBe("0x69328dec");
    expect(result.transaction.decodedArgs.asset).toBe(USDC);
    expect(result.transaction.decodedArgs.to).toBe(SAFE);
    expect(keeperHubClient.callContractFunction).not.toHaveBeenCalled();
  });

  it("routes the withdrawal to the Safe itself even though the caller never names a recipient", async () => {
    const other = "0x1111111111111111111111111111111111111111";
    const result = await buildExitCalldata({ safeAddress: other, rolesModifierAddress: ROLES });

    expect(result.transaction.decodedArgs.to).toBe(other);
    // The recipient is always the Safe passed in - there is no input that
    // can point the withdrawal anywhere else.
    expect(result.transaction.data.toLowerCase()).toContain(other.slice(2).toLowerCase());
  });

  it("refuses a Safe on any chain but Base", async () => {
    await expect(buildExitCalldata({ safeAddress: SAFE, rolesModifierAddress: ROLES, chainId: 1 })).rejects.toThrow();
  });
});

describe("evaluate_exit_condition", () => {
  const condition = { market: "aave-v3-base", metric: "supply_apr", comparator: "lt", thresholdBps: 300 } as const;

  it("uses the caller's rate without touching the network", async () => {
    const result = await evaluateExitCondition({ condition, currentRateBps: 120 });

    expect(result.conditionMet).toBe(true);
    expect(result.rateSource).toBe("caller-supplied");
    expect(result.observedRatePercent).toBe("1.20%");
    expect(readAaveUsdcRate).not.toHaveBeenCalled();
  });

  it("answers false when the condition does not hold", async () => {
    const result = await evaluateExitCondition({ condition, currentRateBps: 450 });
    expect(result.conditionMet).toBe(false);
  });

  it("reads the live Base rate through the agent's own oracle when no rate is given", async () => {
    vi.mocked(readAaveUsdcRate).mockResolvedValue({
      chainId: 8453,
      blockTag: "latest",
      asset: USDC,
      metric: "supply_apr",
      rateBps: 275,
      rateRay: "27500000000000000000000000",
      observedAt: "2026-09-10T00:00:00.000Z",
    });

    const result = await evaluateExitCondition({ condition });

    expect(readAaveUsdcRate).toHaveBeenCalledWith("supply_apr");
    expect(result.rateSource).toBe("base-rpc");
    expect(result.conditionMet).toBe(true);
    expect(result.observedRateBps).toBe(275);
  });
});

describe("get_execution_status", () => {
  it("defaults to the canonical live-proof execution id", async () => {
    vi.mocked(keeperHubClient.getDirectExecutionStatus).mockResolvedValue({
      status: {
        executionId: EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId,
        status: "completed",
        sponsored: true,
        receipts: [
          {
            hash: EXIT_KEEPA_LIVE_PROOF.txHash,
            chainId: 8453,
            verified: true,
            receiptStatus: "success",
            blockNumber: EXIT_KEEPA_LIVE_PROOF.blockNumber,
          },
        ],
      },
      pollIntervalHintSeconds: 0,
    });

    const result = await getExecutionStatus({});

    expect(keeperHubClient.getDirectExecutionStatus).toHaveBeenCalledWith(
      EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId,
    );
    expect(result.isCanonicalLiveProof).toBe(true);
    expect(result.terminal).toBe(true);
    expect(result.outcome).toEqual({ status: "succeeded", txHash: EXIT_KEEPA_LIVE_PROOF.txHash, errorMessage: null });
  });

  it("will not call an execution succeeded on an unverified receipt", async () => {
    vi.mocked(keeperHubClient.getDirectExecutionStatus).mockResolvedValue({
      status: {
        executionId: "some_other_execution",
        status: "completed",
        receipts: [{ hash: `0x${"a".repeat(64)}`, chainId: 8453, verified: false, receiptStatus: "not_found" }],
      },
      pollIntervalHintSeconds: 5,
    });

    const result = await getExecutionStatus({ executionId: "some_other_execution" });

    expect(result.isCanonicalLiveProof).toBe(false);
    expect(result.terminal).toBe(false);
    expect(result.outcome.status).toBe("executing");
  });
});

describe("get_live_proof", () => {
  it("returns the exact canonical hash and ids, byte for byte", async () => {
    const { proof } = await getLiveProof();

    expect(proof.txHash).toBe("0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b");
    expect(proof.keeperhubExecutionId).toBe("u9zr4vzbfurjvzgwz687g");
    expect(proof.safeAddress).toBe("0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9");
    expect(proof.rolesModifierAddress).toBe("0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE");
    expect(proof.aaveV3PoolAddress).toBe("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5");
    expect(proof.chainId).toBe(8453);
    expect(proof.basescanUrl).toBe(
      "https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b",
    );
  });

  it("makes no network call and returns the same object every time", async () => {
    const first = await getLiveProof();
    const second = await getLiveProof();

    expect(first.proof).toEqual(second.proof);
    expect(keeperHubClient.callContractFunction).not.toHaveBeenCalled();
    expect(keeperHubClient.getDirectExecutionStatus).not.toHaveBeenCalled();
  });

  it("labels the stage whose evidence this project does not hold", async () => {
    const { stages } = await getLiveProof();
    const condition = stages.find((stage) => stage.id === "condition");

    expect(condition?.evidence).toBe("not-published");
    expect(stages.find((stage) => stage.id === "receipt")?.evidence).toBe("onchain");
  });
});
