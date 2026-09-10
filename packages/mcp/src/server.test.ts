import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Protocol-level tests: a real MCP client talks to the real server over a
 * linked in-memory transport pair. This is the same handshake Claude Code
 * performs over stdio, so "the tools are registered and callable" is
 * checked rather than assumed from the registration code reading correctly.
 *
 * KeeperHub is mocked at the client module so nothing leaves the process;
 * the tools that need it are exercised in tools.test.ts.
 */
vi.mock("../../../apps/api/src/keeperhub/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../apps/api/src/keeperhub/client")>();
  return {
    ...actual,
    keeperHubClient: { callContractFunction: vi.fn(), getDirectExecutionStatus: vi.fn() },
  };
});

const { createExitKeepaMcpServer } = await import("./server");
const { EXIT_KEEPA_LIVE_PROOF, BROADCAST_ENV_FLAG } = await import("@exit-keepa/shared");

async function connectedClient(): Promise<Client> {
  const server = createExitKeepaMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "exit-keepa-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** The single JSON payload a tool result carries. */
function payload(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0].text);
}

describe("exit-keepa MCP server", () => {
  it("advertises exactly the five documented tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "build_exit_calldata",
      "evaluate_exit_condition",
      "get_execution_status",
      "get_live_proof",
      "simulate_exit",
    ]);
  });

  it("advertises no tool that can broadcast", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.name).not.toMatch(/broadcast|execute_contract|send/);
      // Nothing here is allowed to describe itself as state-changing,
      // because nothing here is.
      expect(tool.annotations?.destructiveHint ?? false).toBe(false);
    }
  });

  it("returns the canonical live proof over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "get_live_proof", arguments: {} });

    expect(payload(result).proof.txHash).toBe(EXIT_KEEPA_LIVE_PROOF.txHash);
    expect(payload(result).proof.keeperhubExecutionId).toBe(EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId);
  });

  it("builds calldata over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "build_exit_calldata",
      arguments: {
        safeAddress: EXIT_KEEPA_LIVE_PROOF.safeAddress,
        rolesModifierAddress: EXIT_KEEPA_LIVE_PROOF.rolesModifierAddress,
      },
    });

    const body = payload(result);
    expect(body.policyPassed).toBe(true);
    expect(body.transaction.to).toBe(EXIT_KEEPA_LIVE_PROOF.aaveV3PoolAddress);
  });

  it("returns a broadcast refusal as a readable tool error naming the env flag", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "simulate_exit",
      arguments: {
        safeAddress: EXIT_KEEPA_LIVE_PROOF.safeAddress,
        rolesModifierAddress: EXIT_KEEPA_LIVE_PROOF.rolesModifierAddress,
        broadcast: true,
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    const body = payload(result);
    expect(body.code).toBe("broadcast_not_permitted");
    expect(body.envFlag).toBe(BROADCAST_ENV_FLAG);
    expect(body.requiredValue).toBe("1");
  });
});
