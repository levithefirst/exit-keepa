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

/**
 * A demo session's sandbox Safe (see routes/auth.ts's POST
 * /api/auth/demo-session) has a synthetic rolesModifierAddress/safeAddress
 * that doesn't exist on any real chain - a real KeeperHub simulate call
 * against it wouldn't test anything real, it would just fail with a
 * confusing "no such contract" error. Returned instead of ever calling
 * KeeperHub for one, and clearly labeled as such in responsePayload so
 * this is never mistaken for a real, chain-verified simulation - see
 * humanizeError.ts on the frontend, which surfaces this note as-is rather
 * than treating it as an opaque failure.
 */
function mockSandboxSimulation(tx: BuiltTransaction): Awaited<ReturnType<typeof simulateExitTransaction>> {
  const note =
    "Simulated in Exit Keepa's demo sandbox - not a real KeeperHub or onchain call, because this sandbox Safe doesn't exist on any real chain.";
  return {
    request: { contractAddress: tx.rolesModifierAddress, functionName: "execTransactionWithRole", simulate: true },
    raw: { sandbox: true, wouldRevert: false, note },
    parsed: { success: true, status: "sandbox_simulated", wouldRevert: false },
  };
}

export async function simulatePendingExecution(
  executionId: string,
  tx: BuiltTransaction,
  chainId: number,
  isSandbox = false,
): Promise<SimulateOutcome> {
  let result: Awaited<ReturnType<typeof simulateExitTransaction>>;
  if (isSandbox) {
    result = mockSandboxSimulation(tx);
  } else {
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
