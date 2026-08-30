import { describe, expect, it } from "vitest";
import {
  AAVE_V3_BASE,
  encodeAaveV3WithdrawCalldata,
  resolveWithdrawAmount,
  WITHDRAW_MAX_UINT256,
} from "./aaveV3Base";

const SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";

describe("encodeAaveV3WithdrawCalldata", () => {
  // Fixtures computed independently (Python keccak/hex, not via this module)
  // to catch regressions in the encoding logic itself.
  it("matches an independently-computed fixture for a fixed amount", () => {
    const calldata = encodeAaveV3WithdrawCalldata({
      asset: AAVE_V3_BASE.usdc,
      amount: 1_000_000n,
      to: SAFE,
    });
    expect(calldata).toBe(
      "0x69328dec000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda0291300000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000ffd5c5e17e09e012c99550bfb2ef88d370cd66a9",
    );
  });

  it("matches an independently-computed fixture for the max-uint256 sentinel", () => {
    const calldata = encodeAaveV3WithdrawCalldata({
      asset: AAVE_V3_BASE.usdc,
      amount: BigInt(WITHDRAW_MAX_UINT256),
      to: SAFE,
    });
    expect(calldata).toBe(
      "0x69328dec000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000ffd5c5e17e09e012c99550bfb2ef88d370cd66a9",
    );
  });

  it("produces exactly 4 + 3*32 = 100 bytes of calldata", () => {
    const calldata = encodeAaveV3WithdrawCalldata({ asset: AAVE_V3_BASE.usdc, amount: 1n, to: SAFE });
    expect(calldata.length).toBe(2 + 100 * 2);
  });

  it("refuses to encode a non-USDC asset", () => {
    expect(() =>
      encodeAaveV3WithdrawCalldata({
        asset: "0x4200000000000000000000000000000000000006",
        amount: 1n,
        to: SAFE,
      }),
    ).toThrow(/only supports withdrawing Base USDC|Unsupported asset/);
  });

  it("rejects an invalid recipient address", () => {
    expect(() =>
      encodeAaveV3WithdrawCalldata({ asset: AAVE_V3_BASE.usdc, amount: 1n, to: "not-an-address" }),
    ).toThrow(/Invalid address/);
  });

  it("rejects a uint256 out of range", () => {
    expect(() =>
      encodeAaveV3WithdrawCalldata({ asset: AAVE_V3_BASE.usdc, amount: 2n ** 256n, to: SAFE }),
    ).toThrow(/out of range/);
  });
});

describe("resolveWithdrawAmount", () => {
  it("resolves 'max' to the max-uint256 sentinel", () => {
    expect(resolveWithdrawAmount("max")).toBe(BigInt(WITHDRAW_MAX_UINT256));
  });

  it("resolves a numeric string to its bigint value", () => {
    expect(resolveWithdrawAmount("1000000")).toBe(1_000_000n);
  });

  it("rejects zero or negative amounts", () => {
    expect(() => resolveWithdrawAmount("0")).toThrow(/must be positive/);
    expect(() => resolveWithdrawAmount("-5")).toThrow();
  });
});
