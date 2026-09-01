// Standalone, dependency-declared script that computes the exact Safe
// transaction calldata for tightening the exit_keepa role's Aave Pool
// grant from allowTarget (whole-target) to scopeFunction (withdraw only,
// asset locked to USDC, recipient locked to the Safe itself).
//
// Run with: node --experimental-vm-modules computeCalldata.js
// (or: npm install viem@2.56.1 in a scratch dir, then node computeCalldata.js)
//
// Every address/selector/role-key below is the real, already-verified
// value used throughout the Exit Keepa project this session - see
// docs/SUBMISSION.md and docs/ROLES_TIGHTENING.md for provenance.

const { encodeFunctionData, encodeAbiParameters, decodeFunctionData, getAddress } = require("viem");

const ROLE_KEY = "0x657869745f6b6565706100000000000000000000000000000000000000000000"; // "exit_keepa", bytes32
const ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const WITHDRAW_SELECTOR = "0x69328dec"; // withdraw(address,uint256,address), independently re-verified this session

const SCOPE_TARGET_ABI = [{
  type: "function", name: "scopeTarget",
  inputs: [
    { name: "roleKey", type: "bytes32" },
    { name: "targetAddress", type: "address" },
  ],
  outputs: [], stateMutability: "nonpayable",
}];

const SCOPE_FUNCTION_ABI = [{
  type: "function", name: "scopeFunction",
  inputs: [
    { name: "roleKey", type: "bytes32" },
    { name: "targetAddress", type: "address" },
    { name: "functionSig", type: "bytes4" },
    { name: "conditions", type: "tuple[]", components: [
      { name: "parent", type: "uint8" },
      { name: "paramType", type: "uint8" },
      { name: "operator", type: "uint8" },
      { name: "compValue", type: "bytes" },
    ]},
    { name: "options", type: "uint8" },
  ],
  outputs: [], stateMutability: "nonpayable",
}];

function addrCompValue(addr) {
  return encodeAbiParameters([{ type: "address" }], [addr]);
}

// AbiType: None=0 Static=1 Dynamic=2 Tuple=3 Array=4 Calldata=5 AbiEncoded=6
// Operator: Pass=0 ... Matches=5 ... EqualTo=16 ...
// Structure verified against the real zodiac-modifier-roles test suite
// (packages/evm/test/operators/05Matches.spec.ts, "evaluates operator
// Matches for Calldata") - every positional parameter needs an explicit
// entry; unrestricted ones use operator Pass rather than being omitted.
const conditions = [
  { parent: 0, paramType: 5, operator: 5, compValue: "0x" },                  // root: Calldata / Matches
  { parent: 0, paramType: 1, operator: 16, compValue: addrCompValue(USDC) },  // asset == USDC
  { parent: 0, paramType: 1, operator: 0, compValue: "0x" },                  // amount: unrestricted
  { parent: 0, paramType: 1, operator: 16, compValue: addrCompValue(SAFE) },  // to == the Safe itself
];

const scopeTargetData = encodeFunctionData({
  abi: SCOPE_TARGET_ABI,
  functionName: "scopeTarget",
  args: [ROLE_KEY, AAVE_POOL],
});

const scopeFunctionData = encodeFunctionData({
  abi: SCOPE_FUNCTION_ABI,
  functionName: "scopeFunction",
  args: [ROLE_KEY, AAVE_POOL, WITHDRAW_SELECTOR, conditions, 0],
});

console.log("=== Transaction 1: scopeTarget ===");
console.log("to:  ", ROLES_MODIFIER);
console.log("value: 0");
console.log("data:", scopeTargetData);
console.log("operation: 0 (Call)");
console.log();
console.log("=== Transaction 2: scopeFunction ===");
console.log("to:  ", ROLES_MODIFIER);
console.log("value: 0");
console.log("data:", scopeFunctionData);
console.log("operation: 0 (Call)");
console.log();

// Round-trip self-check: decode what was just built and confirm it says
// exactly what was intended, byte for byte.
const decoded = decodeFunctionData({ abi: SCOPE_FUNCTION_ABI, data: scopeFunctionData });
const [roleKey, target, selector, decodedConditions, options] = decoded.args;
console.log("=== Self-check (decoded back from the calldata above) ===");
console.log("roleKey matches:", roleKey === ROLE_KEY);
console.log("target matches:", getAddress(target) === getAddress(AAVE_POOL));
console.log("selector matches:", selector === WITHDRAW_SELECTOR);
console.log("options (0=None):", options);
console.log("asset condition decodes to:", getAddress("0x" + decodedConditions[1].compValue.slice(-40)), "expected", USDC);
console.log("amount condition operator (0=Pass):", decodedConditions[2].operator);
console.log("recipient condition decodes to:", getAddress("0x" + decodedConditions[3].compValue.slice(-40)), "expected", SAFE);
