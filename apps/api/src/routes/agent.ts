import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentDecisions, exitStrategies, keeperhubExecutions } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { evaluateStrategy } from "../agent/guardian";
import { buildReceipt } from "../agent/receipt";
import { requireSafeOwnership, requireSession } from "../auth/session";

export const agentRouter = Router();

async function requireStrategyOwnership(strategyId: string, address: string) {
  const [strategy] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, strategyId)).limit(1);
  if (!strategy) throw new HttpError(404, `Exit strategy ${strategyId} not found`);
  await requireSafeOwnership(strategy.safeId, address);
  return strategy;
}

/** On-demand Guardian check - the same evaluateStrategy the autonomous poller calls, source tagged "manual". */
agentRouter.post("/exit-strategies/:id/agent/evaluate", async (req, res) => {
  const address = await requireSession(req);
  await requireStrategyOwnership(req.params.id, address);

  const receipt = await evaluateStrategy(req.params.id, "manual");
  res.status(200).json(receipt);
});

/** Every decision (approval, refusal, or a quiet "normal"/"held" tick) recorded for a strategy, newest first. */
agentRouter.get("/exit-strategies/:id/agent/decisions", async (req, res) => {
  const address = await requireSession(req);
  await requireStrategyOwnership(req.params.id, address);

  const rows = await db.select().from(agentDecisions).where(eq(agentDecisions.strategyId, req.params.id));
  const decisions = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const executionIds = decisions.map((d) => d.executionId).filter((id): id is string => id !== null);
  const executions = executionIds.length
    ? await db.select().from(keeperhubExecutions).where(eq(keeperhubExecutions.exitStrategyId, req.params.id))
    : [];
  const executionById = new Map(executions.map((e) => [e.id, e]));

  res.status(200).json(decisions.map((d) => buildReceipt(d, d.executionId ? (executionById.get(d.executionId) ?? null) : null)));
});

/** The single structured receipt for one decision - the object a judge opens to verify the demo. */
agentRouter.get("/agent/decisions/:decisionId", async (req, res) => {
  const address = await requireSession(req);

  const [decision] = await db.select().from(agentDecisions).where(eq(agentDecisions.id, req.params.decisionId)).limit(1);
  if (!decision) throw new HttpError(404, `Agent decision ${req.params.decisionId} not found`);
  await requireStrategyOwnership(decision.strategyId, address);

  let execution = null;
  if (decision.executionId) {
    const [row] = await db
      .select()
      .from(keeperhubExecutions)
      .where(eq(keeperhubExecutions.id, decision.executionId))
      .limit(1);
    execution = row ?? null;
  }

  res.status(200).json(buildReceipt(decision, execution));
});
