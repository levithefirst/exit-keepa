/**
 * MUST be imported before anything from apps/api. See the note on ordering
 * at the bottom of this file.
 *
 * apps/api/src/env.ts validates the *API server's* whole configuration at
 * import time and exits the process if anything required is missing. That
 * is right for the API - a deployed Exit Keepa with no database is not a
 * degraded Exit Keepa, it's a broken one - but this MCP server is a
 * different, much smaller thing: it reads chain state, builds calldata,
 * runs the policy check, simulates, and reads execution status. It opens no
 * database, serves no webhook, and writes nothing anywhere.
 *
 * So the API-only variables are filled in here with obvious placeholders
 * rather than demanding a judge provision a Postgres URL to run a
 * read-only tool server. `??=` means a real value always wins if one is
 * set. This mirrors what apps/api/test/setup.ts already does for the same
 * reason, and none of these placeholder values is ever used: no module the
 * MCP tools import opens a database or verifies a webhook signature.
 *
 * KEEPERHUB_API_KEY is the one that genuinely matters, and it is
 * deliberately NOT treated as satisfied by its placeholder - see
 * hasKeeperHubCredentials(), which the two KeeperHub-backed tools check
 * before calling out, so a missing key produces a clear message instead of
 * a confusing 401 from KeeperHub.
 */

/** The stand-in written into KEEPERHUB_API_KEY when the operator set none. */
const PLACEHOLDER_KEEPERHUB_API_KEY = "kh_not_configured_for_mcp";

process.env.NODE_ENV ??= "production";
process.env.LOG_LEVEL ??= "error";
// Never opened: no MCP tool imports apps/api/src/db.
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/exit_keepa_mcp_never_opened";
// Never verified: no MCP tool imports apps/api/src/routes/webhooks.ts.
process.env.KEEPERHUB_WEBHOOK_SECRET ??= "unused-by-the-mcp-server";
process.env.KEEPERHUB_API_KEY ??= PLACEHOLDER_KEEPERHUB_API_KEY;

/**
 * True only when a real KeeperHub API key was supplied by the operator.
 * `simulate_exit` and `get_execution_status` need one; the other three
 * tools do not, and must keep working without it.
 */
export function hasKeeperHubCredentials(environment: NodeJS.ProcessEnv = process.env): boolean {
  const key = environment.KEEPERHUB_API_KEY;
  return typeof key === "string" && key.length > 0 && key !== PLACEHOLDER_KEEPERHUB_API_KEY;
}

/** Thrown instead of letting a placeholder key reach KeeperHub as a 401. */
export class MissingKeeperHubCredentialsError extends Error {
  readonly code = "keeperhub_credentials_missing";
  constructor(toolName: string) {
    super(
      `${toolName} needs a real KeeperHub API key. Set KEEPERHUB_API_KEY in this MCP server's environment ` +
        `(see packages/mcp/README.md). build_exit_calldata, evaluate_exit_condition and get_live_proof do not need one.`,
    );
    this.name = "MissingKeeperHubCredentialsError";
  }
}

/**
 * ORDERING: ES modules are evaluated in the order their import
 * declarations appear, so `import "./apiEnv.js";` written above any
 * apps/api import is evaluated first, and the assignments above land
 * before apps/api/src/env.ts runs its validation. Keep that import first
 * in every module that reaches into apps/api.
 */
