import { Router } from "express";
import { eq } from "drizzle-orm";
import { createExitStrategySchema } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, exitStrategies } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";

export const exitStrategiesRouter = Router();

exitStrategiesRouter.get("/exit-strategies", async (_req, res) => {
  const rows = await db.select().from(exitStrategies);
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

/**
 * Creates an exit strategy record. This intentionally does NOT create a
 * KeeperHub workflow yet - wiring an exit strategy to a live KeeperHub
 * workflow requires the verified Safe/Zodiac execution flow described in
 * docs/keeperhub-integration.md, which is not implemented until that
 * contract is confirmed against a real KeeperHub API key.
 */
exitStrategiesRouter.post("/exit-strategies", async (req, res) => {
  const input = createExitStrategySchema.parse(req.body);

  const [row] = await db
    .insert(exitStrategies)
    .values({
      safeId: input.safeId,
      name: input.name,
      condition: input.condition,
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
