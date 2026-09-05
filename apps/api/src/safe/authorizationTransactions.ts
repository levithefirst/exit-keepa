import {
  AAVE_V3_BASE,
  canonicalRoleKey,
  type Hex,
} from "@exit-keepa/shared";
import {
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  stringToHex,
  toHex,
} from "viem";
import { env } from "../env";
import { HttpError } from "../middleware/errorHandler";

export const SAFE_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ROLES_V2_1_1_MASTER_COPY = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5" as const;

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const ROLES_ABI = [
  {
    type: "function",
    name: "assignRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "module", type: "address" },
      { name: "roleKeys", type: "bytes32[]" },
      { name: "memberOf", type: "bool[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "scopeTarget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleKey", type: "bytes32" },
      { name: "targetAddress", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "scopeFunction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleKey", type: "bytes32" },
      { name: "targetAddress", type: "address" },
      { name: "selector", type: "bytes4" },
      {
        name: "conditions",
        type: "tuple[]",
        components: [
          { name: "parent", type: "uint8" },
          { name: "paramType", type: "uint8" },
          { name: "operator", type: "uint8" },
          { name: "compValue", type: "bytes" },
        ],
      },
      { name: "options", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

const SAFE_ABI = [
  {
    type: "function",
    name: "getTransactionHash",
    stateMutability: "view",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "_nonce", type: "uint256" },
    ],
    outputs: [{ name: "txHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const EXEC_TRANSACTION_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

type SafeTx = {
  to: `0x${string}`;
  value: bigint;
  data: Hex;
  operation: 0;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: `0x${string}`;
  refundReceiver: `0x${string}`;
  nonce: bigint;
};

async function rpcCall(to: string, data: string, from?: string): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data, ...(from ? { from } : {}) }, "latest"],
    }),
  });
  if (!response.ok) throw new HttpError(502, "Could not verify your Safe. Try again.");
  const body = (await response.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new HttpError(409, body.error.message ?? "Safe verification failed");
  if (!body.result) throw new HttpError(409, "Safe verification returned no result");
  return body.result;
}

function decodeAbiWord(hex: string): bigint {
  return BigInt(hex);
}

function decodeAddressArray(hex: string): string[] {
  const body = hex.slice(2);
  if (body.length < 128) throw new HttpError(409, "Could not verify Safe owners");
  const offset = Number(decodeAbiWord(`0x${body.slice(0, 64)}`));
  const start = offset * 2;
  const length = Number(decodeAbiWord(`0x${body.slice(start, start + 64)}`));
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    const wordStart = start + 64 + i * 64;
    if (body.length < wordStart + 64) throw new HttpError(409, "Could not verify Safe owners");
    result.push(`0x${body.slice(wordStart + 24, wordStart + 64)}`);
  }
  return result;
}

function decodeString(hex: string): string {
  const body = hex.slice(2);
  const offset = Number(decodeAbiWord(`0x${body.slice(0, 64)}`));
  const start = offset * 2;
  const length = Number(decodeAbiWord(`0x${body.slice(start, start + 64)}`));
  const bytes = body.slice(start + 64, start + 64 + length * 2);
  return Buffer.from(bytes, "hex").toString("utf8");
}

function decodeUint(hex: string): bigint {
  return BigInt(hex);
}

function functionData(functionName: string, args: readonly unknown[]): Hex {
  return encodeFunctionData({
    abi: [...ROLES_ABI, ...SAFE_ABI, ...EXEC_TRANSACTION_ABI],
    functionName: functionName as never,
    args: args as never,
  });
}

export async function inspectSafeForAuthorization(safeAddress: `0x${string}`, connectedOwner: `0x${string}`) {
  const [ownersRaw, thresholdRaw, nonceRaw, versionRaw, codeRaw] = await Promise.all([
    rpcCall(safeAddress, functionData("getOwners", [])),
    rpcCall(safeAddress, functionData("getThreshold", [])),
    rpcCall(safeAddress, functionData("nonce", [])),
    rpcCall(safeAddress, functionData("VERSION", [])),
    fetch(env.BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [safeAddress, "latest"] }),
    }).then(async (r) => ((await r.json()) as { result?: string }).result ?? "0x"),
  ]);

  const owners = decodeAddressArray(ownersRaw);
  const threshold = Number(decodeUint(thresholdRaw));
  const version = decodeString(versionRaw);
  const isOwner = owners.some((owner) => owner.toLowerCase() === connectedOwner.toLowerCase());
  const isEip1167SafeProxy = codeRaw !== "0x";

  if (!isOwner) {
    return { owners, threshold, nonce: decodeUint(nonceRaw), version, isOwner: false, isSafe: isEip1167SafeProxy };
  }
  return { owners, threshold, nonce: decodeUint(nonceRaw), version, isOwner: true, isSafe: isEip1167SafeProxy };
}

function safeTxTypedData(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) {
  return {
    domain: { chainId, verifyingContract: safeAddress },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx" as const,
    message: {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas,
      baseGas: tx.baseGas,
      gasPrice: tx.gasPrice,
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: tx.nonce,
    },
  };
}

function addressCompValue(address: `0x${string}`): Hex {
  return encodeAbiParameters([{ type: "address" }], [address]);
}

function buildRoleConfigurationCalls(safeAddress: `0x${string}`, keeperAddress: `0x${string}`) {
  const roleKey = canonicalRoleKey();
  const assignRoles = encodeFunctionData({
    abi: ROLES_ABI,
    functionName: "assignRoles",
    args: [keeperAddress, [roleKey], [true]],
  });
  const scopeTarget = encodeFunctionData({
    abi: ROLES_ABI,
    functionName: "scopeTarget",
    args: [roleKey, AAVE_V3_BASE.pool],
  });
  const conditions = [
    { parent: 0, paramType: 5, operator: 5, compValue: "0x" as Hex },
    { parent: 0, paramType: 1, operator: 16, compValue: addressCompValue(AAVE_V3_BASE.usdc) },
    { parent: 0, paramType: 1, operator: 0, compValue: "0x" as Hex },
    { parent: 0, paramType: 1, operator: 16, compValue: addressCompValue(safeAddress) },
  ] as const;
  const scopeFunction = encodeFunctionData({
    abi: ROLES_ABI,
    functionName: "scopeFunction",
    args: [roleKey, AAVE_V3_BASE.pool, AAVE_V3_WITHDRAW_SELECTOR, conditions, 0],
  });

  return [
    { id: "assign-role", label: "Authorize the Exit Keepa keeper", data: assignRoles },
    { id: "scope-target", label: "Restrict the role to Aave on Base", data: scopeTarget },
    { id: "scope-function", label: "Restrict the role to the USDC withdrawal", data: scopeFunction },
  ] as const;
}

export async function prepareAuthorizationTransaction(params: {
  safeAddress: `0x${string}`;
  connectedOwner: `0x${string}`;
  modifierAddress: `0x${string}`;
  chainId: number;
}) {
  if (params.chainId !== AAVE_V3_BASE.chainId) throw new HttpError(409, "Your Safe is not on Base.");

  const inspection = await inspectSafeForAuthorization(params.safeAddress, params.connectedOwner);
  if (!inspection.isOwner) throw new HttpError(403, "You are not an owner of this Safe.");
  if (inspection.threshold !== 1) {
    throw new HttpError(409, "This Safe needs more than one owner approval. Multisig authorization is not enabled here yet.");
  }
  if (!["1.3.0", "1.4.1", "1.5.0"].includes(inspection.version)) {
    throw new HttpError(409, "This Safe version is not supported by Exit Keepa yet.");
  }

  const code = await rpcCall(params.modifierAddress, "0x");
  if (code === "0x") throw new HttpError(409, "Your Safe's permission module could not be verified.");

  const moduleAvatar = await rpcCall(params.modifierAddress, "0x5aef7de6");
  const moduleTarget = await rpcCall(params.modifierAddress, "0xd4b83992");
  const avatar = `0x${moduleAvatar.slice(-40)}`.toLowerCase();
  const target = `0x${moduleTarget.slice(-40)}`.toLowerCase();
  if (avatar !== params.safeAddress.toLowerCase() || target !== params.safeAddress.toLowerCase()) {
    throw new HttpError(409, "Your Safe's permission module is not configured for this Safe.");
  }

  const calls = buildRoleConfigurationCalls(params.safeAddress, "0x0000000000000000000000000000000000000000");
  return {
    safeAddress: params.safeAddress,
    chainId: params.chainId,
    threshold: inspection.threshold,
    owners: inspection.owners,
    nonce: inspection.nonce.toString(),
    safeVersion: inspection.version,
    roleKey: canonicalRoleKey(),
    modifierAddress: params.modifierAddress,
    calls,
  };
}

export function computeSafeTransactionHash(safeAddress: `0x${string}`, tx: SafeTx, chainId: number): Hex {
  return hashTypedData(safeTxTypedData(safeAddress, tx, chainId));
}

export function buildSafeTransaction(args: {
  to: `0x${string}`;
  data: Hex;
  nonce: bigint;
}): SafeTx {
  return {
    to: args.to,
    value: 0n,
    data: args.data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: SAFE_ZERO_ADDRESS,
    refundReceiver: SAFE_ZERO_ADDRESS,
    nonce: args.nonce,
  };
}

export function encodeExecTransaction(tx: SafeTx, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: EXEC_TRANSACTION_ABI,
    functionName: "execTransaction",
    args: [
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      signatures,
    ],
  });
}

export function buildTypedDataForSafeTransaction(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) {
  return safeTxTypedData(safeAddress, tx, chainId);
}

export function validateSignatureShape(signature: string): asserts signature is Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new HttpError(400, "The wallet returned an invalid Safe signature.");
  }
}

export function signatureForSafeOwner(signature: Hex): Hex {
  // Safe's standard ECDSA owner signature is the 65-byte r || s || v form.
  // Do not normalize or reinterpret v here: the Safe contract validates the
  // exact signature bytes against its owner set and threshold.
  return signature;
}
