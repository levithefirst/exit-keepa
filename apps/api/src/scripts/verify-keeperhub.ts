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
 *                               on Base's canonical USDC contract
 *                               (0x8335...29913, per Circle's published
 *                               Base deployment), queried against the
 *                               zero address. Still a pure/view read -
 *                               no funds, state, approvals, or transfers
 *                               involved regardless of argument shape or
 *                               whether `simulate` gates broadcast.
 *
 * Temporary - remove once docs/keeperhub-integration.md records confirmed
 * live behavior and the preDeployCommand has been cleared.
 */
const GET_RESOURCES = ["chains", "keys"] as const;

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
        contractAddress: USDC_BASE,
        chainId: env.BASE_CHAIN_ID,
        functionName: "balanceOf",
        simulate: true,
      };
      const result = await postJson("/execute/contract-call", probeBody);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: probeBody, ...result })}`);
      return;
    }

    console.log(
      `KEEPERHUB_VERIFY_ERROR ${JSON.stringify({
        message: `mode must be one of ${[...GET_RESOURCES, "execute-probe", "execute-args-probe"].join(", ")}`,
        given: mode,
      })}`,
    );
  } catch (err) {
    console.log(`KEEPERHUB_VERIFY_ERROR ${JSON.stringify({ mode, message: (err as Error).message })}`);
  }
}

main();
