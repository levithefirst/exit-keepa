import { Router } from "express";
import { eq } from "drizzle-orm";
import { canonicalRoleKey } from "@exit-keepa/shared";
import { verifyTypedData } from "viem";
import { db } from "../db";
import { safeAccounts } from "../db/schema";
import { requireSafeOwnership, requireSession } from "../auth/session";
import { HttpError } from "../middleware/errorHandler";
import {
  buildRoleConfigurationCalls,
  buildSafeTransaction,
  buildTypedDataForSafeTransaction,
  encodeExecTransaction,
  inspectSafeForAuthorization,
  verifyRolesModifier,
  verifySafeTransactionHash,
} from "../safe/authorizationTransactions";
import { env } from "../env";

export const safeAuthorizationRouter = Router();

async function keeperAddress(): Promise<`0x${string}`> {
  const response = await fetch(`${env.KEEPERHUB_API_BASE_URL.replace(/\/$/, "")}/user`, {
    headers: { Authorization: `Bearer ${env.KEEPERHUB_API_KEY}` },
  });
  if (!response.ok) throw new HttpError(503, "Could not determine the automatic-exit signer. Try again.");
  const body = (await response.json()) as { walletAddress?: string };
  if (!body.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(body.walletAddress)) {
    throw new HttpError(503, "Automatic exits are not available right now. Try again later.");
  }
  return body.walletAddress as `0x${string}`;
}

async function getSafeRow(id: string, ownerAddress: string) {
  await requireSafeOwnership(id, ownerAddress);
  const [row] = await db.select().from(safeAccounts).where(eq(safeAccounts.id, id)).limit(1);
  if (!row) throw new HttpError(404, "Safe account not found");
  if (row.isSandbox) throw new HttpError(409, "Demo Safes cannot authorize real automatic exits.");
  return row;
}

safeAuthorizationRouter.post("/safe-accounts/:id/authorization/prepare", async (req, res) => {
  const owner = await requireSession(req);
  const row = await getSafeRow(req.params.id, owner);
  if (row.chainId !== 8453) throw new HttpError(409, "Your Safe is not on Base.");

  const inspection = await inspectSafeForAuthorization(row.safeAddress as `0x${string}`, owner as `0x${string}`);
  if (!inspection.isSafe) throw new HttpError(409, "That address is not a Safe.");
  if (!inspection.isOwner) throw new HttpError(403, "You are not an owner of this Safe.");
  if (inspection.threshold !== 1) {
    throw new HttpError(409, "This Safe needs more than one owner approval. Multisig authorization is not enabled here yet.");
  }
  if (!["1.3.0", "1.4.1", "1.5.0"].includes(inspection.version)) {
    throw new HttpError(409, "This Safe version is not supported by Exit Keepa yet.");
  }

  const modifier = (row.rolesModifierAddress ?? "") as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(modifier) || !(await verifyRolesModifier(modifier, row.safeAddress as `0x${string}`))) {
    throw new HttpError(409, "Your Safe needs one additional permission module before Exit Keepa can protect it.");
  }

  const step = Number(req.body?.step ?? 0);
  if (!Number.isInteger(step) || step < 0 || step > 2) throw new HttpError(400, "Invalid authorization step.");

  const keeper = await keeperAddress();
  const selected = buildRoleConfigurationCalls(row.safeAddress as `0x${string}`, keeper)[step];
  const tx = buildSafeTransaction({ to: modifier, data: selected.data, nonce: inspection.nonce });
  const hashes = await verifySafeTransactionHash(row.safeAddress as `0x${string}`, tx, 8453);
  const typedData = buildTypedDataForSafeTransaction(row.safeAddress as `0x${string}`, tx, 8453);

  res.json({
    step,
    stepCount: 3,
    label: selected.label,
    safeAddress: row.safeAddress,
    modifierAddress: modifier,
    keeperAddress: keeper,
    roleKey: canonicalRoleKey(),
    safeVersion: inspection.version,
    threshold: inspection.threshold,
    owners: inspection.owners,
    safeTx: {
      to: tx.to,
      value: tx.value.toString(),
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas.toString(),
      baseGas: tx.baseGas.toString(),
      gasPrice: tx.gasPrice.toString(),
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: tx.nonce.toString(),
    },
    safeTxHash: hashes.localHash,
    onchainSafeTxHash: hashes.onchainHash,
    typedData,
  });
});

safeAuthorizationRouter.post("/safe-accounts/:id/authorization/execute-calldata", async (req, res) => {
  const owner = await requireSession(req);
  const row = await getSafeRow(req.params.id, owner);
  if (row.chainId !== 8453) throw new HttpError(409, "Your Safe is not on Base.");

  const step = Number(req.body?.step ?? 0);
  const signature = String(req.body?.signature ?? "");
  const expectedHash = String(req.body?.safeTxHash ?? "").toLowerCase();
  if (!Number.isInteger(step) || step < 0 || step > 2 || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !/^0x[0-9a-fA-F]{64}$/.test(expectedHash)) {
    throw new HttpError(400, "The wallet signature could not be verified.");
  }

  const inspection = await inspectSafeForAuthorization(row.safeAddress as `0x${string}`, owner as `0x${string}`);
  if (!inspection.isOwner || inspection.threshold !== 1) throw new HttpError(403, "You cannot authorize this Safe.");
  const modifier = (row.rolesModifierAddress ?? "") as `0x${string}`;
  if (!(await verifyRolesModifier(modifier, row.safeAddress as `0x${string}`))) throw new HttpError(409, "Your Safe's permission module could not be verified.");

  const keeper = await keeperAddress();
  const selected = buildRoleConfigurationCalls(row.safeAddress as `0x${string}`, keeper)[step];
  const tx = buildSafeTransaction({ to: modifier, data: selected.data, nonce: inspection.nonce });
  const hashes = await verifySafeTransactionHash(row.safeAddress as `0x${string}`, tx, 8453);
  if (hashes.localHash.toLowerCase() !== expectedHash) throw new HttpError(409, "The authorization changed before the wallet signature was submitted. Sign the new request.");

  const typedData = buildTypedDataForSafeTransaction(row.safeAddress as `0x${string}`, tx, 8453);
  const valid = await verifyTypedData({
    address: owner as `0x${string}`,
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature: signature as `0x${string}`,
  });
  if (!valid) throw new HttpError(403, "The wallet signature does not belong to the connected Safe owner.");

  const execData = encodeExecTransaction(tx, signature as `0x${string}`);
  res.json({ to: row.safeAddress, value: "0x0", data: execData, safeTxHash: hashes.localHash });
});
