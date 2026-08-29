import { env } from "../env";

/**
 * One-off verification script, run as a Railway preDeployCommand so the
 * request originates from Railway's own network. Prints a single
 * machine-parseable line to stdout (deploy logs) containing status,
 * response headers, and response body for an allow-listed KeeperHub GET
 * endpoint. Never logs the Authorization header or the API key.
 *
 * Usage: node dist/scripts/verify-keeperhub.js <chains|keys>
 *
 * Temporary - remove once docs/keeperhub-integration.md records confirmed
 * live behavior and the preDeployCommand has been cleared.
 */
const ALLOWED = ["chains", "keys"] as const;

async function main() {
  const resource = process.argv[2];
  if (!resource || !ALLOWED.includes(resource as (typeof ALLOWED)[number])) {
    console.log(
      `KEEPERHUB_VERIFY_ERROR ${JSON.stringify({ message: `resource must be one of ${ALLOWED.join(", ")}`, given: resource })}`,
    );
    return;
  }

  const url = `${env.KEEPERHUB_API_BASE_URL.replace(/\/$/, "")}/${resource}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.KEEPERHUB_API_KEY}` },
    });

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

    console.log(
      `KEEPERHUB_VERIFY_RESULT ${JSON.stringify({ resource, url, status: response.status, headers, body })}`,
    );
  } catch (err) {
    console.log(
      `KEEPERHUB_VERIFY_ERROR ${JSON.stringify({ resource, url, message: (err as Error).message })}`,
    );
  }
}

main();
