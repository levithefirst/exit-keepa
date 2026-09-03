import { Router } from "express";
import { eq } from "drizzle-orm";
import { createExitStrategySchema, type ExitAction } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, exitStrategies, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { buildExitTransaction } from "../execution/buildTransaction";
import { buildRolesPermissionSpec } from "../execution/rolesPermission";
import { requireSafeOwnership, requireSession } from "../auth/session";

export const exitStrategiesRouter = Router();

exitStrategiesRouter.get("/exit-strategies", async (req, res) => {
  const address = await requireSession(req);
  const safeId = typeof req.query.safeId === "string" ? req.query.safeId : undefined;
  if (!safeId) {
    throw new HttpError(400, "safeId query parameter is required");
  }
  await requireSafeOwnership(safeId, address);

  const rows = await db.select().from(exitStrategies).where(eq(exitStrategies.safeId, safeId));
  res.json(rows);
});

exitStrategiesRouter.get("/exit-strategies/:id", async (req, res) => {
  const address = await requireSession(req);
  const [row] = await db
    .select()
    .from(exitStrategies)
    .where(eq(exitStrategies.id, req.params.id))
    .limit(1);

  if (!row) {
    throw new HttpError(404, `Exit strategy ${req.params.id} not found`);
  }
  await requireSafeOwnership(row.safeId, address);
  res.json(row);
});

exitStrategiesRouter.post("/exit-strategies", async (req, res) => {
  const address = await requireSession(req);
  const input = createExitStrategySchema.parse(req.body);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, input.safeId)).limit(1);
  if (!safe) {
    throw new HttpError(404, `Safe account ${input.safeId} not found`);
  }
  await requireSafeOwnership(input.safeId, address);

  const [row] = await db
    .insert(exitStrategies)
    .values({
      safeId: input.safeId,
      name: input.name,
      condition: input.condition,
      action: input.action,
    })
    .returning();

  await db.insert(auditEvents).values({
    entityType: "exit_strategy",
    entityId: row.id,
    eventType: "exit_strategy.created",
    payload: { input },
  });

  logger.info({ exitStrategyId: row.id }, "Exit strategy created");
  res.status(201).json(row);
});

/** Loads the strategy + its Safe and enforces that `address` owns that Safe. */
export async function loadOwnedStrategyAndSafe(strategyId: string, address: string) {
  const [row] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, strategyId)).limit(1);
  if (!row) throw new HttpError(404, `Exit strategy ${strategyId} not found`);

  await requireSafeOwnership(row.safeId, address);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, row.safeId)).limit(1);
  if (!safe) throw new HttpError(404, `Safe account ${row.safeId} not found`);

  return { strategy: row, safe };
}

/**
 * Deterministically rebuilds the exact transaction this strategy would
 * execute, without calling KeeperHub or touching the chain. This is what
 * the "review the exact transaction" step in the UI calls before a user
 * ever simulates or activates anything.
 */
exitStrategiesRouter.get("/exit-strategies/:id/preview", async (req, res) => {
  const address = await requireSession(req);
  const { strategy, safe } = await loadOwnedStrategyAndSafe(req.params.id, address);

  let tx = null;
  let txError: string | null = null;
  try {
    tx = buildExitTransaction(strategy.action as ExitAction, safe);
  } catch (err) {
    // Missing Roles config isn't a request error here - the preview still
    // has something useful to show (the permission that's needed).
    txError = (err as Error).message;
  }

  // Whether a real transaction could actually be built is the honest test
  // of "ready", so the spec's setupState is derived from it rather than
  // from the presence of a Modifier address alone.
  const rolesPermission = buildRolesPermissionSpec({
    chainId: safe.chainId,
    safeAddress: safe.safeAddress,
    rolesModifierAddress: safe.rolesModifierAddress,
    roleKey: safe.rolesKey,
    isSandbox: safe.isSandbox,
    executable: tx !== null,
  });

  res.status(200).json({ strategy, tx, txError, rolesPermission });
});

/**
 * Activates a strategy (draft/paused -> active) after confirming the Safe
 * actually has Roles configured and the transaction can be built. Does
 * NOT simulate or execute anything - see routes/executions.ts for that.
 */
exitStrategiesRouter.post("/exit-strategies/:id/activate", async (req, res) => {
  const address = await requireSession(req);
  const { strategy, safe } = await loadOwnedStrategyAndSafe(req.params.id, address);

  // Throws 409 if the Safe has no Roles Modifier / role key yet - a
  // strategy can never be activated without a real, buildable transaction
  // behind it.
  buildExitTransaction(strategy.action as ExitAction, safe);

  const [updated] = await db
    .update(exitStrategies)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(exitStrategies.id, strategy.id))
    .returning();

  await db.insert(auditEvents).values({
    entityType: "exit_strategy",
    entityId: strategy.id,
    eventType: "exit_strategy.activated",
    payload: {},
  });

  res.status(200).json(updated);
});

exitStrategiesRouter.post("/exit-strategies/:id/pause", async (req, res) => {
  const address = await requireSession(req);
  const { strategy } = await loadOwnedStrategyAndSafe(req.params.id, address);

  const [updated] = await db
    .update(exitStrategies)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(exitStrategies.id, strategy.id))
    .returning();

  await db.insert(auditEvents).values({
    entityType: "exit_strategy",
    entityId: strategy.id,
    eventType: "exit_strategy.paused",
    payload: {},
  });

  res.status(200).json(updated);
});
