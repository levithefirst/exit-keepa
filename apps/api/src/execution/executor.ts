import { keeperHubClient } from "../keeperhub/client";
import type { ExecTransactionWithRoleResult } from "../keeperhub/types";
import type { BuiltTransaction } from "./buildTransaction";
import { logger } from "../logger";

const VALID_TX_HASH = /^0x[a-fA-F0-9]{64}$/;

export interface ExecTransactionCallResult {
  request: Record<string, unknown>;
  raw: unknown;
  parsed: ExecTransactionWithRoleResult | null;
}

function buildRequest(tx: BuiltTransaction, chainId: number, simulate: boolean) {
  return {
    contractAddress: tx.rolesModifierAddress,
    chainId,
    functionName: "execTransactionWithRole",
    functionArgs: JSON.stringify([tx.to, tx.value, tx.data, String(tx.operation), tx.roleKey, true]),
    simulate,
  };
}

async function callExecTransactionWithRole(
  tx: BuiltTransaction,
  chainId: number,
  simulate: boolean,
): Promise<ExecTransactionCallResult> {
  const request = buildRequest(tx, chainId, simulate);
  const raw = await keeperHubClient.callContractFunction(request);
  // The real response for execTransactionWithRole is a richer shape than
  // the plain-read ContractCallResult the client is typed to return (see
  // ExecTransactionWithRoleResult's doc comment) - re-read it defensively
  // rather than trusting the narrower compile-time type.
  const parsed =
    raw && typeof raw === "object" && "wouldRevert" in (raw as unknown as Record<string, unknown>)
      ? (raw as unknown as ExecTransactionWithRoleResult)
      : null;
  return { request, raw, parsed };
}

/** Simulates the transaction (simulate: true). Never broadcasts. */
export function simulateExitTransaction(tx: BuiltTransaction, chainId: number) {
  return callExecTransactionWithRole(tx, chainId, true);
}

/**
 * Broadcasts the transaction for real (simulate: false). Only ever call
 * this after a successful simulation and after confirming no prior
 * broadcast exists for this execution row - see routes/executions.ts.
 *
 * The exact response shape for a real broadcast has not been previously
 * live-verified in this project (only reverting/simulated calls have
 * been). So a transaction hash is only ever trusted, stored, or reported
 * to the user if it matches a well-formed 66-character 0x hash - anything
 * else is treated as "broadcast attempted, hash unconfirmed" rather than
 * fabricated or guessed at.
 */
export async function broadcastExitTransaction(tx: BuiltTransaction, chainId: number) {
  const result = await callExecTransactionWithRole(tx, chainId, false);

  const candidateHash =
    result.parsed?.transactionHash ??
    (typeof (result.raw as Record<string, unknown> | undefined)?.result === "string"
      ? ((result.raw as Record<string, unknown>).result as string)
      : undefined);

  const txHash = candidateHash && VALID_TX_HASH.test(candidateHash) ? candidateHash : null;

  if (candidateHash && !txHash) {
    logger.warn(
      { candidateHash },
      "Broadcast response contained a hash-like field that failed validation - not trusting it",
    );
  }

  return { ...result, txHash };
}
