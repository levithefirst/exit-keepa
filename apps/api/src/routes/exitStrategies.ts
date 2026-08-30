import { Router } from "express";
import { eq } from "drizzle-orm";
import { createExitStrategySchema, type ExitAction } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, exitStrategies, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";
import { buildExitTransaction } from "../execution/buildTransaction";

export const exitStrategiesRouter = Router();

exitStrategiesRouter.get("/exit-strategies", async (req, res) => {
  const safeId = typeof req.query.safeId === "string" ? req.query.safeId : undefined;
  const rows = safeId
    ? await db.select().from(exitStrategies).where(eq(exitStrategies.safeId, safeId))
    : await db.select().from(exitStrategies);
  res.json(rows);
});

exitStrategiesRouter.get("/exit-strategies/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(exitStrategies)
    .where(eq(exitStrategies.id, req.params.id))
    .limit(1);

  if (!row) {
    throw new HttpError(404, `Exit strategy ${req.params.id} not found`);
  }
  res.json(row);
});

exitStrategiesRouter.post("/exit-strategies", async (req, res) => {
  const input = createExitStrategySchema.parse(req.body);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, input.safeId)).limit(1);
  if (!safe) {
    throw new HttpError(404, `Safe account ${input.safeId} not found`);
  }

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

async function loadStrategyAndSafe(strategyId: string) {
  const [row] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, strategyId)).limit(1);
  if (!row) throw new HttpError(404, `Exit strategy ${strategyId} not found`);

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
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id);
  const tx = buildExitTransaction(strategy.action as ExitAction, safe);
  res.status(200).json({ strategy, tx });
});

/**
 * Activates a strategy (draft/paused -> active) after confirming the Safe
 * actually has Roles configured and the transaction can be built. Does
 * NOT simulate or execute anything - see routes/executions.ts for that.
 */
exitStrategiesRouter.post("/exit-strategies/:id/activate", async (req, res) => {
  const { strategy, safe } = await loadStrategyAndSafe(req.params.id);

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
  const { strategy } = await loadStrategyAndSafe(req.params.id);

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
