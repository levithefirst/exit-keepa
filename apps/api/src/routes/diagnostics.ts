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

// Hardcoded to the specific, independently-verified controlled Safe +
// Roles Modifier setup - not query-driven. One-shot simulate-only probe,
// never a general contract-call proxy.
const CONTROLLED_ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const CONTROLLED_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const CONTROLLED_ROLE_KEY =
  "0x657869745f6b6565706100000000000000000000000000000000000000000000";

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

    try {
      await db.insert(auditEvents).values({
        entityType: "keeperhub_execution",
        entityId: crypto.randomUUID(),
        eventType: "keeperhub.diagnostics.zodiac_instance_checked",
        payload: { bytecodeProof, getterResults },
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "Diagnostics audit event insert failed (non-fatal)");
    }

    res.status(200).json({ expectedAvatarSafe: EXPECTED_AVATAR_SAFE, bytecodeProof, getterResults });
  } catch (err) {
    logger.error({ err }, "Zodiac instance diagnostics check failed");
    res.status(502).json({ error: "diagnostics_check_failed", message: (err as Error).message });
  }
});

// Placeholder protective action for the Exit Keepa demo: approve(spender,
// 0) on Base USDC, spender = the controlled Safe itself. Not a real
// protocol interaction - a stand-in until a real target/function is
// chosen for the actual exit-strategy execution path.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// approve(address,uint256) selector (0x095ea7b3) + spender (CONTROLLED_SAFE,
// left-padded to 32 bytes) + amount 0 (32 zero bytes). Computed, not
// hand-assembled, to avoid a padding/offset error.
const APPROVE_ZERO_CALLDATA =
  "0x095ea7b3" +
  CONTROLLED_SAFE.slice(2).toLowerCase().padStart(64, "0") +
  "0".padStart(64, "0");

/**
 * TEMPORARY, SIMULATE-ONLY - execTransactionWithRole for the placeholder
 * Exit Keepa protective action: approve(CONTROLLED_SAFE, 0) on Base USDC,
 * called from the controlled Roles Modifier against the controlled Safe.
 * simulate is hardcoded true and cannot be overridden by the caller -
 * this route can never broadcast.
 */
diagnosticsRouter.get("/internal/diagnostics/keeperhub/controlled-safe-approve-zero-check", async (req, res) => {
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

  const request = {
    contractAddress: CONTROLLED_ROLES_MODIFIER,
    chainId: env.BASE_CHAIN_ID,
    functionName: "execTransactionWithRole",
    functionArgs: JSON.stringify([USDC_BASE, "0", APPROVE_ZERO_CALLDATA, "0", CONTROLLED_ROLE_KEY, true]),
    simulate: true,
  };

  let result: unknown;
  try {
    const raw = await keeperHubClient.callContractFunction(request);
    result = { request, status: 200, rawResult: raw };
  } catch (err) {
    result = { request, error: (err as Error).message };
  }

  try {
    await db.insert(auditEvents).values({
      entityType: "keeperhub_execution",
      entityId: crypto.randomUUID(),
      eventType: "keeperhub.diagnostics.controlled_safe_approve_zero_checked",
      payload: {
        target: USDC_BASE,
        decodedFunction: "approve(address spender, uint256 amount)",
        decodedArgs: { spender: CONTROLLED_SAFE, amount: "0" },
        calldata: APPROVE_ZERO_CALLDATA,
        result,
      },
    });
  } catch (dbErr) {
    logger.warn({ dbErr }, "Diagnostics audit event insert failed (non-fatal)");
  }

  res.status(200).json({
    target: USDC_BASE,
    decodedFunction: "approve(address spender, uint256 amount)",
    decodedArgs: { spender: CONTROLLED_SAFE, amount: "0" },
    calldata: APPROVE_ZERO_CALLDATA,
    result,
  });
});

/**
 * TEMPORARY, READ-ONLY - inspects the controlled Roles Modifier's actual
 * indexed configuration via Gnosis Guild's public Roles subgraph (the
 * same source used earlier to independently verify the foreign instance).
 * No contract write, no KeeperHub call, no broadcast. Introspects the
 * schema first rather than assuming field/type names, exactly as in the
 * earlier zodiac-instance-probe work.
 */
diagnosticsRouter.get("/internal/diagnostics/keeperhub/controlled-role-config-check", async (req, res) => {
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

  const SUBGRAPH_URL = "https://gnosisguild.squids.live/roles:production/api/graphql";

  async function graphql(query: string) {
    const response = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // not JSON, leave as raw text
    }
    return { status: response.status, body };
  }

  const steps: Record<string, unknown> = {};

  try {
    // Step 1: introspect RolesModifier.roles element type and Role.targets
    // element type - do not assume names, resolve them from the schema.
    const introspection1 = await graphql(
      '{ rmType: __type(name: "RolesModifier") { fields { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } } }',
    );
    steps.introspection1 = introspection1;

    const rmFields = (introspection1.body as any)?.data?.rmType?.fields as
      | Array<{ name: string; type: any }>
      | undefined;
    const rolesFieldType = rmFields?.find((f) => f.name === "roles")?.type;
    const roleTypeName =
      rolesFieldType?.ofType?.name ??
      rolesFieldType?.ofType?.ofType?.name ??
      rolesFieldType?.ofType?.ofType?.ofType?.name ??
      rolesFieldType?.name ??
      null;

    if (!roleTypeName) {
      res.status(200).json({
        stopped: "could not resolve RolesModifier.roles element type from introspection",
        steps,
      });
      return;
    }

    const introspection2 = await graphql(
      `{ roleType: __type(name: "${roleTypeName}") { fields { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } } }`,
    );
    steps.introspection2 = { roleTypeName, result: introspection2 };

    const roleFields = (introspection2.body as any)?.data?.roleType?.fields as
      | Array<{ name: string; type: any }>
      | undefined;
    const targetsFieldType = roleFields?.find((f) => f.name === "targets")?.type;
    const targetTypeName =
      targetsFieldType?.ofType?.name ??
      targetsFieldType?.ofType?.ofType?.name ??
      targetsFieldType?.ofType?.ofType?.ofType?.name ??
      targetsFieldType?.name ??
      null;

    let targetFields: Array<{ name: string; type: any }> | undefined;
    if (targetTypeName) {
      const introspection3 = await graphql(
        `{ targetType: __type(name: "${targetTypeName}") { fields { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } } }`,
      );
      steps.introspection3 = { targetTypeName, result: introspection3 };
      targetFields = (introspection3.body as any)?.data?.targetType?.fields;
    }

    // Only select fields introspection actually confirmed are scalar/enum
    // (safe to select without a further sub-selection), plus "id" and any
    // plainly-named nested list fields we'll ask about separately if found.
    const scalarLikeTargetFields = (targetFields ?? [])
      .filter((f) => f.type?.kind === "SCALAR" || f.type?.kind === "ENUM" || f.type?.ofType?.kind === "SCALAR" || f.type?.ofType?.kind === "ENUM")
      .map((f) => f.name);
    const nestedTargetFields = (targetFields ?? [])
      .filter((f) => !scalarLikeTargetFields.includes(f.name))
      .map((f) => f.name);
    steps.targetFieldClassification = { scalarLikeTargetFields, nestedTargetFields };

    const rmIdLower = CONTROLLED_ROLES_MODIFIER.toLowerCase();
    const targetSelection = scalarLikeTargetFields.length > 0 ? scalarLikeTargetFields.join(" ") : "id";
    const query = `{ rolesModifier(id: "${rmIdLower}") { id roles { id key targets { ${targetSelection} } } } }`;
    const dataResult = await graphql(query);
    steps.dataQuery = { query, result: dataResult };

    res.status(200).json({
      roleKey: CONTROLLED_ROLE_KEY,
      targetOfInterest: USDC_BASE,
      steps,
    });
  } catch (err) {
    res.status(502).json({ error: "role_config_check_failed", message: (err as Error).message, steps });
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
