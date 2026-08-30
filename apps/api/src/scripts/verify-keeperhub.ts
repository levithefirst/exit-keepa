import { env } from "../env";

/**
 * One-off verification script, run as a Railway preDeployCommand so every
 * request originates from Railway's own network (never this dev sandbox,
 * never a local machine). Prints a single machine-parseable line to
 * stdout (deploy logs) with status, response headers, and response body.
 * Never logs the Authorization header or the API key.
 *
 * Modes (process.argv[2]):
 *   chains | keys            - GET /<resource>
 *   execute-probe            - POST /execute/contract-call, progressively
 *                               built from KeeperHub's own validation
 *                               errors, one required field at a time. See
 *                               docs/keeperhub-integration.md for the
 *                               round-by-round record. Currently at the
 *                               zero-argument case: contractAddress,
 *                               chainId, functionName ("decimals" on
 *                               Base's WETH9 predeploy - a pure/view
 *                               getter, no state change possible).
 *   execute-args-probe       - Same technique, now probing how to pass
 *                               function ARGUMENTS: balanceOf(address)
 *                               on Base's WETH9 predeploy (0x4200...0006,
 *                               already confirmed a valid contractAddress
 *                               by KeeperHub in the execute-probe round -
 *                               an arbitrary from-memory USDC address was
 *                               tried first and rejected as
 *                               "Invalid contract address", so this
 *                               reuses the address already proven
 *                               correct rather than guess-fixing that
 *                               one), queried against the zero address.
 *                               Still a pure/view read - no funds, state,
 *                               approvals, or transfers involved
 *                               regardless of argument shape or whether
 *                               `simulate` gates broadcast.
 *   execute-bytes-probe      - Now probing a `bytes`-typed argument and
 *                               whether KeeperHub resolves a
 *                               non-ERC20-getter function's ABI:
 *                               isValidSignature(bytes32,bytes) on Safe's
 *                               own canonical v1.4.1 singleton contract
 *                               (0x41675C09...C7461a, published in
 *                               Safe's safe-deployments GitHub repo,
 *                               deployed identically across EVM chains
 *                               including Base via CREATE2 - this
 *                               address is from memory and unverified
 *                               against a live source; if KeeperHub
 *                               rejects it as invalid the same way an
 *                               earlier from-memory USDC address was
 *                               rejected, that itself is the result).
 *                               Throwaway inputs: a zero bytes32 hash and
 *                               a 2-byte garbage "signature". This is a
 *                               `view` function - it can only read/
 *                               revert, never move funds, change state,
 *                               or touch Zodiac/execution.
 *   zodiac-abi-probe         - Answers the ABI-resolution gate ahead of any
 *                               Zodiac contract-call attempt: GET
 *                               /chains/8453/abi?address=<Zodiac Roles
 *                               Modifier mastercopy address on Base>. Pure
 *                               metadata lookup - no contract-call,
 *                               execution, or Safe interaction of any
 *                               kind. Checks only whether KeeperHub can
 *                               resolve an ABI for this address at all,
 *                               and if so whether it exposes owner,
 *                               avatar, target, and
 *                               execTransactionWithRole.
 *   zodiac-instance-probe    - Runs only after zodiac-abi-probe is green.
 *                               Finds a REAL deployed Roles Modifier
 *                               instance on Base (not the mastercopy) via
 *                               Gnosis Guild's own public Roles subgraph
 *                               (the authoritative source their own SDK
 *                               uses), via GraphQL introspection first so
 *                               field names are learned rather than
 *                               guessed - this sandbox's egress proxy
 *                               blocks that subgraph's domain directly,
 *                               but Railway's network does not. If a real
 *                               instance address is found, calls exactly
 *                               one harmless getter (owner(), falling
 *                               back to avatar() then target()) on it via
 *                               KeeperHub's contract-call endpoint. No
 *                               write, no execTransactionWithRole, no
 *                               Safe interaction.
 *
 * Temporary - remove once docs/keeperhub-integration.md records confirmed
 * live behavior and the preDeployCommand has been cleared.
 */
const GET_RESOURCES = ["chains", "keys"] as const;

const WETH_BASE = "0x4200000000000000000000000000000000000006";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const SAFE_SINGLETON_V141 = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
// Proposed Zodiac Roles Modifier mastercopy address on Base, supplied for
// this verification round. Not yet independently confirmed against a
// public deployment registry - that is exactly what this probe is
// checking (ABI resolution only, not deployment validity).
const ZODIAC_ROLES_MASTERCOPY_BASE = "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5";

async function postJson(path: string, body: unknown) {
  const url = `${env.KEEPERHUB_API_BASE_URL.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.KEEPERHUB_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return { url, ...(await readBody(response)) };
}

async function getJson(path: string) {
  const url = `${env.KEEPERHUB_API_BASE_URL.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.KEEPERHUB_API_KEY}` },
  });
  return { url, ...(await readBody(response)) };
}

async function readBody(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON, leave as raw text
  }

  return { status: response.status, headers, body };
}

async function main() {
  const mode = process.argv[2];

  try {
    if (mode && (GET_RESOURCES as readonly string[]).includes(mode)) {
      const result = await getJson(`/${mode}`);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, ...result })}`);
      return;
    }

    if (mode === "execute-probe") {
      // Progressively built from KeeperHub's own validation errors, one
      // required field at a time - see docs/keeperhub-integration.md for
      // the round-by-round record. Not a real call: cannot execute
      // anything until every required field (including a real
      // contractAddress) is present, and this target contract is the
      // harmless WETH9 decimals() case anyway.
      const probeBody = {
        contractAddress: "0x4200000000000000000000000000000000000006",
        chainId: env.BASE_CHAIN_ID,
        functionName: "decimals",
        simulate: true,
      };
      const result = await postJson("/execute/contract-call", probeBody);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: probeBody, ...result })}`);
      return;
    }

    if (mode === "execute-args-probe") {
      // Round 1: no argument field at all, to learn its name/shape from
      // KeeperHub's own validation error rather than guessing. Still
      // cannot execute anything real: balanceOf is a pure/view read.
      const probeBody = {
        contractAddress: WETH_BASE,
        chainId: env.BASE_CHAIN_ID,
        functionName: "balanceOf",
        // Intentionally wrong arg count (balanceOf takes exactly 1) to
        // capture the malformed-argument error shape - still read-only,
        // still cannot execute or change anything.
        functionArgs: JSON.stringify([ZERO_ADDRESS, ZERO_ADDRESS]),
        simulate: true,
      };
      const result = await postJson("/execute/contract-call", probeBody);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: probeBody, ...result })}`);
      return;
    }

    if (mode === "execute-bytes-probe") {
      const probeBody = {
        contractAddress: SAFE_SINGLETON_V141,
        chainId: env.BASE_CHAIN_ID,
        functionName: "isValidSignature",
        functionArgs: JSON.stringify([ZERO_BYTES32, "0x1234"]),
        simulate: true,
      };
      const result = await postJson("/execute/contract-call", probeBody);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: probeBody, ...result })}`);
      return;
    }

    if (mode === "execute-disambiguation-probe") {
      // Disambiguates: is isValidSignature's "not found in ABI" caused by
      // an EIP-1271 overload/naming quirk, or does KeeperHub genuinely
      // not resolve non-ERC20 functions at all? getThreshold() is a
      // real, unambiguous, zero-argument, Safe-specific view getter with
      // no overloads - on the same contract address already accepted.
      const probeBody = {
        contractAddress: SAFE_SINGLETON_V141,
        chainId: env.BASE_CHAIN_ID,
        functionName: "getThreshold",
        simulate: true,
      };
      const result = await postJson("/execute/contract-call", probeBody);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: probeBody, ...result })}`);
      return;
    }

    if (mode === "zodiac-abi-probe") {
      const result = await getJson(`/chains/${env.BASE_CHAIN_ID}/abi?address=${ZODIAC_ROLES_MASTERCOPY_BASE}`);
      console.log(
        `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, address: ZODIAC_ROLES_MASTERCOPY_BASE, ...result })}`,
      );
      return;
    }

    if (mode === "zodiac-instance-probe") {
      const SUBGRAPH_URL = "https://gnosisguild.squids.live/roles:production/api/graphql";

      async function graphql(query: string) {
        const response = await fetch(SUBGRAPH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        return readBody(response);
      }

      // Step 1: learn the real field names from the schema itself - do not
      // guess a filter/field shape. Round 1 of this probe learned the
      // Query type exposes rolesModifier/role/rolesModifiers/memberOf
      // (not "roles"), and that Role has no "network"/avatar/target/owner
      // fields directly - those live on the related RolesModifier entity.
      // This round introspects RolesModifier directly instead of guessing.
      const introspection = await graphql(
        '{ __schema { queryType { fields { name args { name } } } } rmType: __type(name: "RolesModifier") { fields { name type { name kind ofType { name } } } } }',
      );
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: `${mode}:introspection2`, ...introspection })}`);

      const rmFields = (introspection.body as any)?.data?.rmType?.fields as
        | Array<{ name: string }>
        | undefined;
      const queryFields = (introspection.body as any)?.data?.__schema?.queryType?.fields as
        | Array<{ name: string; args: Array<{ name: string }> }>
        | undefined;

      if (!rmFields || !queryFields) {
        console.log(
          `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({
            resource: mode,
            stopped: "introspection did not return a usable RolesModifier type or query field list - see introspection2 result above",
          })}`,
        );
        return;
      }

      const listFieldMeta = queryFields.find((f) => f.name === "rolesModifiers");
      const wantedFields = ["id", "chainId", "avatar", "target", "owner"].filter((f) =>
        rmFields.some((rf) => rf.name === f),
      );

      if (!listFieldMeta || wantedFields.length === 0) {
        console.log(
          `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({
            resource: mode,
            stopped: "no usable rolesModifiers list query or RolesModifier fields found via introspection",
            availableQueryFields: queryFields.map((f) => f.name),
            availableRolesModifierFields: rmFields.map((f) => f.name),
          })}`,
        );
        return;
      }

      // Fetch without a where-filter (its exact argument syntax is
      // unconfirmed) and filter client-side by chainId - avoids guessing
      // filter-argument shape while still only using confirmed field names.
      const listQuery = `{ rolesModifiers { ${wantedFields.join(" ")} } }`;
      const listResult = await graphql(listQuery);
      console.log(
        `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: `${mode}:list`, query: listQuery, ...listResult })}`,
      );

      const allModifiers = (listResult.body as any)?.data?.rolesModifiers as
        | Array<{ id?: string; chainId?: number; avatar?: string; target?: string; owner?: string }>
        | undefined;
      const baseModifiers = allModifiers?.filter((m) => m.chainId === env.BASE_CHAIN_ID) ?? [];
      console.log(
        `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({
          resource: `${mode}:filtered`,
          totalReturned: allModifiers?.length ?? 0,
          baseMatches: baseModifiers.length,
          baseModifiers,
        })}`,
      );
      const instanceAddress = baseModifiers[0]?.id ?? baseModifiers[0]?.avatar ?? baseModifiers[0]?.target;

      if (!instanceAddress) {
        console.log(
          `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({
            resource: mode,
            stopped: "subgraph query returned no Base instance - no independently-verified instance address available, not proceeding to a getter call",
          })}`,
        );
        return;
      }

      // Step 3: exactly one harmless getter call via KeeperHub on the
      // discovered real instance. Preference order per task spec:
      // owner() -> avatar() -> target().
      for (const getter of ["owner", "avatar", "target"]) {
        const probeBody = {
          contractAddress: instanceAddress,
          chainId: env.BASE_CHAIN_ID,
          functionName: getter,
          simulate: true,
        };
        const result = await postJson("/execute/contract-call", probeBody);
        console.log(
          `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: `${mode}:getter`, request: probeBody, ...result })}`,
        );
        if (result.status >= 200 && result.status < 300) {
          break;
        }
      }
      return;
    }

    console.log(
      `KEEPERHUB_VERIFY_ERROR ${JSON.stringify({
        message: `mode must be one of ${[...GET_RESOURCES, "execute-probe", "execute-args-probe", "execute-bytes-probe", "execute-disambiguation-probe", "zodiac-abi-probe", "zodiac-instance-probe"].join(", ")}`,
        given: mode,
      })}`,
    );
  } catch (err) {
    console.log(`KEEPERHUB_VERIFY_ERROR ${JSON.stringify({ mode, message: (err as Error).message })}`);
  }
}

main();
