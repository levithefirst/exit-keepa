import { eq } from "drizzle-orm";
import { db } from "../db";
import { exitStrategies } from "../db/schema";
import { logger } from "../logger";
import { env } from "../env";
import { evaluateStrategy } from "./guardian";
import type { RateCondition } from "@exit-keepa/shared";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

function isGuardianSupported(condition: unknown): condition is RateCondition {
  const c = condition as Partial<RateCondition> | null;
  return Boolean(c && c.market === "aave-v3-base" && (c.metric === "supply_apr" || c.metric === "borrow_apr"));
}

/**
 * One poll tick: evaluate every active, Guardian-supported strategy. A
 * failure evaluating one strategy (a bad RPC response, a DB hiccup) is
 * logged and skipped rather than allowed to take down the loop or block
 * the other strategies in the same tick - the autonomous loop must degrade
 * to "this one strategy didn't get checked this tick", never to "the whole
 * loop died silently".
 *
 * `tickInFlight` is a same-process guard against a tick still running past
 * the next interval firing (e.g. a slow RPC response) - it does not by
 * itself make concurrent execution attempts safe. That safety comes from
 * agent/guardian.ts's own conditional UPDATE on agent_state, which is
 * correct even across multiple processes/replicas, not just within one.
 */
export async function runPollTick(): Promise<{ evaluated: number; errored: number }> {
  if (tickInFlight) {
    logger.warn("Exit Guardian poll tick skipped - previous tick still in flight");
    return { evaluated: 0, errored: 0 };
  }
  tickInFlight = true;
  let evaluated = 0;
  let errored = 0;
  try {
    const strategies = await db.select().from(exitStrategies).where(eq(exitStrategies.status, "active"));
    const eligible = strategies.filter((s) => isGuardianSupported(s.condition));

    for (const strategy of eligible) {
      try {
        const receipt = await evaluateStrategy(strategy.id, "poller");
        evaluated++;
        if (receipt.decision === "triggered") {
          logger.info(
            { strategyId: strategy.id, executionId: receipt.executionId, policyPassed: receipt.policyPassed },
            "Exit Guardian autonomous trigger",
          );
        }
      } catch (err) {
        errored++;
        logger.error({ err, strategyId: strategy.id }, "Exit Guardian poll tick failed for strategy");
      }
    }
  } finally {
    tickInFlight = false;
  }
  return { evaluated, errored };
}

/** Starts the autonomous poll loop. No-op if AGENT_POLL_ENABLED is false or it's already running. */
export function startAgentPoller(): void {
  if (!env.AGENT_POLL_ENABLED) {
    logger.info("Exit Guardian autonomous poller disabled (AGENT_POLL_ENABLED=false)");
    return;
  }
  if (intervalHandle) return;

  logger.info({ intervalMs: env.AGENT_POLL_INTERVAL_MS }, "Starting Exit Guardian autonomous poller");
  intervalHandle = setInterval(() => {
    runPollTick().catch((err) => logger.error({ err }, "Exit Guardian poll tick threw unexpectedly"));
  }, env.AGENT_POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopAgentPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
