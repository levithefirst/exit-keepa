import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, toFunctionSelector } from "viem";
import { AAVE_V3_BASE, canonicalRoleKey, type ExitAction } from "@exit-keepa/shared";
import { SELECTORS, decodeModulesPaginated, readAuthorizationStatus } from "./authorizationStatus";

const SAFE = "0x1111111111111111111111111111111111111111";
const MODIFIER = "0x2222222222222222222222222222222222222222";
const UNRELATED_MODULE = "0x3333333333333333333333333333333333333333";
const POINTER = "0x4444444444444444444444444444444444444444";
const WRONG_IMPLEMENTATION = "0x9646fdad06d3e24444381f44362a3b0eb343d337";
const ROLES_IMPLEMENTATION = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5";
const ACTION: ExitAction = { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" };
function word(hex: string): string { return hex.replace(/^0x/, "").padStart(64, "0"); }
function encodeModules(modules: string[]): string { return `0x${word("0x40")}${word("0x1")}${word(BigInt(modules.length).toString(16))}${modules.map(word).join("")}${word("0x1")}`; }
function rolesProxyCode(implementation = ROLES_IMPLEMENTATION): string { return `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`; }
function permissionPointerCode(): string { const assetHash = keccak256(encodeAbiParameters([{ type: "address" }], [AAVE_V3_BASE.usdc])); const recipientHash = keccak256(encodeAbiParameters([{ type: "address" }], [SAFE])); return `0x00${"00a5003000200030"}${assetHash.slice(2)}${recipientHash.slice(2)}`; }
function stubChain(options: { modules?: string[]; modifierAvatar?: string; modifierTarget?: string; modifierOwner?: string; implementation?: string; failModulesRead?: boolean; exactPermission?: boolean }) {
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}"); const method = body.method; const params = body.params ?? []; const call = params[0] ?? {}; const to = String(call.to ?? "").toLowerCase(); const data = String(call.data ?? "");
    if (method === "eth_getCode") { const result = to === MODIFIER.toLowerCase() ? rolesProxyCode(options.implementation) : to === POINTER.toLowerCase() ? permissionPointerCode() : "0x6000"; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 }); }
    if (method === "eth_getStorageAt") { const calls = (stubChain as unknown as { storageCalls?: number }).storageCalls ?? 0; (stubChain as unknown as { storageCalls?: number }).storageCalls = calls + 1; const result = options.exactPermission ? calls === 0 ? `0x${word("0x1")}` : calls === 1 ? `0x${word("0x2")}` : `0x${(4n << 240n | BigInt(POINTER)).toString(16).padStart(64, "0")}` : `0x${word("0x1")}`; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 }); }
    if (data.startsWith(SELECTORS.getModulesPaginated)) { if (options.failModulesRead) return new Response("boom", { status: 500 }); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeModules(options.modules ?? []) }), { status: 200 }); }
    if (to === MODIFIER.toLowerCase() && data.startsWith("0xa619486e")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word(options.implementation ?? ROLES_IMPLEMENTATION)}` }), { status: 200 });
    if (to === MODIFIER.toLowerCase() && data.startsWith(SELECTORS.avatar)) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word(options.modifierAvatar ?? SAFE)}` }), { status: 200 });
    if (to === MODIFIER.toLowerCase() && data.startsWith(SELECTORS.target)) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word(options.modifierTarget ?? SAFE)}` }), { status: 200 });
    if (to === MODIFIER.toLowerCase() && data.startsWith("0x8da5cb5b")) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${word(options.modifierOwner ?? SAFE)}` }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } }), { status: 200 });
  }));
  (stubChain as unknown as { storageCalls?: number }).storageCalls = 0;
}
const realSafe = { safeAddress: SAFE, chainId: 8453, rolesModifierAddress: null as string | null, rolesKey: null as string | null, isSandbox: false };
afterEach(() => { vi.unstubAllGlobals(); (stubChain as unknown as { storageCalls?: number }).storageCalls = 0; });

describe("authorization", () => {
  it("uses real selectors and one canonical role", () => { expect(SELECTORS.getModulesPaginated).toBe(toFunctionSelector("getModulesPaginated(address,uint256)")); expect(SELECTORS.avatar).toBe(toFunctionSelector("avatar()")); expect(SELECTORS.target).toBe(toFunctionSelector("target()")); expect(canonicalRoleKey()).toBe("0x657869745f6b6565706100000000000000000000000000000000000000000000"); });
  it("decodes enabled modules", () => expect(decodeModulesPaginated(encodeModules([MODIFIER, UNRELATED_MODULE]))).toEqual([MODIFIER.toLowerCase(), UNRELATED_MODULE.toLowerCase()]));
  it("needs a module when none is enabled", async () => { stubChain({ modules: [] }); const status = await readAuthorizationStatus(realSafe, ACTION); expect(status.state).toBe("needs_module"); });
  it("rejects vulnerable Roles v2.1.0", async () => { stubChain({ modules: [MODIFIER], implementation: WRONG_IMPLEMENTATION }); const status = await readAuthorizationStatus(realSafe, ACTION); expect(status.state).toBe("needs_module"); });
  it("rejects a module pointed at another Safe", async () => { stubChain({ modules: [MODIFIER], modifierAvatar: UNRELATED_MODULE, modifierTarget: UNRELATED_MODULE }); const status = await readAuthorizationStatus(realSafe, ACTION); expect(status.state).toBe("needs_module"); });
  it("reports needs_permission when the exact on-chain permission is incomplete", async () => { stubChain({ modules: [MODIFIER], exactPermission: false }); const status = await readAuthorizationStatus(realSafe, ACTION); expect(status.state).toBe("needs_permission"); expect(status.permissionChecked).toBe(true); });
  it("reports protected only after the exact Roles state and negative probes succeed", async () => { stubChain({ modules: [MODIFIER], exactPermission: true }); const status = await readAuthorizationStatus({ ...realSafe, rolesKey: canonicalRoleKey() }, ACTION); expect(status.state).toBe("protected"); expect(status.permissionChecked).toBe(true); });
  it("fails closed when module state cannot be read", async () => { stubChain({ failModulesRead: true }); const status = await readAuthorizationStatus(realSafe, ACTION); expect(status.state).toBe("undetermined"); expect(status.undetermined).toMatch(/Could not verify/); });
});
