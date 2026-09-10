import { BROADCAST_ENV_FLAG, BROADCAST_ENV_ENABLED_VALUE, isBroadcastAllowed } from "@exit-keepa/shared";

export { BROADCAST_ENV_FLAG, BROADCAST_ENV_ENABLED_VALUE, isBroadcastAllowed };

/**
 * Thrown whenever an MCP caller asks this server to broadcast.
 *
 * Typed rather than a bare Error so a client can branch on `code` and
 * `envFlag` instead of matching on message text - the flag's name travels
 * with the error, which is the whole point: the refusal has to tell you
 * exactly what would have to change, and where.
 */
export class BroadcastNotPermittedError extends Error {
  readonly code = "broadcast_not_permitted";
  readonly envFlag = BROADCAST_ENV_FLAG;
  readonly requiredValue = BROADCAST_ENV_ENABLED_VALUE;

  constructor(
    /** The tool that was asked to broadcast. */
    readonly toolName: string,
    /** Why it refused - the specific reason, not a generic denial. */
    readonly reason: string,
  ) {
    super(`${toolName} refused to broadcast: ${reason}`);
    this.name = "BroadcastNotPermittedError";
  }
}

/**
 * Refuses a broadcast request. Always throws - there are two different
 * reasons and both are real, so both are reported precisely:
 *
 * 1. `EXIT_KEEPA_ALLOW_BROADCAST` is not exactly `"1"`. This is the default
 *    and the expected case: the flag is unset, so no broadcast code path
 *    anywhere may run.
 * 2. The flag *is* `"1"` - and this server still refuses, because it has no
 *    broadcast implementation to run. Exit Keepa has exactly one path that
 *    can send a transaction (apps/api/src/execution/executeApproved.ts, the
 *    one that produced the live proof) and this MCP surface is deliberately
 *    not a second one. Setting the flag does not create one.
 *
 * Both messages name the flag, so a caller that hits either knows what it
 * is looking at.
 */
export function refuseBroadcast(toolName: string, environment: NodeJS.ProcessEnv = process.env): never {
  if (!isBroadcastAllowed(environment)) {
    throw new BroadcastNotPermittedError(
      toolName,
      `${BROADCAST_ENV_FLAG} is not set to "${BROADCAST_ENV_ENABLED_VALUE}" (it is ` +
        `${environment[BROADCAST_ENV_FLAG] === undefined ? "unset" : JSON.stringify(environment[BROADCAST_ENV_FLAG])}), ` +
        `so no broadcast code path may run. This tool simulates only.`,
    );
  }

  throw new BroadcastNotPermittedError(
    toolName,
    `${BROADCAST_ENV_FLAG} is "${BROADCAST_ENV_ENABLED_VALUE}", but this MCP server has no broadcast ` +
      `implementation at all - it is a read-and-simulate surface by design. Exit Keepa's only broadcast path ` +
      `is the API's own execution/executeApproved.ts. Setting ${BROADCAST_ENV_FLAG} does not add a second one.`,
  );
}
