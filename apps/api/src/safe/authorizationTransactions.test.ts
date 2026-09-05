import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, keccak256, stringToBytes, toFunctionSelector } from "viem";
import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR, canonicalRoleKey } from "@exit-keepa/shared";
import {
  SAFE_V1_4_1_SINGLETON,
  ROLES_V2_1_1_MASTER_COPY,
  buildRoleConfigurationCalls,
  buildSafeTransaction,
  computeSafeTransactionHash,
} from "./authorizationTransactions";

const SAFE = "0x1111111111111111111111111111111111111111" as const;
const KEEPER = "0x2222222222222222222222222222222222222222" as const;

const rolesAbi = [
  { type: "function", name: "assignRoles", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }, { name: "roleKeys", type: "bytes32[]" }, { name: "memberOf", type: "bool[]" }], outputs: [] },
  { type: "function", name: "scopeTarget", stateMutability: "nonpayable", inputs: [{ name: "roleKey", type: "bytes32" }, { name: "targetAddress", type: "address" }], outputs: [] },
  { type: "function", name: "scopeFunction", stateMutability: "nonpayable", inputs: [{ name: "roleKey", type: "bytes32" }, { name: "targetAddress", type: "address" }, { name: "selector", type: "bytes4" }, { name: "conditions", type: "tuple[]", components: [{ name: "parent", type: "uint8" }, { name: "paramType", type: "uint8" }, { name: "operator", type: "uint8" }, { name: "compValue", type: "bytes" }] }, { name: "options", type: "uint8" }], outputs: [] },
] as const;

describe("direct Safe/Roles authorization", () => {
  it("pins the verified implementations", () => {
    expect(SAFE_V1_4_1_SINGLETON).toBe("0x41675C099F32341bf84BFc5382aF534df5C7461a");
    expect(ROLES_V2_1_1_MASTER_COPY).toBe("0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5");
  });

  it("builds only the canonical role and the three narrow configuration calls", () => {
    const calls = buildRoleConfigurationCalls(SAFE, KEEPER);
    expect(calls).toHaveLength(3);

    const assign = decodeFunctionData({ abi: rolesAbi, data: calls[0].data });
    expect(assign.functionName).toBe("assignRoles");
    expect(assign.args?.[0]).toBe(KEEPER);
    expect(assign.args?.[1]).toEqual([canonicalRoleKey()]);
    expect(assign.args?.[2]).toEqual([true]);

    const target = decodeFunctionData({ abi: rolesAbi, data: calls[1].data });
    expect(target.functionName).toBe("scopeTarget");
    expect(target.args?.[0]).toBe(canonicalRoleKey());
    expect(target.args?.[1]).toBe(AAVE_V3_BASE.pool);

    const fn = decodeFunctionData({ abi: rolesAbi, data: calls[2].data });
    expect(fn.functionName).toBe("scopeFunction");
    expect(fn.args?.[0]).toBe(canonicalRoleKey());
    expect(fn.args?.[1]).toBe(AAVE_V3_BASE.pool);
    expect(fn.args?.[2]).toBe(AAVE_V3_WITHDRAW_SELECTOR);
    expect(fn.args?.[4]).toBe(0);

    const conditions = fn.args?.[3] as readonly { parent: number; paramType: number; operator: number; compValue: string }[];
    expect(conditions).toHaveLength(4);
    expect(conditions.map((c) => [c.parent, c.paramType, c.operator])).toEqual([[0, 5, 5], [0, 1, 16], [0, 1, 0], [0, 1, 16]]);
    expect(conditions[1].compValue).toBe(encodeAbiParameters([{ type: "address" }], [AAVE_V3_BASE.usdc]));
    expect(conditions[3].compValue).toBe(encodeAbiParameters([{ type: "address" }], [SAFE]));
  });

  it("uses the Safe EIP-712 fields exactly, including zero gas/refund fields", () => {
    const tx = buildSafeTransaction({ to: KEEPER, data: "0x1234", nonce: 7n });
    expect(tx).toMatchObject({ value: 0n, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: "0x0000000000000000000000000000000000000000", nonce: 7n });
    expect(computeSafeTransactionHash(SAFE, tx, 8453)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
