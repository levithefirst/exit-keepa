# `@exit-keepa/mcp`

An MCP server that exposes Exit Keepa's exit path to any MCP client -
Claude Code, or anything else that speaks the protocol.

**It cannot broadcast a transaction.** There is no broadcast tool, and
`simulate_exit` refuses outright if asked to (see
[Broadcasting](#broadcasting) below). This is a second *view* onto the
execution path, not a second way to move money.

## Tools

| Tool | What it does | Network |
|---|---|---|
| `evaluate_exit_condition` | Decides whether a rate condition holds, using the same comparator the autonomous agent uses (`execution/evaluateCondition.ts`). Pass `currentRateBps` to compare a number you already have, or omit it to read the live Aave v3 Base rate. | Base RPC, only when `currentRateBps` is omitted |
| `build_exit_calldata` | Builds the exact `execTransactionWithRole` → `withdraw` transaction Exit Keepa would ask KeeperHub to run, via `execution/buildTransaction.ts`, and runs `agent/policy.ts` over it. | none |
| `simulate_exit` | Dry-runs that transaction through KeeperHub with `simulate: true`, against the real Roles Modifier and the real Aave Pool. Never broadcasts. | KeeperHub |
| `get_execution_status` | Reads `GET /execute/{executionId}/status` and interprets it with the API's own receipts-are-authoritative logic. Defaults to the canonical live-proof execution `u9zr4vzbfurjvzgwz687g`. | KeeperHub |
| `get_live_proof` | Returns Exit Keepa's one real, already-landed execution on Base mainnet - transaction hash, KeeperHub execution id, Safe, Roles Modifier, receipt, and how strongly each lifecycle stage is backed. | none |

Every one of these is a thin adapter over code the API already runs.
Nothing in this package re-encodes calldata, re-implements a policy rule,
or opens its own path to the chain - it imports
`buildExitTransaction`, `checkPolicy`, `evaluateRateCondition`,
`simulateExitTransaction`, `deriveExecutionOutcomeFromStatus` and the
KeeperHub client straight from `apps/api/src`. An agent driving Exit Keepa
through MCP therefore gets the identical decisions the product makes, not
a parallel approximation of them. That is also why this package imports
API source directly rather than a published build: a copy would be free to
drift, and a stale `dist/` would be worse than either.

## Running it

Requires Node 20+ and `npm install` at the repo root. No build step - the
launcher registers `tsx` and runs the TypeScript directly.

```bash
npm run start --workspace packages/mcp     # or: node packages/mcp/bin/exit-keepa-mcp.mjs
```

It speaks MCP over stdio, so on its own it just waits. Point a client at
it.

### Claude Code

Add it to your MCP config (`.mcp.json` in a project, or
`~/.claude.json`), using an absolute path to this repo:

```json
{
  "mcpServers": {
    "exit-keepa": {
      "command": "node",
      "args": ["/absolute/path/to/exit-keepa/packages/mcp/bin/exit-keepa-mcp.mjs"],
      "env": {
        "KEEPERHUB_API_KEY": "kh_...",
        "BASE_RPC_URL": "https://base-mainnet.g.alchemy.com/v2/<your key>"
      }
    }
  }
}
```

Or from the CLI:

```bash
claude mcp add exit-keepa --env KEEPERHUB_API_KEY=kh_... \
  -- node /absolute/path/to/exit-keepa/packages/mcp/bin/exit-keepa-mcp.mjs
```

### Any other MCP client

Same thing: spawn `node packages/mcp/bin/exit-keepa-mcp.mjs` and talk MCP
over its stdin/stdout. Nothing else is written to stdout - the startup
line goes to stderr precisely so it can't corrupt the protocol stream.

Try it without a client at all:

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_live_proof","arguments":{}}}' \
  | node packages/mcp/bin/exit-keepa-mcp.mjs
```

## Environment

| Variable | Needed by | Notes |
|---|---|---|
| `KEEPERHUB_API_KEY` | `simulate_exit`, `get_execution_status` | Without it those two return a clear `keeperhub_credentials_missing` error. The other three tools work fine without one. |
| `KEEPERHUB_API_BASE_URL` | optional | Defaults to `https://app.keeperhub.com/api`. |
| `BASE_RPC_URL` | `evaluate_exit_condition` with a live read | Defaults to the public Base endpoint, which rate-limits. Use a key-authenticated provider for anything more than a few calls. |
| `EXIT_KEEPA_ALLOW_BROADCAST` | nothing here | See below. Leave it unset. |

`DATABASE_URL` and `KEEPERHUB_WEBHOOK_SECRET` are **not** required. The API
validates its whole configuration at import time and this server borrows
the API's modules, so `src/apiEnv.ts` fills those two in with obvious
placeholders - it opens no database and serves no webhook, so demanding a
Postgres URL to run a read-only tool server would be pure ceremony. A real
value always wins if you set one.

## Broadcasting

`EXIT_KEEPA_ALLOW_BROADCAST` defaults to unset, and no broadcast code path
in this repository runs unless it is exactly the string `"1"` - not
`"true"`, not `"yes"`, not `"1 "`.

For this MCP server specifically the answer is stronger than "gated": it
has no broadcast implementation at all. Asking `simulate_exit` to
broadcast throws a typed `BroadcastNotPermittedError`, which the protocol
surfaces as a tool error carrying the flag's name:

```json
{
  "code": "broadcast_not_permitted",
  "tool": "simulate_exit",
  "envFlag": "EXIT_KEEPA_ALLOW_BROADCAST",
  "requiredValue": "1",
  "reason": "EXIT_KEEPA_ALLOW_BROADCAST is not set to \"1\" (it is unset), so no broadcast code path may run. This tool simulates only."
}
```

Setting the flag to `"1"` changes the *reason* and not the outcome: the
refusal then says there is no broadcast implementation here to enable.
Exit Keepa has exactly one path that can send a transaction -
`apps/api/src/execution/executeApproved.ts`, the one that produced the
[live proof](../../docs/SUBMISSION.md#6-tx-proof) - and this surface is
deliberately not a second one.

`simulate_exit` also refuses to contact KeeperHub at all for a transaction
the policy check rejects, and asserts the outgoing request carries
`simulate: true` before returning. Both are covered by tests
(`src/tools.test.ts`), including one that inspects every `simulate` value
the KeeperHub client was ever handed and asserts `false` is not among
them.

## Tests

```bash
npm run test --workspace packages/mcp
```

`src/tools.test.ts` mocks only the KeeperHub client, so the real
`buildExitTransaction`, the real policy check and the real executor run -
which is what makes the "never sends `simulate: false`" assertion mean
something. `src/server.test.ts` connects a real MCP client to the real
server over a linked in-memory transport and checks the tool list, the
refusal shape, and a couple of round trips.
