import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, keeperhubExecutions } from "../db/schema";
import { logger } from "../logger";
import { simulateExitTransaction } from "./executor";
import type { BuiltTransaction } from "./buildTransaction";

/**
 * Runs a simulation against KeeperHub for an execution row already in
 * `pending`, updates the row, and writes the matching audit event -
 * exactly what routes/executions.ts's manual "Simulate" button does. Shared
 * with agent/guardian.ts so an autonomous approval and a manual click go
 * through the identical simulate-and-record path; there is exactly one
 * place that decides what "simulated clean" vs "simulation failed" means.
 */
export interface SimulateOutcome {
  row: typeof keeperhubExecutions.$inferSelect;
  /** True only when the KeeperHub call itself failed (network/HTTP error) -
   *  distinct from a clean simulated revert, which is a successful call
   *  that answered "no". Callers that speak HTTP (routes/executions.ts) use
   *  this to pick 502 vs 200; the guardian doesn't care and just reads `row`. */
  callFailed: boolean;
}

export async function simulatePendingExecution(
  executionId: string,
  tx: BuiltTransaction,
  chainId: number,
): Promise<SimulateOutcome> {
  let result;
  try {
    result = await simulateExitTransaction(tx, chainId);
  } catch (err) {
    const [failed] = await db
      .update(keeperhubExecutions)
      .set({ status: "failed", errorMessage: (err as Error).message, updatedAt: new Date() })
      .where(eq(keeperhubExecutions.id, executionId))
      .returning();
    logger.error({ err, executionId }, "KeeperHub simulation call failed");
    return { row: failed, callFailed: true };
  }

  const wouldSucceed = result.parsed?.wouldRevert === false;
  const [updated] = await db
    .update(keeperhubExecutions)
    .set({
      status: wouldSucceed ? "simulated" : "failed",
      requestPayload: result.request,
      responsePayload: result.raw as object,
      errorMessage: wouldSucceed ? null : (result.parsed?.revertReason ?? "Simulation failed"),
      updatedAt: new Date(),
    })
    .where(eq(keeperhubExecutions.id, executionId))
    .returning();

  await db.insert(auditEvents).values({
    entityType: "keeperhub_execution",
    entityId: executionId,
    eventType: "execution.simulated",
    payload: { wouldSucceed, result },
  });

  return { row: updated, callFailed: false };
}
