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
 * Extracts a transaction hash from a KeeperHub broadcast response,
 * checking every field name/nesting actually observed across this
 * project's live broadcasts, plus the common aliases other KeeperHub
 * response shapes could plausibly use. LIVE-VERIFIED response shape for a
 * successful broadcast (2026-08-31,
 * tx 0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b):
 * `{ status: "completed", executionId, transactionHash, transactionLink }`
 * - no `wouldRevert` key, so it does NOT parse as
 * ExecTransactionWithRoleResult. The original implementation only
 * checked `parsed?.transactionHash` (gated on `wouldRevert` being
 * present) and a top-level `result` string, so it missed this exact
 * shape and reported a real, successful, on-chain broadcast as failed.
 * Never invents a hash - only returns one that was actually present in
 * the response.
 */
function extractTransactionHash(raw: unknown, parsed: ExecTransactionWithRoleResult | null): string | undefined {
  if (parsed?.transactionHash) return parsed.transactionHash;
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;
  const nested = [body, body.result, body.data].filter(
    (candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object",
  );
  for (const candidate of nested) {
    for (const key of ["transactionHash", "txHash", "hash"]) {
      const value = candidate[key];
      if (typeof value === "string") return value;
    }
  }
  // `result` itself as a bare string (the shape used by a plain read call).
  if (typeof body.result === "string") return body.result;
  return undefined;
}

/**
 * Broadcasts the transaction for real (simulate: false). Only ever call
 * this after a successful simulation and after confirming no prior
 * broadcast exists for this execution row - see routes/executions.ts.
 *
 * A transaction hash is only ever trusted, stored, or reported to the
 * user if it matches a well-formed 66-character 0x hash - anything else
 * is treated as "broadcast attempted, hash unconfirmed" rather than
 * fabricated or guessed at.
 */
export async function broadcastExitTransaction(tx: BuiltTransaction, chainId: number) {
  const result = await callExecTransactionWithRole(tx, chainId, false);

  const candidateHash = extractTransactionHash(result.raw, result.parsed);
  const txHash = candidateHash && VALID_TX_HASH.test(candidateHash) ? candidateHash : null;

  if (candidateHash && !txHash) {
    logger.warn(
      { candidateHash },
      "Broadcast response contained a hash-like field that failed validation - not trusting it",
    );
  }

  return { ...result, txHash };
}
