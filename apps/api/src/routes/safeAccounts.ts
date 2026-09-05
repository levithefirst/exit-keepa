import { Router } from "express";
import { eq } from "drizzle-orm";
import { canonicalRoleKey, createSafeAccountSchema, AAVE_V3_BASE, type ExitAction } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, safeAccounts, safeOwners } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { env } from "../env";
import { requireSafeOwnership, requireSession } from "../auth/session";
import { inspectSafeForAuthorization } from "../safe/authorizationTransactions";
import { readAuthorizationStatus } from "../safe/authorizationStatus";

export const safeAccountsRouter = Router();

safeAccountsRouter.get("/safe-accounts", async (req, res) => {
  const address = await requireSession(req);
  const owned = await db.select().from(safeOwners).where(eq(safeOwners.ownerAddress, address));
  if (owned.length === 0) { res.json([]); return; }
  const ownedIds = new Set(owned.map((o) => o.safeId));
  const rows = await db.select().from(safeAccounts);
  res.json(rows.filter((row) => ownedIds.has(row.id)));
});

safeAccountsRouter.get("/safe-accounts/:id", async (req, res) => {
  const address = await requireSession(req);
  await requireSafeOwnership(req.params.id, address);
  const [row] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, req.params.id)).limit(1);
  if (!row) throw new HttpError(404, `Safe account ${req.params.id} not found`);
  res.json(row);
});

safeAccountsRouter.post("/safe-accounts", async (req, res) => {
  const address = await requireSession(req);
  const input = createSafeAccountSchema.parse(req.body);
  const [row] = await db.insert(safeAccounts).values({ chainId: input.chainId, safeAddress: input.safeAddress, rolesModifierAddress: null, rolesKey: canonicalRoleKey() }).returning();
  await db.insert(safeOwners).values({ safeId: row.id, ownerAddress: address }).returning();
  await db.insert(auditEvents).values({ entityType: "safe", entityId: row.id, eventType: "safe_account.created", payload: { chainId: input.chainId, safeAddress: input.safeAddress, ownerAddress: address, roleKey: canonicalRoleKey() } });
  logger.info({ safeId: row.id, ownerAddress: address }, "Safe account registered");
  res.status(201).json(row);
});

safeAccountsRouter.get("/safe-accounts/:id/balances", async (req, res) => {
  const address = await requireSession(req);
  await requireSafeOwnership(req.params.id, address);
  const [row] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, req.params.id)).limit(1);
  if (!row) throw new HttpError(404, `Safe account ${req.params.id} not found`);
  const USDC_BASE = AAVE_V3_BASE.usdc;
  const balanceOfSelector = "0x70a08231";
  const paddedSafe = row.safeAddress.slice(2).toLowerCase().padStart(64, "0");
  async function rpc(method: string, params: unknown[]) {
    const response = await fetch(env.BASE_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = await response.json() as { result?: string; error?: unknown };
    if (body.error) throw new Error("balance read failed");
    return body.result ?? "0x0";
  }
  try {
    const [ethBalanceHex, usdcBalanceHex] = await Promise.all([rpc("eth_getBalance", [row.safeAddress, "latest"]), rpc("eth_call", [{ to: USDC_BASE, data: balanceOfSelector + paddedSafe }, "latest"])]);
    res.status(200).json({ safeAddress: row.safeAddress, chainId: row.chainId, eth: BigInt(ethBalanceHex).toString(), usdc: BigInt(usdcBalanceHex).toString() });
  } catch (err) {
    logger.error({ err }, "Failed to read Safe balances");
    res.status(502).json({ error: "balance_read_failed", message: "Could not read Safe balances" });
  }
});

safeAccountsRouter.get("/safe-accounts/:id/authorization", async (req, res) => {
  const address = await requireSession(req);
  await requireSafeOwnership(req.params.id, address);
  const [row] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, req.params.id)).limit(1);
  if (!row) throw new HttpError(404, `Safe account ${req.params.id} not found`);
  const probeAction: ExitAction = { protocol: "aave-v3-base", action: "withdraw", asset: AAVE_V3_BASE.usdc, amount: "max" };

  if (!row.isSandbox) {
    const inspection = await inspectSafeForAuthorization(row.safeAddress as `0x${string}`, address as `0x${string}`);
    if (!inspection.isSafe) throw new HttpError(409, "That address is not a compatible Safe.");
    if (!inspection.isOwner) throw new HttpError(403, "You are not an owner of this Safe.");
    if (inspection.threshold !== 1) throw new HttpError(409, "This Safe needs more than one owner approval. Multisig authorization is not enabled here yet.");
  }

  const status = await readAuthorizationStatus({ safeAddress: row.safeAddress, chainId: row.chainId, rolesModifierAddress: row.rolesModifierAddress, rolesKey: canonicalRoleKey(), isSandbox: row.isSandbox }, probeAction);
  if (!row.isSandbox && status.detectedModifierAddress && row.rolesModifierAddress !== status.detectedModifierAddress) {
    await db.update(safeAccounts).set({ rolesModifierAddress: status.detectedModifierAddress, rolesKey: canonicalRoleKey() }).where(eq(safeAccounts.id, row.id));
    await db.insert(auditEvents).values({ entityType: "safe", entityId: row.id, eventType: "safe_account.modifier_detected", payload: { detected: status.detectedModifierAddress, enabledModules: status.enabledModules } });
  }
  res.status(200).json(status);
});
