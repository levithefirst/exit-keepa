// Must come first - see apiEnv.ts.
import "./apiEnv";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EXIT_KEEPA_LIVE_PROOF } from "@exit-keepa/shared";

import {
  buildExitCalldata,
  buildExitCalldataInputShape,
  evaluateExitCondition,
  evaluateExitConditionInputShape,
  getExecutionStatus,
  getExecutionStatusInputShape,
  getLiveProof,
  simulateExit,
  simulateExitInputShape,
} from "./tools";
import { BroadcastNotPermittedError } from "./broadcast";

/**
 * Exit Keepa's MCP server (stdio transport).
 *
 * It exposes the read-and-simulate half of Exit Keepa to any MCP client -
 * Claude Code, or anything else that speaks the protocol. There is no
 * broadcast tool, by design: this is a second *view* onto the execution
 * path, not a second way to move money. See packages/mcp/README.md.
 *
 * Every handler is a thin wrapper over ./tools.ts, which is itself a thin
 * wrapper over the API's own helpers. This file contains no execution
 * logic of its own - only protocol plumbing and error shaping.
 */

const VERSION = "0.1.0";

/** JSON in a text block, plus the same object as structured content. */
function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/**
 * A refusal is a tool result, not a transport error - an agent should be
 * able to read *why* it was refused and act on it. A refusal to broadcast
 * carries its typed fields (code, envFlag, requiredValue) through so the
 * client sees the flag's name, not just prose.
 */
function refusal(err: unknown): CallToolResult {
  if (err instanceof BroadcastNotPermittedError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              code: err.code,
              tool: err.toolName,
              envFlag: err.envFlag,
              requiredValue: err.requiredValue,
              reason: err.reason,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  const error = err as Error & { code?: string };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: error.code ?? "error", message: error.message ?? String(err) }, null, 2),
      },
    ],
  };
}

/** Runs a tool, turning any throw into a readable tool-level error result. */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return refusal(err);
  }
}

export function createExitKeepaMcpServer(): McpServer {
  const server = new McpServer(
    { name: "exit-keepa", version: VERSION },
    {
      instructions:
        "Exit Keepa exposes a permissioned exit path for an Aave v3 Base USDC position held in a Gnosis Safe, " +
        "authorized through a Zodiac Roles Modifier and executed by KeeperHub. These tools are read-and-simulate " +
        "only: none of them can broadcast a transaction, and simulate_exit refuses outright if asked to. " +
        `The project's one real on-chain execution is available from get_live_proof (tx ${EXIT_KEEPA_LIVE_PROOF.txHash}).`,
    },
  );

  server.registerTool(
    "evaluate_exit_condition",
    {
      title: "Evaluate an exit condition",
      description:
        "Decide whether a rate condition on Aave v3 Base holds right now, using the same comparator the autonomous " +
        "agent uses. Pass currentRateBps to compare a number you already have, or omit it to read the live rate " +
        "from Base. Creates nothing and contacts KeeperHub not at all.",
      inputSchema: evaluateExitConditionInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => run(() => evaluateExitCondition(args)),
  );

  server.registerTool(
    "build_exit_calldata",
    {
      title: "Build the exit transaction",
      description:
        "Build the exact execTransactionWithRole/withdraw transaction Exit Keepa would ask KeeperHub to run for a " +
        "Safe, and run the deterministic policy check over it. The target, selector and recipient are derived " +
        "server-side and cannot be supplied by the caller. Sends nothing anywhere.",
      inputSchema: buildExitCalldataInputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run(() => buildExitCalldata(args)),
  );

  server.registerTool(
    "simulate_exit",
    {
      title: "Simulate the exit (never broadcasts)",
      description:
        "Dry-run the exit through KeeperHub with simulate: true, against the real Roles Modifier and the real Aave " +
        "Pool. Never broadcasts: it has no code path that can, and asking it to (broadcast: true) returns a typed " +
        "refusal naming EXIT_KEEPA_ALLOW_BROADCAST. A policy-check failure short-circuits before KeeperHub is " +
        "contacted at all.",
      inputSchema: simulateExitInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => run(() => simulateExit(args)),
  );

  server.registerTool(
    "get_execution_status",
    {
      title: "Read a KeeperHub execution's status",
      description:
        "Read GET /execute/{executionId}/status and interpret it with Exit Keepa's own receipts-are-authoritative " +
        `logic. Defaults to the canonical live-proof execution (${EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId}). ` +
        "Requires a KeeperHub API key.",
      inputSchema: getExecutionStatusInputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => run(() => getExecutionStatus(args)),
  );

  server.registerTool(
    "get_live_proof",
    {
      title: "Exit Keepa's real on-chain execution",
      description:
        "Return the one real, already-landed Exit Keepa execution on Base mainnet - transaction hash, KeeperHub " +
        "execution id, Safe, Roles Modifier, receipt, and how strongly each lifecycle stage is backed. A constant: " +
        "it makes no network call and can never return a newly-generated hash.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => getLiveProof()),
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createExitKeepaMcpServer();
  await server.connect(new StdioServerTransport());
  // stdout is the transport - anything human-readable has to go to stderr
  // or it corrupts the protocol stream.
  process.stderr.write(`exit-keepa MCP server ${VERSION} ready on stdio\n`);
}

// Only auto-start when run as a program, so importing this module in a test
// never opens a transport.
const invokedDirectly =
  typeof process.argv[1] === "string" && /(?:^|[\\/])(?:server\.ts|exit-keepa-mcp\.mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`exit-keepa MCP server failed to start: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
