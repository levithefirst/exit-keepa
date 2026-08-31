import { Router } from "express";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR, type ExitAction, type RateCondition } from "@exit-keepa/shared";
import { db } from "../db";
import { auditEvents, exitStrategies, safeAccounts } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { buildExitTransaction } from "../execution/buildTransaction";
import { evaluateRateCondition } from "../execution/evaluateCondition";
import { readAaveUsdcRate } from "../agent/aaveRateOracle";

export const agentRouter = Router();

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

agentRouter.post("/exit-strategies/:id/agent/evaluate", async (req, res) => {
  const [strategy] = await db.select().from(exitStrategies).where(eq(exitStrategies.id, req.params.id)).limit(1);
  if (!strategy) throw new HttpError(404, `Exit strategy ${req.params.id} not found`);

  const [safe] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, strategy.safeId)).limit(1);
  if (!safe) throw new HttpError(404, `Safe account ${strategy.safeId} not found`);
  if (strategy.status !== "active") throw new HttpError(409, `Strategy is ${strategy.status}, not active`);
  if (safe.chainId !== AAVE_V3_BASE.chainId) throw new HttpError(409, "Exit Guardian only monitors Base strategies");

  const condition = strategy.condition as RateCondition;
  if (condition.market !== "aave-v3-base" || !["supply_apr", "borrow_apr"].includes(condition.metric)) {
    throw new HttpError(422, "Exit Guardian live monitoring currently supports Aave Base supply_apr and borrow_apr only");
  }

  const observation = await readAaveUsdcRate(condition.metric);
  const conditionMet = evaluateRateCondition(condition, observation.rateBps);
  const tx = buildExitTransaction(strategy.action as ExitAction, safe);

  const policy = {
    chainAllowed: safe.chainId === AAVE_V3_BASE.chainId,
    targetAllowed: tx.to === AAVE_V3_BASE.pool,
    actionAllowed: tx.decodedFunction === "withdraw(address asset, uint256 amount, address to)",
    selectorBound: tx.data.slice(0, 10).toLowerCase() === AAVE_V3_WITHDRAW_SELECTOR.toLowerCase(),
    assetBound: tx.decodedArgs.asset.toLowerCase() === AAVE_V3_BASE.usdc.toLowerCase(),
    recipientBound: tx.decodedArgs.to.toLowerCase() === safe.safeAddress.toLowerCase(),
    rolesConfigured: Boolean(safe.rolesModifierAddress && safe.rolesKey),
  };
  const policyPassed = Object.values(policy).every(Boolean);

  const intent = {
    strategyId: strategy.id,
    safeId: safe.id,
    safeAddress: safe.safeAddress,
    chainId: safe.chainId,
    condition,
    action: strategy.action,
    target: tx.to,
    calldata: tx.data,
  };
  const intentHash = hash(intent);
  const decision = conditionMet && policyPassed ? "approved" : "refused";
  const decisionReceipt = {
    version: 1,
    actor: "exit-guardian",
    decision,
    intentHash,
    observation,
    conditionMet,
    policy,
    simulationRequired: true,
    executionPath: "KeeperHub -> Zodiac Roles -> Safe -> Aave v3",
    decidedAt: new Date().toISOString(),
  };
  const receiptHash = hash(decisionReceipt);

  await db.insert(auditEvents).values({
    entityType: "exit_strategy",
    entityId: strategy.id,
    eventType: decision === "approved" ? "agent.decision_approved" : "agent.decision_refused",
    payload: { ...decisionReceipt, receiptHash },
  });

  res.status(200).json({
    decisionReceipt,
    receiptHash,
    tx: decision === "approved" ? tx : null,
    refusalReasons: [
      ...(conditionMet ? [] : ["Trigger condition is not satisfied by the live Aave observation"]),
      ...Object.entries(policy).filter(([, passed]) => !passed).map(([name]) => `Policy check failed: ${name}`),
    ],
  });
});
