import { Router } from "express";
import crypto from "node:crypto";
import { env } from "../env";
import { keeperHubClient } from "../keeperhub/client";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { logger } from "../logger";

export const diagnosticsRouter = Router();

/**
 * TEMPORARY - KeeperHub live-API verification only.
 *
 * Lets a trusted caller (us, from outside Railway's network) trigger a
 * server-side, authenticated GET against a small allow-listed set of
 * KeeperHub endpoints, from this deployment's own network, and see the
 * real status/headers/body - without KEEPERHUB_API_KEY ever leaving the
 * server or appearing in any response, log line, or commit.
 *
 * Gated by DIAGNOSTIC_SECRET (a value only we control, unrelated to the
 * KeeperHub key). If that env var isn't set, the route is disabled.
 *
 * Delete this file and its registration in index.ts once
 * docs/keeperhub-integration.md records confirmed, live-verified behavior
 * for the endpoints this project needs.
 */
const ALLOWED_RESOURCES: Record<string, string> = {
  chains: "/chains",
  keys: "/keys",
};

diagnosticsRouter.get("/internal/diagnostics/keeperhub/:resource", async (req, res) => {
  if (!env.DIAGNOSTIC_SECRET) {
    res.status(503).json({ error: "diagnostics_disabled" });
    return;
  }

  const provided = req.header("x-diagnostic-secret") ?? "";
  const expected = env.DIAGNOSTIC_SECRET;
  const authorized =
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

  if (!authorized) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const path = ALLOWED_RESOURCES[req.params.resource];
  if (!path) {
    res.status(404).json({ error: "unknown_resource", allowed: Object.keys(ALLOWED_RESOURCES) });
    return;
  }

  try {
    const result = await keeperHubClient.rawGet(path);

    try {
      await db.insert(auditEvents).values({
        entityType: "keeperhub_execution",
        entityId: crypto.randomUUID(),
        eventType: `keeperhub.diagnostics.${req.params.resource}_checked`,
        payload: { status: result.status, path },
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Diagnostics audit event insert failed (non-fatal)");
    }

    res.status(200).json(result);
  } catch (err) {
    logger.error({ err, path }, "KeeperHub diagnostics call failed");
    res.status(502).json({ error: "keeperhub_unreachable", message: (err as Error).message });
  }
});
