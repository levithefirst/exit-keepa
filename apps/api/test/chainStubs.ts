import { encodeAbiParameters, keccak256 } from "viem";
import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR } from "@exit-keepa/shared";

/**
 * Chain fixtures for the authorization reads that now gate strategy
 * creation, activation and every Guardian tick.
 *
 * These model a Safe the way the chain actually answers, so a test can
 * only reach "protected" by satisfying the same reads production does:
 * the module list, the Roles proxy's implementation and avatar/target/
 * owner invariants, the exact role storage slots, and the negative probes.
 * Nothing here short-circuits the gate - a fixture that stops modelling a
 * protected Safe makes the gate reject, which is the point.
 */

const ROLES_V2_1_1_MASTER_COPY = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5";
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";
const SELECTOR = {
  getModulesPaginated: "0xcc2f8452",
  avatar: "0x5aef7de6",
  target: "0xd4b83992",
  owner: "0x8da5cb5b",
} as const;

function word(hex: string): string {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

function rpcResult(result: unknown): SingleAnswer {
  return { result };
}

function rpcError(message: string): SingleAnswer {
  return { error: { message } };
}

/**
 * `getModulesPaginated(address,uint256)` returns `(address[] array, address
 * next)`. `next` is a static type, so it sits in the head at word1 - right
 * after the array's offset word - with nothing appended past the array's
 * items. Encoding it any other way would hide a decoder reading `next`
 * from the wrong place.
 */
function encodeModulesPage(modules: string[], next: string = SENTINEL_MODULES): string {
  return `0x${word("0x40")}${word(next)}${word(BigInt(modules.length).toString(16))}${modules.map(word).join("")}`;
}

function rolesProxyCode(implementation = ROLES_V2_1_1_MASTER_COPY): string {
  return `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
}

/** The packed condition pointer a correctly scoped withdraw(asset, amount, to) writes. */
function permissionPointerCode(safeAddress: string): string {
  const assetHash = keccak256(encodeAbiParameters([{ type: "address" }], [AAVE_V3_BASE.usdc]));
  const recipientHash = keccak256(encodeAbiParameters([{ type: "address" }], [safeAddress as `0x${string}`]));
  return `0x0000a5003000200030${assetHash.slice(2)}${recipientHash.slice(2)}`;
}

export interface ProtectedSafeFixture {
  safeAddress: string;
  modifierAddress: string;
  /** Storage pointer the scoped-function header points at. */
  pointerAddress?: string;
}

/** The `result` for one JSON-RPC request, `{ error }` for a call the chain rejects, or null for a request this fixture does not model. */
type SingleAnswer = { result: unknown } | { error: { message: string } } | null;

/**
 * Answers a JSON-RPC request - single or batched - for a fully protected
 * Safe. Production sends independent reads as one batched array, so the
 * fixture has to speak both shapes or the tests would stop exercising the
 * real transport. `fallback` handles anything this fixture does not model
 * (Aave rate reads, balances), per sub-request, so a mixed batch is still
 * answered correctly.
 */
export function answerRpc(
  fixture: ProtectedSafeFixture,
  body: any,
  fallback?: (request: { method: string; params: any[] }) => unknown,
  /** Runs before the fixture, per sub-request, so a test can model one read differently (a role whose storage is empty, say) even inside a batch. */
  override?: (request: { method: string; params: any[] }) => unknown,
): Response | null {
  const answerOne = (request: any): SingleAnswer =>
    fallbackAnswer(request, override) ?? resolveSingle(fixture, request) ?? fallbackAnswer(request, fallback);

  if (Array.isArray(body)) {
    const answers = body.map((entry) => {
      const answer = answerOne(entry);
      return answer ? { jsonrpc: "2.0", id: entry?.id, ...answer } : null;
    });
    if (answers.some((answer) => answer === null)) return null;
    return new Response(JSON.stringify(answers), { status: 200 });
  }
  const answer = answerOne(body);
  if (!answer) return null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? 1, ...answer }), { status: 200 });
}

function fallbackAnswer(request: any, fallback?: (request: { method: string; params: any[] }) => unknown): SingleAnswer {
  if (!fallback) return null;
  const result = fallback({ method: request?.method ?? "", params: request?.params ?? [] });
  return result === undefined ? null : { result };
}

/** Back-compat wrapper for callers that only need the fixture's own answers. */
export function protectedSafeRpc(fixture: ProtectedSafeFixture, body: any): Response | null {
  return answerRpc(fixture, body);
}

function resolveSingle(fixture: ProtectedSafeFixture, body: any): SingleAnswer {
  const pointer = fixture.pointerAddress ?? "0x4444444444444444444444444444444444444444";
  const safe = fixture.safeAddress.toLowerCase();
  const modifier = fixture.modifierAddress.toLowerCase();
  const method: string = body?.method ?? "";
  const params: any[] = body?.params ?? [];
  const call = params[0] ?? {};
  const to = String(call?.to ?? "").toLowerCase();
  const data = String(call?.data ?? "");

  if (method === "eth_getCode") {
    const address = String(params[0] ?? "").toLowerCase();
    if (address === modifier) return rpcResult(rolesProxyCode());
    if (address === pointer.toLowerCase()) return rpcResult(permissionPointerCode(fixture.safeAddress));
    if (address === safe) return rpcResult("0x6000");
    return null;
  }

  if (method === "eth_getStorageAt") {
    const address = String(params[0] ?? "").toLowerCase();
    if (address !== modifier) return null;
    // Storage is answered by slot rather than by call order, so the three
    // reads (role member, scoped target, scoped function header) stay
    // correct however they are interleaved or retried.
    const slot = String(params[1] ?? "").toLowerCase();
    const known = storageSlots(pointer);
    const value = known.get(slot);
    return rpcResult(value ?? `0x${word("0x0")}`);
  }

  if (method !== "eth_call") return null;

  if (to === safe && data.startsWith(SELECTOR.getModulesPaginated)) {
    return rpcResult(encodeModulesPage([fixture.modifierAddress]));
  }
  if (to === modifier && data.startsWith(SELECTOR.avatar)) return rpcResult(`0x${word(fixture.safeAddress)}`);
  if (to === modifier && data.startsWith(SELECTOR.target)) return rpcResult(`0x${word(fixture.safeAddress)}`);
  if (to === modifier && data.startsWith(SELECTOR.owner)) return rpcResult(`0x${word(fixture.safeAddress)}`);
  // Every negative probe (execTransactionWithRole from the keeper) must be
  // rejected on-chain for the permission to count as exact.
  if (to === modifier) return rpcError("execution reverted");

  return null;
}

/**
 * The exact Roles storage slots readRolePermissionState() reads, with the
 * values a correctly configured role holds. Mirrors the production slot
 * derivation rather than guessing at call ordering.
 */
function storageSlots(pointer: string): Map<string, string> {
  // Kept local to the fixture on purpose: importing the production slot
  // helpers would make the test agree with itself instead of with the
  // storage layout.
  const ROLES_MAPPING_SLOT = 4n;
  const KEEPER = "0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac";
  const roleKey = "0x657869745f6b6565706100000000000000000000000000000000000000000000";
  const withdrawSelector = AAVE_V3_WITHDRAW_SELECTOR;

  const mappingSlot = (key: string, slot: bigint) =>
    keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [key as `0x${string}`, slot]));
  const nestedMappingSlot = (key: string, parentSlot: string) =>
    keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [key as `0x${string}`, parentSlot as `0x${string}`]));

  const base = mappingSlot(roleKey, ROLES_MAPPING_SLOT);
  const memberSlot = nestedMappingSlot(KEEPER, base);
  const targetSlot = nestedMappingSlot(
    AAVE_V3_BASE.pool,
    `0x${(BigInt(base) + 1n).toString(16).padStart(64, "0")}`,
  );
  const scopeKey = `0x${AAVE_V3_BASE.pool.slice(2).toLowerCase()}${withdrawSelector.slice(2).toLowerCase()}${"0".repeat(16)}`;
  const scopeSlot = mappingSlot(scopeKey, BigInt(base) + 2n);

  const header = ((4n << 240n) | BigInt(pointer)).toString(16).padStart(64, "0");

  return new Map([
    [memberSlot.toLowerCase(), `0x${word("0x1")}`],
    [targetSlot.toLowerCase(), `0x${word("0x2")}`],
    [scopeSlot.toLowerCase(), `0x${header}`],
  ]);
}
