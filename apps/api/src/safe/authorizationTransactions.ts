import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR, canonicalRoleKey } from "@exit-keepa/shared";
import { encodeAbiParameters, encodeFunctionData, hashTypedData, type Hex } from "viem";
import { env } from "../env";
import { HttpError } from "../middleware/errorHandler";

export const SAFE_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const SAFE_V1_4_1_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a" as const;
/** Zodiac Roles v2.1.1 mastercopy. v2.1.0 is known vulnerable. */
export const ROLES_V2_1_1_MASTER_COPY = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5" as const;

const SAFE_TX_TYPES = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
] } as const;

const ROLES_ABI = [
  { type: "function", name: "assignRoles", stateMutability: "nonpayable", inputs: [
    { name: "module", type: "address" }, { name: "roleKeys", type: "bytes32[]" }, { name: "memberOf", type: "bool[]" },
  ], outputs: [] },
  { type: "function", name: "scopeTarget", stateMutability: "nonpayable", inputs: [
    { name: "roleKey", type: "bytes32" }, { name: "targetAddress", type: "address" },
  ], outputs: [] },
  { type: "function", name: "scopeFunction", stateMutability: "nonpayable", inputs: [
    { name: "roleKey", type: "bytes32" }, { name: "targetAddress", type: "address" }, { name: "selector", type: "bytes4" },
    { name: "conditions", type: "tuple[]", components: [
      { name: "parent", type: "uint8" }, { name: "paramType", type: "uint8" }, { name: "operator", type: "uint8" }, { name: "compValue", type: "bytes" },
    ] }, { name: "options", type: "uint8" },
  ], outputs: [] },
] as const;

const SAFE_READ_ABI = [
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "masterCopy", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "getTransactionHash", stateMutability: "view", inputs: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "_nonce", type: "uint256" },
  ], outputs: [{ name: "", type: "bytes32" }] },
] as const;

const EXEC_TRANSACTION_ABI = [{ type: "function", name: "execTransaction", stateMutability: "payable", inputs: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "signatures", type: "bytes" },
], outputs: [{ name: "success", type: "bool" }] }] as const;

type SafeTx = { to: `0x${string}`; value: bigint; data: Hex; operation: 0; safeTxGas: bigint; baseGas: bigint; gasPrice: bigint; gasToken: `0x${string}`; refundReceiver: `0x${string}`; nonce: bigint };

async function rpcCall(to: string, data: string, from?: string): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data, ...(from ? { from } : {}) }, "latest"] }) });
  if (!response.ok) throw new HttpError(502, "Could not verify your Safe. Try again.");
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error) throw new HttpError(409, body.error.message ?? "Safe verification failed");
  if (!body.result) throw new HttpError(409, "Safe verification returned no result");
  return body.result;
}
async function rpcCode(address: string): Promise<string> {
  const response = await fetch(env.BASE_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }) });
  if (!response.ok) throw new HttpError(502, "Could not verify your Safe. Try again.");
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error) throw new HttpError(409, body.error.message ?? "Safe verification failed");
  return body.result ?? "0x";
}
function decodeAddressArray(hex: string): string[] {
  const body = hex.slice(2); const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2; const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`));
  const result: string[] = []; for (let i = 0; i < length; i++) { const start = offset + 64 + i * 64; result.push(`0x${body.slice(start + 24, start + 64)}`); } return result;
}
function decodeString(hex: string): string {
  const body = hex.slice(2); const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2; const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`));
  return Buffer.from(body.slice(offset + 64, offset + 64 + length * 2), "hex").toString("utf8");
}
function safeRead(name: "getOwners" | "getThreshold" | "nonce" | "VERSION" | "masterCopy"): Hex { return encodeFunctionData({ abi: SAFE_READ_ABI, functionName: name }); }
function parseRolesImplementation(code: string): string | null {
  const body = code.toLowerCase().replace(/^0x/, ""); const prefix = "363d3d373d3d3d363d73"; const suffix = "5af43d82803e903d91602b57fd5bf3";
  if (!body.startsWith(prefix) || !body.endsWith(suffix) || body.length !== 90) return null; return `0x${body.slice(prefix.length, prefix.length + 40)}`;
}

export async function inspectSafeForAuthorization(safeAddress: `0x${string}`, connectedOwner: `0x${string}`) {
  const [ownersRaw, thresholdRaw, nonceRaw, versionRaw, masterCopyRaw, code] = await Promise.all([
    rpcCall(safeAddress, safeRead("getOwners")), rpcCall(safeAddress, safeRead("getThreshold")), rpcCall(safeAddress, safeRead("nonce")),
    rpcCall(safeAddress, safeRead("VERSION")), rpcCall(safeAddress, safeRead("masterCopy")), rpcCode(safeAddress),
  ]);
  const owners = decodeAddressArray(ownersRaw); const masterCopy = `0x${masterCopyRaw.slice(-40)}`;
  return {
    owners, threshold: Number(BigInt(thresholdRaw)), nonce: BigInt(nonceRaw), version: decodeString(versionRaw),
    masterCopy, isOwner: owners.some((owner) => owner.toLowerCase() === connectedOwner.toLowerCase()),
    isSafe: code !== "0x" && masterCopy.toLowerCase() === SAFE_V1_4_1_SINGLETON.toLowerCase(),
  };
}

export async function verifyRolesModifier(modifierAddress: `0x${string}`, safeAddress: `0x${string}`) {
  const implementation = parseRolesImplementation(await rpcCode(modifierAddress));
  if (!implementation || implementation.toLowerCase() !== ROLES_V2_1_1_MASTER_COPY.toLowerCase()) return false;
  const [avatarRaw, targetRaw, ownerRaw] = await Promise.all([rpcCall(modifierAddress, "0x5aef7de6"), rpcCall(modifierAddress, "0xd4b83992"), rpcCall(modifierAddress, "0x8da5cb5b")]);
  const safe = safeAddress.toLowerCase();
  return `0x${avatarRaw.slice(-40)}`.toLowerCase() === safe && `0x${targetRaw.slice(-40)}`.toLowerCase() === safe && `0x${ownerRaw.slice(-40)}`.toLowerCase() === safe;
}

function safeTxTypedData(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) {
  return { domain: { chainId, verifyingContract: safeAddress }, types: SAFE_TX_TYPES, primaryType: "SafeTx" as const, message: { to: tx.to, value: tx.value, data: tx.data, operation: tx.operation, safeTxGas: tx.safeTxGas, baseGas: tx.baseGas, gasPrice: tx.gasPrice, gasToken: tx.gasToken, refundReceiver: tx.refundReceiver, nonce: tx.nonce } };
}
function addressCompValue(address: `0x${string}`): Hex { return encodeAbiParameters([{ type: "address" }], [address]); }
export function buildRoleConfigurationCalls(safeAddress: `0x${string}`, keeperAddress: `0x${string}`) {
  const roleKey = canonicalRoleKey();
  const assignRoles = encodeFunctionData({ abi: ROLES_ABI, functionName: "assignRoles", args: [keeperAddress, [roleKey], [true]] });
  const scopeTarget = encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeTarget", args: [roleKey, AAVE_V3_BASE.pool] });
  const conditions = [
    { parent: 0, paramType: 5, operator: 5, compValue: "0x" as Hex },
    { parent: 0, paramType: 1, operator: 16, compValue: addressCompValue(AAVE_V3_BASE.usdc) },
    { parent: 0, paramType: 1, operator: 0, compValue: "0x" as Hex },
    { parent: 0, paramType: 1, operator: 16, compValue: addressCompValue(safeAddress) },
  ] as const;
  const scopeFunction = encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeFunction", args: [roleKey, AAVE_V3_BASE.pool, AAVE_V3_WITHDRAW_SELECTOR, conditions, 0] });
  return [
    { id: "assign-role", label: "Authorize the Exit Keepa keeper", data: assignRoles },
    { id: "scope-target", label: "Restrict the role to Aave on Base", data: scopeTarget },
    { id: "scope-function", label: "Restrict the role to the USDC withdrawal", data: scopeFunction },
  ] as const;
}
export function buildSafeTransaction(args: { to: `0x${string}`; data: Hex; nonce: bigint }): SafeTx {
  return { to: args.to, value: 0n, data: args.data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: SAFE_ZERO_ADDRESS, refundReceiver: SAFE_ZERO_ADDRESS, nonce: args.nonce };
}
export function computeSafeTransactionHash(safeAddress: `0x${string}`, tx: SafeTx, chainId: number): Hex { return hashTypedData(safeTxTypedData(safeAddress, tx, chainId)); }
export function buildTypedDataForSafeTransaction(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) { return safeTxTypedData(safeAddress, tx, chainId); }
export function encodeExecTransaction(tx: SafeTx, signatures: Hex): Hex { return encodeFunctionData({ abi: EXEC_TRANSACTION_ABI, functionName: "execTransaction", args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures] }); }
export async function verifySafeTransactionHash(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) {
  const localHash = computeSafeTransactionHash(safeAddress, tx, chainId);
  const raw = await rpcCall(safeAddress, encodeFunctionData({ abi: SAFE_READ_ABI, functionName: "getTransactionHash", args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce] }));
  const onchainHash = `0x${raw.slice(-64)}` as Hex;
  if (localHash.toLowerCase() !== onchainHash.toLowerCase()) throw new HttpError(409, "Could not verify the Safe transaction hash. Nothing was signed.");
  return { localHash, onchainHash };
}
