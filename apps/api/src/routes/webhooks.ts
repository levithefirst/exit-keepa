import { Router } from "express";
import crypto from "node:crypto";
import { env } from "../env";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../logger";

export const webhooksRouter = Router();

/**
 * Receives execution status callbacks from KeeperHub. The exact payload
 * shape and signature scheme for KeeperHub webhooks were not confirmed
 * during integration research (see docs/keeperhub-integration.md) - this
 * endpoint verifies an HMAC-SHA256 signature against
 * KEEPERHUB_WEBHOOK_SECRET using the conventional `X-Signature` header
 * scheme, and records every inbound payload verbatim to the audit log so
 * nothing is lost while the real schema is confirmed. Do not build
 * business logic on top of specific payload fields until that shape is
 * verified against KeeperHub's real webhook deliveries.
 */
webhooksRouter.post("/webhooks/keeperhub", async (req, res) => {
  const signature = req.header("x-signature");
  const rawBody = JSON.stringify(req.body ?? {});

  if (!signature) {
    throw new HttpError(401, "Missing X-Signature header");
  }

  const expected = crypto
    .createHmac("sha256", env.KEEPERHUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const signatureValid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!signatureValid) {
    logger.warn("Rejected KeeperHub webhook with invalid signature");
    throw new HttpError(401, "Invalid signature");
  }

  await db.insert(auditEvents).values({
    entityType: "keeperhub_execution",
    entityId: req.body?.executionId ?? req.body?.id ?? crypto.randomUUID(),
    eventType: "keeperhub.webhook_received",
    payload: req.body ?? {},
  });

  logger.info({ body: req.body }, "Recorded KeeperHub webhook");
  res.status(202).json({ received: true });
});
