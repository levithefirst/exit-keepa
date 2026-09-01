import type { DirectExecutionStatusResponse } from "../keeperhub/types";

/**
 * Pure decision logic for turning a polled Direct Execution status
 * response into the execution row's own terminal/non-terminal state,
 * factored out of routes/executions.ts the same way stateMachine.ts
 * factors out the broadcast-eligibility decision - directly unit
 * testable without a database or a real KeeperHub call.
 */
export interface ExecutionOutcome {
  status: "succeeded" | "failed" | "executing";
  /** Only ever a receipt-verified or already-regex-validated hash - never invented. */
  txHash: string | null;
  errorMessage: string | null;
}

/**
 * Decides the final execution outcome from a polled Direct Execution
 * status response, per
 * https://docs.keeperhub.com/api/direct-execution#get-execution-status:
 * "Treat the status response's receipts as the authoritative onchain
 * proof... transactionHash and transactionLink identify the transaction
 * but are self-reported by the write path." Receipts win over the
 * self-reported `status` field whenever both are present.
 *
 * `fallbackTxHash` is the already-regex-validated hash from the
 * synchronous broadcast response (see executor.ts's
 * extractTransactionHash) - used only while receipts don't yet give a
 * verified answer, and only ever returned attached to a non-terminal
 * `executing` outcome, never to a `succeeded` one.
 */
export function deriveExecutionOutcomeFromStatus(
  statusResponse: DirectExecutionStatusResponse,
  fallbackTxHash: string | null,
): ExecutionOutcome {
  const receipts = statusResponse.receipts ?? [];

  if (receipts.length > 0) {
    const verifiedSuccess = receipts.find((r) => r.verified && r.receiptStatus === "success");
    const allVerified = receipts.every((r) => r.verified);
    if (verifiedSuccess && allVerified) {
      return { status: "succeeded", txHash: verifiedSuccess.hash, errorMessage: null };
    }

    const failedReceipt = receipts.find(
      (r) => r.receiptStatus === "reverted" || r.receiptStatus === "safe_inner_failure",
    );
    if (failedReceipt) {
      const reason =
        failedReceipt.receiptStatus === "reverted"
          ? "reverted on-chain"
          : "succeeded at the outer transaction but the wrapped inner call failed";
      return {
        status: "failed",
        txHash: null,
        errorMessage: `Transaction ${failedReceipt.hash} ${reason} - see KeeperHub execution ${statusResponse.executionId}`,
      };
    }

    // Every receipt is still unverified, or stuck at not_found/timeout
    // without a definitive success or revert - stay non-terminal rather
    // than guess. A caller should keep polling.
    return { status: "executing", txHash: fallbackTxHash, errorMessage: null };
  }

  if (statusResponse.status === "failed") {
    return {
      status: "failed",
      txHash: null,
      errorMessage: statusResponse.error ?? `KeeperHub execution ${statusResponse.executionId} failed`,
    };
  }

  if (statusResponse.status === "completed") {
    // A "completed" status with zero receipts is unexpected for a write
    // that claimed a transaction hash - do not invent success from the
    // self-reported status alone with nothing on-chain backing it.
    return {
      status: fallbackTxHash ? "executing" : "failed",
      txHash: null,
      errorMessage: fallbackTxHash
        ? null
        : `KeeperHub execution ${statusResponse.executionId} reported completed with no receipts and no transaction hash`,
    };
  }

  // pending / running / unconfirmed, or an unrecognized status string -
  // per the docs, treat the status list as a lower bound and decide
  // terminality from the poll-interval hint (handled by the caller),
  // not by string-matching here.
  return { status: "executing", txHash: fallbackTxHash, errorMessage: null };
}
