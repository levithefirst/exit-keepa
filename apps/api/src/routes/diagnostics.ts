import { Router } from "express";
import crypto from "node:crypto";
import { env } from "../env";
import { keeperHubClient } from "../keeperhub/client";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { logger } from "../logger";

export const diagnosticsRouter = Router();

// Hardcoded, not query-param-driven: this diagnostic exists to test one
// specific, externally-supplied claim (a real Zodiac Roles Modifier
// instance on Base), not to proxy arbitrary contract-call requests.
const ZODIAC_ROLES_MASTERCOPY_BASE = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5";
const ZODIAC_ROLES_INSTANCE_CANDIDATE = "0x856dD89c7925977119b5C7330186B5238aD355a0";
const EXPECTED_AVATAR_SAFE = "0x0274a328e584cb43bf40b9a34fdc03b84dd9d02d";

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

// Registered before the generic ":resource" route below: Express matches
// routes in registration order, and ":resource" matches any single path
// segment literally (including "zodiac-instance-check"), so the specific
// route must come first or the generic one intercepts it as an
// "unknown_resource" 404 before it's ever reached.
diagnosticsRouter.get("/internal/diagnostics/keeperhub/zodiac-instance-check", async (req, res) => {
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

  try {
    const rpcResponse = await fetch(env.BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [ZODIAC_ROLES_INSTANCE_CANDIDATE, "latest"],
      }),
    });
    const rpcBody = (await rpcResponse.json()) as { result?: string; error?: unknown };
    const code = (rpcBody.result ?? "").toLowerCase();

    const mastercopyNoPrefix = ZODIAC_ROLES_MASTERCOPY_BASE.slice(2).toLowerCase();
    const eip1167Pattern = `363d3d373d3d3d363d73${mastercopyNoPrefix}5af43d82803e903d91602b57fd5bf3`;
    const isDeployed = code.length > 2;
    const isMinimalProxyOfMastercopy = code === `0x${eip1167Pattern}`;

    // Generic EIP-1167 parse (independent of which implementation it points
    // to): prefix(20 bytes) + implementation address(20 bytes) + suffix(15
    // bytes) = 45 bytes runtime code. Extracts the real implementation
    // address this instance delegates to, whatever it turns out to be -
    // does not assume it matches ZODIAC_ROLES_MASTERCOPY_BASE.
    const eip1167Prefix = "363d3d373d3d3d363d73";
    const eip1167Suffix = "5af43d82803e903d91602b57fd5bf3";
    const bodyHex = code.slice(2);
    const isGenericEip1167 =
      bodyHex.length === 90 && bodyHex.startsWith(eip1167Prefix) && bodyHex.endsWith(eip1167Suffix);
    const parsedImplementation = isGenericEip1167 ? `0x${bodyHex.slice(20, 60)}` : null;

    let implementationAbiCheck: unknown = null;
    if (parsedImplementation) {
      try {
        const abiResult = await keeperHubClient.rawGet(
          `/chains/${env.BASE_CHAIN_ID}/abi?address=${parsedImplementation}`,
        );
        const abiFns: string[] =
          Array.isArray((abiResult.body as any)?.abi) &&
          (abiResult.body as any).abi
            .filter((entry: any) => entry?.type === "function")
            .map((entry: any) => entry.name);
        implementationAbiCheck = {
          address: parsedImplementation,
          status: abiResult.status,
          functionNames: abiFns ?? null,
          hasExecTransactionWithRole: Array.isArray(abiFns) ? abiFns.includes("execTransactionWithRole") : null,
        };
      } catch (err) {
        implementationAbiCheck = { address: parsedImplementation, error: (err as Error).message };
      }
    }

    const bytecodeProof = {
      instanceAddress: ZODIAC_ROLES_INSTANCE_CANDIDATE,
      mastercopyAddress: ZODIAC_ROLES_MASTERCOPY_BASE,
      distinctFromMastercopy: ZODIAC_ROLES_INSTANCE_CANDIDATE.toLowerCase() !== ZODIAC_ROLES_MASTERCOPY_BASE.toLowerCase(),
      isDeployed,
      codeLength: code.length,
      isEip1167MinimalProxyOfMastercopy: isMinimalProxyOfMastercopy,
      parsedImplementationAddress: parsedImplementation,
      implementationAbiCheck,
      rawCode: code,
    };

    const getterResults: Record<string, unknown> = {};
    for (const getter of ["avatar", "owner", "target"]) {
      const request = {
        contractAddress: ZODIAC_ROLES_INSTANCE_CANDIDATE,
        chainId: env.BASE_CHAIN_ID,
        functionName: getter,
        simulate: true,
      };
      try {
        const result = await keeperHubClient.callContractFunction(request);
        const decoded = typeof result.result === "string" ? result.result : null;
        const normalizedDecoded = decoded ? `0x${decoded.replace(/^0x/, "").slice(-40).toLowerCase()}` : null;
        getterResults[getter] = {
          request,
          rawResult: result,
          decodedAddress: normalizedDecoded,
          matchesExpectedSafe: normalizedDecoded === EXPECTED_AVATAR_SAFE.toLowerCase(),
        };
      } catch (err) {
        getterResults[getter] = { request, error: (err as Error).message };
      }
    }

    // execTransactionWithRole simulate-only probe, run only after the three
    // getters above already confirmed this instance is real and readable.
    // simulate MUST stay true - this never broadcasts. Retried exactly once
    // on a timeout/network error or a 5xx from KeeperHub; not retried for
    // any other outcome (including a 4xx rejecting the call).
    const execTransactionWithRoleRequest = {
      contractAddress: ZODIAC_ROLES_INSTANCE_CANDIDATE,
      chainId: env.BASE_CHAIN_ID,
      functionName: "execTransactionWithRole",
      functionArgs:
        '["0x0000000000000000000000000000000000000001","0","0x","0","0x0000000000000000000000000000000000000000000000000000000000000000",true]',
      simulate: true,
    };
    let execTransactionWithRoleResult: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await keeperHubClient.callContractFunction(execTransactionWithRoleRequest);
        execTransactionWithRoleResult = { request: execTransactionWithRoleRequest, status: 200, rawResult: result };
        break;
      } catch (err) {
        const message = (err as Error).message;
        const is5xx = /KeeperHub API error (5\d\d):/.test(message);
        const isNetworkError = !/KeeperHub API error \d{3}:/.test(message);
        if (attempt === 1 && (is5xx || isNetworkError)) {
          continue;
        }
        execTransactionWithRoleResult = { request: execTransactionWithRoleRequest, error: message };
        break;
      }
    }

    try {
      await db.insert(auditEvents).values({
        entityType: "keeperhub_execution",
        entityId: crypto.randomUUID(),
        eventType: "keeperhub.diagnostics.zodiac_instance_checked",
        payload: { bytecodeProof, getterResults, execTransactionWithRoleResult },
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Diagnostics audit event insert failed (non-fatal)");
    }

    res
      .status(200)
      .json({ expectedAvatarSafe: EXPECTED_AVATAR_SAFE, bytecodeProof, getterResults, execTransactionWithRoleResult });
  } catch (err) {
    logger.error({ err }, "Zodiac instance diagnostics check failed");
    res.status(502).json({ error: "diagnostics_check_failed", message: (err as Error).message });
  }
});

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
