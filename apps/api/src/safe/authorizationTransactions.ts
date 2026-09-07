import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR, canonicalRoleKey } from "@exit-keepa/shared";
import { concatHex, encodeAbiParameters, encodeFunctionData, hashTypedData, keccak256, stringToHex, type Hex } from "viem";
import { env } from "../env";
import { logger } from "../logger";
import { HttpError } from "../middleware/errorHandler";
export const SAFE_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const SAFE_V1_4_1_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a" as const;
/** Base Safes are deployed against the L2 singleton, not the mainnet one - both are Safe 1.4.1. */
export const SAFE_V1_4_1_L2_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as const;
const SUPPORTED_SAFE_SINGLETONS = [SAFE_V1_4_1_SINGLETON, SAFE_V1_4_1_L2_SINGLETON] as const;
export const ROLES_V2_1_1_MASTER_COPY = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5" as const;
export const ROLES_V2_1_0_MASTER_COPY = "0x9646fDAD06d3e24444381f44362a3B0eB343D337" as const;
export const ZODIAC_MODULE_PROXY_FACTORY = "0x000000000000aDdB49795b0f9bA5BC298cDda236" as const;
export const KEEPERHUB_EXECUTION_SENDER = "0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac" as const;
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001" as const;
const MODULE_PROXY_PREFIX = "602d8060093d393df3363d3d373d3d3d363d73";
const MODULE_PROXY_SUFFIX = "5af43d82803e903d91602b57fd5bf3";
const DEPLOY_SELECTOR = keccak256(stringToHex("deployModule(address,bytes,uint256)")).slice(0, 10).toLowerCase();
const ROLES_MAPPING_SLOT = 4n;
const SAFE_TX_TYPES = { SafeTx: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" }] } as const;
const ROLES_ABI = [{ type: "function", name: "setUp", stateMutability: "nonpayable", inputs: [{ name: "initParams", type: "bytes" }], outputs: [] }, { type: "function", name: "assignRoles", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }, { name: "roleKeys", type: "bytes32[]" }, { name: "memberOf", type: "bool[]" }], outputs: [] }, { type: "function", name: "scopeTarget", stateMutability: "nonpayable", inputs: [{ name: "roleKey", type: "bytes32" }, { name: "targetAddress", type: "address" }], outputs: [] }, { type: "function", name: "scopeFunction", stateMutability: "nonpayable", inputs: [{ name: "roleKey", type: "bytes32" }, { name: "targetAddress", type: "address" }, { name: "selector", type: "bytes4" }, { name: "conditions", type: "tuple[]", components: [{ name: "parent", type: "uint8" }, { name: "paramType", type: "uint8" }, { name: "operator", type: "uint8" }, { name: "compValue", type: "bytes" }] }, { name: "options", type: "uint8" }], outputs: [] }] as const;
const FACTORY_ABI = [{ type: "function", name: "deployModule", stateMutability: "nonpayable", inputs: [{ name: "masterCopy", type: "address" }, { name: "initializer", type: "bytes" }, { name: "saltNonce", type: "uint256" }], outputs: [{ name: "proxy", type: "address" }] }] as const;
const SAFE_READ_ABI = [{ type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] }, { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }, { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }, { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }, { type: "function", name: "masterCopy", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }, { type: "function", name: "getTransactionHash", stateMutability: "view", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "_nonce", type: "uint256" }], outputs: [{ name: "", type: "bytes32" }] }] as const;
const EXEC_TRANSACTION_ABI = [{ type: "function", name: "execTransaction", stateMutability: "payable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "signatures", type: "bytes" }], outputs: [{ name: "success", type: "bool" }] }] as const;
const MODULE_READ_ABI = [{ type: "function", name: "isModuleEnabled", stateMutability: "view", inputs: [{ name: "module", type: "address" },], outputs: [{ name: "", type: "bool" }] }, { type: "function", name: "getModulesPaginated", stateMutability: "view", inputs: [{ name: "start", type: "address" }, { name: "pageSize", type: "uint256" }], outputs: [{ name: "array", type: "address[]" }, { name: "next", type: "address" }] }] as const;
const ROLE_EXEC_ABI = [{ type: "function", name: "execTransactionWithRole", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }, { name: "roleKey", type: "bytes32" }, { name: "shouldRevert", type: "bool" }], outputs: [{ name: "success", type: "bool" }] }] as const;
const WITHDRAW_ABI = [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;
type SafeTx = { to: `0x${string}`; value: bigint; data: Hex; operation: 0; safeTxGas: bigint; baseGas: bigint; gasPrice: bigint; gasToken: `0x${string}`; refundReceiver: `0x${string}`; nonce: bigint };
const RPC_MAX_ATTEMPTS = 5;
const RPC_RETRY_BASE_MS = 300;
const RPC_RETRY_CAP_MS = 2_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before retrying. A rate limiter needs a real pause, not
 * the few hundred milliseconds a transient gateway blip needs, so this
 * backs off exponentially with jitter and prefers the provider's own
 * Retry-After hint when it sends one. Jitter matters because a single
 * authorization read issues a dozen calls in sequence: without it, several
 * reads that hit the same limit would retry in lockstep and re-trigger it.
 */
function retryDelayMs(attempt: number, response: Response | null): number {
  const hint = Number(response?.headers?.get("retry-after"));
  if (Number.isFinite(hint) && hint > 0) return Math.min(hint * 1000, 5_000);
  const backoff = Math.min(RPC_RETRY_BASE_MS * 2 ** (attempt - 1), RPC_RETRY_CAP_MS);
  return backoff + Math.floor(Math.random() * 150);
}
/** `ok: false` is the node reporting an execution error (a revert) - a real answer about the chain, not a failure to reach it. */
type RpcOutcome = { ok: true; result: unknown } | { ok: false; message: string };

/** Rate limiting as a JSON-RPC error: -32005 limit exceeded, and the codes Alchemy/Infura/QuickNode use for capacity. */
const RPC_RATE_LIMIT_CODES = new Set([-32005, -32029, -32097]);

/**
 * Distinguishes "the node refused to answer because we are over quota"
 * from "the chain answered, and the answer is a revert". They arrive in
 * the same shape, and conflating them is a fail-open, not a nuisance: a
 * negative permission probe counts an execution error as the Roles
 * modifier correctly rejecting the call, so five throttled probes would
 * read as five rejections and a Safe could reach "protected" without any
 * of them actually being checked. A rate limit is therefore treated as a
 * transport failure - retried, and thrown if it persists.
 */
function isRateLimitError(error: { code?: number; message?: string } | undefined): boolean {
  if (!error) return false;
  if (typeof error.code === "number" && RPC_RATE_LIMIT_CODES.has(error.code)) return true;
  return /rate limit|rate-limit|too many requests|limit exceeded|exceeded .*quota|over capacity|throttl/i.test(error.message ?? "");
}

/** True when a 200 response is really the provider refusing on quota grounds, single or batched. */
function bodyIsRateLimited(body: unknown): boolean {
  const entries = Array.isArray(body) ? body : [body];
  return entries.some((entry) => isRateLimitError((entry as { error?: { code?: number; message?: string } })?.error));
}

/**
 * One JSON-RPC round trip, moving to the next configured Base endpoint on
 * each attempt before failing closed. Being refused on quota says
 * something about that provider, not about Base, so the answer is another
 * provider rather than a longer wait on the same one - which is what lets
 * a deployment on public endpoints finish a verification at all.
 *
 * The thrown 502 names the call, the failure and the host it came from, so
 * an exhausted provider is distinguishable from a Safe that verifiably has
 * no module - the two used to collapse into the same opaque message. Only
 * the hostname is included: a key-authenticated URL carries its key.
 *
 * A JSON-RPC error is never turned into a 502: it is the node answering,
 * so it comes back as `ok: false` for the caller to interpret (a revert is
 * a meaningful result for a negative probe, and a 409 everywhere else).
 * Rate limiting is the exception - see isRateLimitError.
 */
async function postRpc(payload: unknown, label: string): Promise<unknown> {
  let lastDetail = "no response";
  let lastUrl = env.BASE_RPC_URLS[0];
  for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
    // Each attempt moves to the next endpoint. Being refused on quota is a
    // fact about that provider, not about Base, so retrying the same host
    // just burns the attempt - the next one answers immediately.
    const url = env.BASE_RPC_URLS[(attempt - 1) % env.BASE_RPC_URLS.length];
    lastUrl = url;
    let response: Response | null = null;
    try {
      response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (err) {
      lastDetail = `network error (${(err as Error).message})`;
    }
    if (response) {
      if (response.ok) {
        const body = await response.json();
        // A 200 carrying a rate-limit error is the provider refusing, not
        // the chain answering - retry it exactly like an HTTP 429.
        if (!bodyIsRateLimited(body)) return body;
        lastDetail = "rate limited by the provider";
      } else {
        lastDetail = `HTTP ${response.status}`;
      }
    }
    // Only wait once every endpoint has been tried - moving to a different
    // provider is not a retry against the one that just refused, so there
    // is nothing to back off from yet.
    const nextAttemptReusesAnEndpoint = attempt >= env.BASE_RPC_URLS.length;
    if (attempt < RPC_MAX_ATTEMPTS && nextAttemptReusesAnEndpoint) await sleep(retryDelayMs(attempt, response));
  }
  // Hostname only: a key-authenticated endpoint carries its key in the URL.
  const lastHost = (() => { try { return new URL(lastUrl).host; } catch { return "the configured endpoint"; } })();
  logger.warn({ rpcCall: label, detail: lastDetail, host: lastHost, endpointsTried: env.BASE_RPC_URLS.length, attempts: RPC_MAX_ATTEMPTS }, "Every Base RPC endpoint failed - failing closed");
  throw new HttpError(502, `Could not reach the Base network to verify your Safe (${label}: ${lastDetail} from ${lastHost}). Try again.`);
}

async function rpcOutcome(method: string, params: unknown[]): Promise<RpcOutcome> {
  const body = await postRpc({ jsonrpc: "2.0", id: 1, method, params }, method) as { result?: unknown; error?: { message?: string } };
  if (body?.error) return { ok: false, message: body.error.message ?? `Safe verification failed on ${method}` };
  return { ok: true, result: body?.result };
}

export interface RpcRequest { method: string; params: unknown[] }

/**
 * Sends independent reads as a single JSON-RPC batch, so verifying a Safe
 * is a handful of HTTP posts rather than one per call. That is the
 * difference between staying inside a provider's rate limit and being
 * throttled mid-verification - a throttled read fails closed, which shows
 * the owner of a perfectly good Safe an "unverifiable" card.
 *
 * Fail-closed in every direction. An unreachable or exhausted endpoint
 * throws out of postRpc. A response that is not an array at all means the
 * provider does not do batching, so the same reads are re-issued one at a
 * time rather than being abandoned. A batch that comes back missing one of
 * its answers throws too, and is never treated as an execution error -
 * that distinction matters because a missing answer read as a revert would
 * make a negative probe look like it had been correctly rejected.
 */
async function rpcBatch(requests: RpcRequest[]): Promise<RpcOutcome[]> {
  if (requests.length === 0) return [];
  if (requests.length === 1) return [await rpcOutcome(requests[0].method, requests[0].params)];

  const label = `batch ${requests.length}x(${[...new Set(requests.map((r) => r.method))].join(",")})`;
  const parsed = await postRpc(requests.map((request, index) => ({ jsonrpc: "2.0", id: index, method: request.method, params: request.params })), label);

  if (!Array.isArray(parsed)) {
    logger.warn({ rpcCall: label }, "Base RPC did not answer a batch as an array - falling back to one call at a time");
    const sequential: RpcOutcome[] = [];
    for (const request of requests) sequential.push(await rpcOutcome(request.method, request.params));
    return sequential;
  }

  const byId = new Map<unknown, { result?: unknown; error?: { message?: string } }>();
  for (const entry of parsed as { id?: unknown }[]) byId.set(entry?.id, entry as { result?: unknown; error?: { message?: string } });

  return requests.map((request, index) => {
    const entry = byId.get(index);
    if (!entry) throw new HttpError(502, `Could not reach the Base network to verify your Safe (${label}: the answer to ${request.method} was missing). Try again.`);
    if (entry.error) return { ok: false, message: entry.error.message ?? `Safe verification failed on ${request.method}` };
    return { ok: true, result: entry.result };
  });
}


async function rpc(method: string, params: unknown[]): Promise<unknown> { const outcome = await rpcOutcome(method, params); if (!outcome.ok) throw new HttpError(409, outcome.message); return outcome.result; }
/** Strips 0x and refuses returndata too short to decode, so an address that answers with nothing fails as a clear 409 rather than a raw BigInt("0x") crash. */
function returndataBody(raw: string, what: string): string { const body = raw.startsWith("0x") ? raw.slice(2) : raw; if (body.length < 64) throw new HttpError(409, `${what} returned no data - this address does not answer as a Safe on Base.`); return body; }
async function rpcCall(to: string, data: Hex): Promise<string> { const result = await rpc("eth_call", [{ to, data }, "latest"]); if (typeof result !== "string" || !result) throw new HttpError(409, "Safe verification returned no result"); return result; }
async function rpcCode(address: string): Promise<string> { const result = await rpc("eth_getCode", [address, "latest"]); if (typeof result !== "string") throw new HttpError(409, "Safe verification returned no code"); return result; }
function decodeAddressArray(hex: string): string[] { const body = returndataBody(hex, "getOwners()"); const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2; const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`)); const result: string[] = []; for (let i = 0; i < length; i++) result.push(`0x${body.slice(offset + 64 + i * 64 + 24, offset + 64 + i * 64 + 64)}`); return result; }
function decodeString(hex: string): string { const body = returndataBody(hex, "VERSION()"); const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2; const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`)); return Buffer.from(body.slice(offset + 64, offset + 64 + length * 2), "hex").toString("utf8"); }
function parseRolesImplementation(code: string): string | null { const body = code.toLowerCase().replace(/^0x/, ""); const prefix = "363d3d373d3d3d363d73"; const suffix = "5af43d82803e903d91602b57fd5bf3"; return body.startsWith(prefix) && body.endsWith(suffix) && body.length === 90 ? `0x${body.slice(prefix.length, prefix.length + 40)}` : null; }
export async function inspectSafeForAuthorization(safeAddress: `0x${string}`, connectedOwner: `0x${string}`) { const safeRead = (functionName: "getOwners" | "getThreshold" | "nonce" | "VERSION" | "masterCopy") => ({ method: "eth_call", params: [{ to: safeAddress, data: encodeFunctionData({ abi: SAFE_READ_ABI, functionName }) }, "latest"] }); const outcomes = await rpcBatch([safeRead("getOwners"), safeRead("getThreshold"), safeRead("nonce"), safeRead("VERSION"), safeRead("masterCopy"), { method: "eth_getCode", params: [safeAddress, "latest"] }]); const [ownersRaw, thresholdRaw, nonceRaw, versionRaw, masterCopyRaw, code] = outcomes.map((outcome) => { if (!outcome.ok) throw new HttpError(409, outcome.message); if (typeof outcome.result !== "string" || !outcome.result) throw new HttpError(409, "Safe verification returned no result"); return outcome.result; }); const owners = decodeAddressArray(ownersRaw); const masterCopy = `0x${masterCopyRaw.slice(-40)}`; const version = decodeString(versionRaw); return { owners, threshold: Number(BigInt(thresholdRaw)), nonce: BigInt(nonceRaw), version, masterCopy, isOwner: owners.some((o) => o.toLowerCase() === connectedOwner.toLowerCase()), isSafe: code !== "0x" && version === "1.4.1" && SUPPORTED_SAFE_SINGLETONS.some((singleton) => singleton.toLowerCase() === masterCopy.toLowerCase()) }; }
/** `knownImplementation` lets a caller that already read the proxy's bytecode pass it in, so one authorization read does not fetch the same code twice - fewer calls means fewer chances of being rate-limited mid-verification. Omit it and the code is read here. */
export type RolesModuleClassification = "compatible" | "incompatible_roles" | "other";

/**
 * The classification decision itself, with no I/O, so the batched and
 * single-module paths below can never drift apart on what counts as a
 * module Exit Keepa will trust. Only Roles v2.1.1 whose avatar, target and
 * owner are all the Safe itself is compatible; v2.1.0 is rejected
 * outright, and a module whose invariants could not be read is treated as
 * incompatible rather than given the benefit of the doubt.
 */
function classifyFromReads(implementation: string | null, invariants: { avatar: string; target: string; owner: string } | null, safeAddress: string): RolesModuleClassification {
  if (!implementation) return "other";
  if (implementation.toLowerCase() === ROLES_V2_1_0_MASTER_COPY.toLowerCase()) return "incompatible_roles";
  if (implementation.toLowerCase() !== ROLES_V2_1_1_MASTER_COPY.toLowerCase()) return "other";
  if (!invariants) return "incompatible_roles";
  const safe = safeAddress.toLowerCase();
  const pointsAtThisSafe = `0x${invariants.avatar.slice(-40)}`.toLowerCase() === safe && `0x${invariants.target.slice(-40)}`.toLowerCase() === safe && `0x${invariants.owner.slice(-40)}`.toLowerCase() === safe;
  return pointsAtThisSafe ? "compatible" : "incompatible_roles";
}

/**
 * Classifies every enabled module in a single HTTP post: each module's
 * proxy bytecode plus its avatar/target/owner, batched together. The
 * invariants are requested for every module rather than only for the ones
 * that turn out to be Roles v2.1.1 - reading three extra words costs
 * nothing inside a batch, and it removes a whole sequential round trip per
 * module. Modules that are not Roles simply revert on those calls, which
 * classifyFromReads reads as "not compatible".
 */
export async function classifyRolesModules(moduleAddresses: `0x${string}`[], safeAddress: `0x${string}`): Promise<Map<string, RolesModuleClassification>> {
  const classifications = new Map<string, RolesModuleClassification>();
  if (moduleAddresses.length === 0) return classifications;

  const requests: RpcRequest[] = [];
  for (const moduleAddress of moduleAddresses) {
    requests.push({ method: "eth_getCode", params: [moduleAddress, "latest"] });
    for (const selector of ["0x5aef7de6", "0xd4b83992", "0x8da5cb5b"]) requests.push({ method: "eth_call", params: [{ to: moduleAddress, data: selector }, "latest"] });
  }
  const outcomes = await rpcBatch(requests);

  moduleAddresses.forEach((moduleAddress, index) => {
    const base = index * 4;
    const codeOutcome = outcomes[base];
    // Bytecode that could not be read at all is a failed verification, not
    // a module to make a judgement about.
    if (!codeOutcome.ok) throw new HttpError(409, codeOutcome.message);
    const implementation = parseRolesImplementation(typeof codeOutcome.result === "string" ? codeOutcome.result : "0x");

    const reads = [outcomes[base + 1], outcomes[base + 2], outcomes[base + 3]];
    const values: string[] = [];
    for (const read of reads) if (read.ok && typeof read.result === "string" && read.result.length >= 42) values.push(read.result);
    const invariants = values.length === 3 ? { avatar: values[0], target: values[1], owner: values[2] } : null;

    classifications.set(moduleAddress.toLowerCase(), classifyFromReads(implementation, invariants, safeAddress));
  });
  return classifications;
}

export async function classifyRolesModule(modifierAddress: `0x${string}`, safeAddress: `0x${string}`): Promise<RolesModuleClassification> { return (await classifyRolesModules([modifierAddress], safeAddress)).get(modifierAddress.toLowerCase()) ?? "other"; }
export async function verifyRolesModifier(modifierAddress: `0x${string}`, safeAddress: `0x${string}`): Promise<boolean> { return (await classifyRolesModule(modifierAddress, safeAddress)) === "compatible"; }
export async function verifyFactory(): Promise<void> { const code = await rpcCode(ZODIAC_MODULE_PROXY_FACTORY); if (code === "0x" || code.length <= 2) throw new HttpError(503, "Automatic Safe setup is unavailable because the verified module factory is not deployed on Base."); if (!code.toLowerCase().includes(DEPLOY_SELECTOR.slice(2))) throw new HttpError(503, "Automatic Safe setup is unavailable because the verified module factory is not the expected Zodiac factory."); }
function safeTxTypedData(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) { return { domain: { chainId, verifyingContract: safeAddress }, types: SAFE_TX_TYPES, primaryType: "SafeTx" as const, message: { to: tx.to, value: tx.value, data: tx.data, operation: tx.operation, safeTxGas: tx.safeTxGas, baseGas: tx.baseGas, gasPrice: tx.gasPrice, gasToken: tx.gasToken, refundReceiver: tx.refundReceiver, nonce: tx.nonce } }; }
function addressCompValue(address: `0x${string}`): Hex { return encodeAbiParameters([{ type: "address" }], [address]); }
export function buildRoleConfigurationCalls(safeAddress: `0x${string}`, keeperAddress: `0x${string}`) { const roleKey = canonicalRoleKey(); const assignRoles = encodeFunctionData({ abi: ROLES_ABI, functionName: "assignRoles", args: [keeperAddress, [roleKey], [true]] }); const scopeTarget = encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeTarget", args: [roleKey, AAVE_V3_BASE.pool] }); const conditions = [{ parent: 0, paramType: 5, operator: 5, compValue: "0x" as Hex }, { parent: 0, paramType: 1, operator: 16, compValue: addressCompValue(AAVE_V3_BASE.usdc) }, { parent: 0, paramType: 1, operator: 0, compValue: "0x" as Hex }, { parent: 0, paramType: 1, operator: 16, compValue: addressCompValue(safeAddress) }] as const; const scopeFunction = encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeFunction", args: [roleKey, AAVE_V3_BASE.pool, AAVE_V3_WITHDRAW_SELECTOR, conditions, 0] }); return [{ id: "assign-role", label: "Authorize the Exit Keepa keeper", kind: "assign_role" as const, data: assignRoles }, { id: "scope-target", label: "Restrict the role to Aave on Base", kind: "scope_target" as const, data: scopeTarget }, { id: "scope-function", label: "Restrict the role to the USDC withdrawal", kind: "scope_function" as const, data: scopeFunction }] as const; }
export function buildSafeTransaction(args: { to: `0x${string}`; data: Hex; nonce: bigint }): SafeTx { return { to: args.to, value: 0n, data: args.data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: SAFE_ZERO_ADDRESS, refundReceiver: SAFE_ZERO_ADDRESS, nonce: args.nonce }; }
export function computeSafeTransactionHash(safeAddress: `0x${string}`, tx: SafeTx, chainId: number): Hex { return hashTypedData(safeTxTypedData(safeAddress, tx, chainId)); }
export function buildTypedDataForSafeTransaction(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) { return safeTxTypedData(safeAddress, tx, chainId); }
export function encodeExecTransaction(tx: SafeTx, signatures: Hex): Hex { return encodeFunctionData({ abi: EXEC_TRANSACTION_ABI, functionName: "execTransaction", args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures] }); }
export async function verifySafeTransactionHash(safeAddress: `0x${string}`, tx: SafeTx, chainId: number) { const localHash = computeSafeTransactionHash(safeAddress, tx, chainId); const raw = await rpcCall(safeAddress, encodeFunctionData({ abi: SAFE_READ_ABI, functionName: "getTransactionHash", args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce] })); const onchainHash = `0x${raw.slice(-64)}` as Hex; if (localHash.toLowerCase() !== onchainHash.toLowerCase()) throw new HttpError(409, "Could not verify the Safe transaction hash. Nothing was signed."); return { localHash, onchainHash }; }
export function buildRolesInitializer(safeAddress: `0x${string}`): Hex { const initParams = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [safeAddress, safeAddress, safeAddress]); return encodeFunctionData({ abi: ROLES_ABI, functionName: "setUp", args: [initParams] }); }
export function deriveModuleSaltNonce(safeAddress: `0x${string}`): bigint { return BigInt(keccak256(concatHex([stringToHex("exit-keepa:roles"), safeAddress as Hex]))); }
export function predictModuleProxyAddress(safeAddress: `0x${string}`, saltNonce: bigint): `0x${string}` { const initializer = buildRolesInitializer(safeAddress); const salt = keccak256(concatHex([keccak256(initializer), `0x${saltNonce.toString(16).padStart(64, "0")}`])); const deployment = (`0x${MODULE_PROXY_PREFIX}${ROLES_V2_1_1_MASTER_COPY.slice(2).toLowerCase()}${MODULE_PROXY_SUFFIX}`) as Hex; const addressHash = keccak256(concatHex(["0xff", ZODIAC_MODULE_PROXY_FACTORY, salt, keccak256(deployment)])); return `0x${addressHash.slice(-40)}`; }
export function buildDeployModuleTransaction(safeAddress: `0x${string}`) { const saltNonce = deriveModuleSaltNonce(safeAddress); const initializer = buildRolesInitializer(safeAddress); return { to: ZODIAC_MODULE_PROXY_FACTORY as `0x${string}`, value: "0x0", data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "deployModule", args: [ROLES_V2_1_1_MASTER_COPY, initializer, saltNonce] }), operation: 0 as const, saltNonce, predictedProxy: predictModuleProxyAddress(safeAddress, saltNonce) }; }
export async function inspectEnabledModules(safeAddress: `0x${string}`): Promise<string[]> { const modules: string[] = []; let start: `0x${string}` = SENTINEL_MODULES; for (let page = 0; page < 10_000; page++) { const raw = await rpcCall(safeAddress, encodeFunctionData({ abi: MODULE_READ_ABI, functionName: "getModulesPaginated", args: [start, 20n] })); const body = returndataBody(raw, "getModulesPaginated()"); const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2; /* `next` is a static `address` return value, so per the ABI head/tail layout it lives in the head - word1, immediately after the array's offset word - never in the tail after the array's own items. */ const next = `0x${body.slice(64 + 24, 64 + 64)}` as `0x${string}`; const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`)); for (let i = 0; i < length; i++) { const p = offset + 64 + i * 64; modules.push(`0x${body.slice(p + 24, p + 64)}`); } if (next.toLowerCase() === SENTINEL_MODULES.toLowerCase()) return modules; if (length === 0) throw new HttpError(409, "Safe module pagination could not be verified."); start = next; } throw new HttpError(409, "Safe module pagination exceeded the verification limit."); }
export async function verifyEnabledModule(safeAddress: `0x${string}`, moduleAddress: `0x${string}`): Promise<boolean> { return BigInt(await rpcCall(safeAddress, encodeFunctionData({ abi: MODULE_READ_ABI, functionName: "isModuleEnabled", args: [moduleAddress] }))) !== 0n; }
function mappingSlot(key: Hex, slot: bigint): Hex { return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [key, slot])); }
function nestedMappingSlot(key: `0x${string}`, parentSlot: Hex): Hex { return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [key, parentSlot])); }
function roleStructBase(roleKey: Hex): Hex { return mappingSlot(roleKey, ROLES_MAPPING_SLOT); }
function roleMemberSlot(roleKey: Hex, member: `0x${string}`): Hex { return nestedMappingSlot(member, roleStructBase(roleKey)); }
function roleTargetSlot(roleKey: Hex, target: `0x${string}`): Hex { return nestedMappingSlot(target, `0x${(BigInt(roleStructBase(roleKey)) + 1n).toString(16).padStart(64, "0")}`); }
function roleScopeSlot(roleKey: Hex, target: `0x${string}`, selector: `0x${string}`): Hex { const key = (`0x${target.slice(2).toLowerCase()}${selector.slice(2).toLowerCase()}${"0".repeat(16)}`) as Hex; return mappingSlot(key, BigInt(roleStructBase(roleKey)) + 2n); }
function decodeRoleHeader(header: Hex) { const value = BigInt(header); return { count: Number((value >> 240n) & 0xffffn), options: Number((value >> 224n) & 0xffn), wildcarded: ((value >> 216n) & 1n) === 1n, pointer: `0x${(value & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}` as `0x${string}` }; }
export async function readRolePermissionState(modifierAddress: `0x${string}`, safeAddress: `0x${string}`, memberAddress: `0x${string}`) { const roleKey = canonicalRoleKey(); const slots = [roleMemberSlot(roleKey, memberAddress), roleTargetSlot(roleKey, AAVE_V3_BASE.pool), roleScopeSlot(roleKey, AAVE_V3_BASE.pool, AAVE_V3_WITHDRAW_SELECTOR)]; const storageOutcomes = await rpcBatch(slots.map((slot) => ({ method: "eth_getStorageAt", params: [modifierAddress, slot, "latest"] }))); const [memberWord, targetWord, scopeHeader] = storageOutcomes.map((outcome) => { if (!outcome.ok) throw new HttpError(409, outcome.message); if (typeof outcome.result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(outcome.result)) throw new HttpError(409, "Safe permission state could not be read."); return outcome.result as Hex; }); const memberAssigned = (BigInt(memberWord) & 0xffn) === 1n; const targetValue = BigInt(targetWord); const targetScoped = Number(targetValue & 0xffn) === 2 && Number((targetValue >> 8n) & 0xffn) === 0; const header = decodeRoleHeader(scopeHeader); let functionScoped = false; if (header.count === 4 && header.options === 0 && !header.wildcarded && header.pointer !== SAFE_ZERO_ADDRESS) { const pointerCode = (await rpcCode(header.pointer)).toLowerCase().replace(/^0x/, ""); if (pointerCode.startsWith("00")) { const packed = pointerCode.slice(2); if (packed.length >= 144 && packed.slice(0, 16) === "00a5003000200030") { const comp1 = `0x${packed.slice(16, 80)}` as Hex; const comp2 = `0x${packed.slice(80, 144)}` as Hex; functionScoped = comp1.toLowerCase() === keccak256(addressCompValue(AAVE_V3_BASE.usdc)).toLowerCase() && comp2.toLowerCase() === keccak256(addressCompValue(safeAddress)).toLowerCase(); } } } return { memberAssigned, targetScoped, functionScoped, exact: memberAssigned && targetScoped && functionScoped }; }
export async function readExactRolePermission(modifierAddress: `0x${string}`, safeAddress: `0x${string}`, memberAddress: `0x${string}`): Promise<boolean> { return (await readRolePermissionState(modifierAddress, safeAddress, memberAddress)).exact; }
export async function verifyNegativeRoleProbes(modifierAddress: `0x${string}`, safeAddress: `0x${string}`, memberAddress: `0x${string}`): Promise<boolean> { const roleKey = canonicalRoleKey(); const validWithdrawal = encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "withdraw", args: [AAVE_V3_BASE.usdc, 0n, safeAddress] }); const attacker = "0x0000000000000000000000000000000000000001" as `0x${string}`; const probes = [{ to: AAVE_V3_BASE.pool, value: 1n, data: validWithdrawal, operation: 0 }, { to: AAVE_V3_BASE.pool, value: 0n, data: encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "withdraw", args: [SAFE_ZERO_ADDRESS, 0n, safeAddress] }), operation: 0 }, { to: AAVE_V3_BASE.pool, value: 0n, data: encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "withdraw", args: [AAVE_V3_BASE.usdc, 0n, attacker] }), operation: 0 }, { to: AAVE_V3_BASE.pool, value: 0n, data: "0x12345678" as Hex, operation: 0 }, { to: AAVE_V3_BASE.pool, value: 0n, data: validWithdrawal, operation: 1 }]; // All five probes go out in one batch - they are independent, and issuing
  // them one at a time was five separate chances to be rate-limited in the
  // middle of proving a permission is narrow.
  //
  // Only an on-chain rejection counts as a probe passing. rpcBatch throws
  // on a transport failure or a missing answer rather than returning, so an
  // unreachable RPC can never be mistaken for the Roles modifier refusing
  // the call - the old `catch {}` here treated both alike and would have
  // reported an over-broad permission as safe.
  const outcomes = await rpcBatch(probes.map((call) => ({
    method: "eth_call",
    params: [{ to: modifierAddress, data: encodeFunctionData({ abi: ROLE_EXEC_ABI, functionName: "execTransactionWithRole", args: [call.to, call.value, call.data, call.operation, roleKey, true] }), from: memberAddress }, "latest"],
  })));
  return outcomes.every((outcome) => !outcome.ok);
}
