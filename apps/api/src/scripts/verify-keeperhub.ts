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
 *   execute-probe            - POST /execute/contract-call with an EMPTY
 *                               body, purely to read back KeeperHub's own
 *                               validation error and learn the required
 *                               request fields without guessing a schema.
 *                               Cannot execute anything (no to/data).
 *   execute-harmless         - POST /execute/contract-call with
 *                               simulate: true against a canonical,
 *                               immutable, pure/view function
 *                               (decimals() on Base's WETH9 predeploy,
 *                               0x4200...0006) - cannot move funds, change
 *                               state, approve, transfer, or touch
 *                               Safe/Zodiac, regardless of whether
 *                               simulate actually prevents broadcast.
 *
 * Temporary - remove once docs/keeperhub-integration.md records confirmed
 * live behavior and the preDeployCommand has been cleared.
 */
const GET_RESOURCES = ["chains", "keys"] as const;

/**
 * decimals() on Base's WETH9 predeploy - a well-known, immutable, public
 * contract (https://docs.base.org). Selector 0x313ce567 is `decimals()`,
 * a pure/view getter: it cannot move funds, mutate state, approve, or
 * transfer anything, and has nothing to do with any Safe or Zodiac
 * module.
 */
const HARMLESS_CONTRACT_CALL = {
  chainId: env.BASE_CHAIN_ID,
  to: "0x4200000000000000000000000000000000000006",
  data: "0x313ce567",
  value: "0",
  simulate: true,
};

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
      };
      const result = await postJson("/execute/contract-call", probeBody);
      console.log(`KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: probeBody, ...result })}`);
      return;
    }

    if (mode === "execute-harmless") {
      const result = await postJson("/execute/contract-call", HARMLESS_CONTRACT_CALL);
      console.log(
        `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource: mode, request: HARMLESS_CONTRACT_CALL, ...result })}`,
      );
      return;
    }

    console.log(
      `KEEPERHUB_VERIFY_ERROR ${JSON.stringify({
        message: `mode must be one of ${[...GET_RESOURCES, "execute-probe", "execute-harmless"].join(", ")}`,
        given: mode,
      })}`,
    );
  } catch (err) {
    console.log(`KEEPERHUB_VERIFY_ERROR ${JSON.stringify({ mode, message: (err as Error).message })}`);
  }
}

main();
