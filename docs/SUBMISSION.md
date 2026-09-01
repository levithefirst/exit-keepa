# Exit Keepa — Hackathon Submission

Submitted to KeeperHub's **Agent Economy** hackathon
([dorahacks.io/hackathon/agent-economy](https://dorahacks.io/hackathon/agent-economy/detail)).
The track is best integration of KeeperHub into a live project, with real
value moved through KeeperHub and proof of it — this document is written
against that bar, not against "best standalone agent demo."

## 1. Pitch

Aave v3 and Gnosis Safe are systems people already trust with real money.
Exit Keepa doesn't replace either of them — it gives a Safe owner a way
to say, once, "if my Aave supply rate crosses this line, get my position
out," and then makes that promise self-enforcing without ever taking
their keys. KeeperHub is the piece that turns that promise into an
actual onchain call: it's the deterministic execution layer that takes
the exact transaction Exit Keepa built, simulates it against the real
Roles Modifier and the real Aave Pool, and only then broadcasts it. Zodiac
Roles is the piece that makes it safe to hand KeeperHub that power at
all — a Roles Modifier scoped to one function on one contract, so the
executor physically cannot do anything except the one thing it was
authorized to do. None of this is a pitch on paper: a real Aave v3 USDC
withdraw has already gone end-to-end through this exact
Safe → Roles Modifier → KeeperHub path on Base mainnet. See section 6.

## 2. Live project(s) integrated

- **Aave v3 (Base)** — the actual lending market being protected. Exit
  Keepa reads its live supply/borrow rate via `getReserveData` and
  builds a real `withdraw(address asset, uint256 amount, address to)`
  call against its Pool contract
  (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`).
- **Gnosis Safe** — the account that actually holds the user's funds
  and Aave position throughout. Exit Keepa never takes custody; every
  execution is a call made *by* the Safe, not *to* it.
- **Zodiac Roles Modifier** — installed on the Safe, this is what lets
  the Safe pre-authorize a narrow, revocable slice of its own power to
  KeeperHub's executor address, instead of handing over a private key.

**What a user gets:** a standing protective order on a DeFi position they
already hold, enforced onchain, that they can inspect (exact calldata,
before anything runs), simulate (against real chain state, before
anything runs), and revoke at any time by editing the Roles permission —
all without ever moving their funds out of the Safe they already trust.

## 3. What KeeperHub does in the path

KeeperHub is the only thing in this system that ever sends a transaction.
For every strategy check that passes Exit Keepa's own policy gate
(`agent/policy.ts`), the flow is KeeperHub's own documented **Safe
First-Write Sequence**
([docs.keeperhub.com/api/direct-execution](https://docs.keeperhub.com/api/direct-execution#safe-first-write-sequence)),
implemented end-to-end rather than partially:

1. **Simulate** — Exit Keepa calls KeeperHub's contract-call execution
   endpoint with `execTransactionWithRole` and `simulate: true`, against
   the real Roles Modifier, the real Aave Pool, and the real Safe. This
   is a genuine dry run against live chain state, not a local guess —
   KeeperHub returns either a clean result (`success: true,
   wouldRevert: false`) or the exact revert reason. Broadcast only ever
   proceeds past this gate.
2. **Execute, with an Idempotency-Key** — once simulation comes back
   clean, the *identical* request body is re-sent with `simulate`
   removed and an `Idempotency-Key` header attached. The key is the
   execution row's own stable id (`keeperhub_executions.idempotency_key`,
   set once at creation, never regenerated per HTTP attempt), so a
   retried request replays KeeperHub's original outcome instead of
   double-broadcasting. `idempotency_in_progress` (409) is retried
   automatically with the same key, per KeeperHub's own guidance;
   `idempotency_conflict` (409) is treated as a fail-closed bug signal
   and never worked around by rotating to a fresh key.
3. **Persist the executionId, then poll for the receipt** — KeeperHub's
   own `executionId` (e.g. `direct_123`) is saved on the row as soon as
   it's known, and `GET /api/execute/{executionId}/status` is polled
   with backoff (honoring the `X-Poll-Interval-Hint` response header,
   bounded to a budget so the request can't hang forever) until the
   execution reaches a terminal state. A separate `refresh-status`
   endpoint lets the UI keep checking if the inline poll's budget runs
   out before that happens.
4. **Receipts are authoritative, never the self-reported fields** — the
   status response's `receipts[]` (each independently re-fetched from
   the chain by KeeperHub, not self-reported by the write path) decide
   success or failure. A `transactionHash` alone is never enough; Exit
   Keepa only records `succeeded` once a receipt is `verified: true` and
   `receiptStatus: "success"`, and only ever stores a hash that also
   passes its own hex-format validation — never fabricated, never
   inferred.

**On sponsorship:** KeeperHub's own status response for the canonical
proof execution (§6) reports `sponsored: true` - the broadcast was
gas-sponsored/relayed through KeeperHub's own on-chain contract rather
than a plain EOA-to-Roles-Modifier call. This is documented KeeperHub
behavior (its docs' "Sponsored Executions" section: a sponsored write
"will not appear in a block explorer's txlist" for the org's own EOA),
not a workaround this project built - it's why the transaction's
top-level `from`/`to` on BaseScan differ from the Roles Modifier/Safe
that actually process the call underneath. See §6 for the literal trace.

## 4. Surfaces used

**REST Direct Execution, end-to-end simulate → broadcast → status:**

- `POST /execute/contract-call` (`apps/api/src/keeperhub/client.ts`'s
  `callContractFunction`) — simulate-first then broadcast, with explicit
  handling of KeeperHub's distinct HTTP-400 shapes (pre-flight validation
  error vs. `wouldRevert` simulation result vs. the ethers.js
  fragment-mismatch execution error).
- **`Idempotency-Key`** header on every broadcast, sourced from the
  execution's own stable id — see §3. Handles `idempotentReplay`,
  `409 idempotency_conflict`, and `409 idempotency_in_progress` as
  distinct, typed outcomes (`KeeperHubIdempotencyConflictError` /
  `KeeperHubIdempotencyInProgressError` in `client.ts`), not generic
  errors.
- **`GET /execute/{executionId}/status`** (`getDirectExecutionStatus`) —
  polled with backoff honoring `X-Poll-Interval-Hint`; its `receipts[]`
  are the authoritative source for success/failure, per §3.
- `GET /chains` (`listChains`) — live-verified, used to confirm Base is
  enabled.
- **(Documented, not implemented in this app) MCP tools that mirror the
  same operations for agents** — KeeperHub's hosted MCP server exposes
  `execute_contract_call`, `execute_check_and_execute`, and
  `get_direct_execution_status` as the agent-facing equivalents of the
  three REST calls above, with the identical simulate-first /
  Idempotency-Key / poll-until-terminal contract
  ([docs.keeperhub.com/ai-tools/mcp-server](https://docs.keeperhub.com/ai-tools/mcp-server#direct-on-chain-execution)).
  Exit Keepa's backend calls the REST endpoints directly rather than
  running an MCP client — noted here only because it's the same
  underlying execution surface, not because this app runs an MCP server
  or client anywhere. No MCP code exists in this repo.

**Evaluated and deliberately not used — `check-and-execute`:** KeeperHub's
`POST /execute/check-and-execute` can conditionally run a write whose
action is itself an arbitrary contract call, which *would* stay
Roles-bound (the action leg would still be `execTransactionWithRole` on
the Roles Modifier, not a different signer). It wasn't wired in because
KeeperHub requires its condition check to "resolve to exactly one
supported scalar output" — but Exit Keepa's real trigger condition (Aave
v3's supply APR) only exists as one field of Aave Pool's
`getReserveData(address)`, which returns a 15-field struct
(`ReserveDataLegacy`) with no single-scalar getter for just
`currentLiquidityRate`. That's exactly the "compound... unsupported ABI
return shape" the docs say `check-and-execute` rejects with HTTP 400
before ever reaching the RPC call. Forcing it in would mean either
computing the condition off-chain and faking a trivial always-true
on-chain check (pointless — KeeperHub wouldn't actually be gating
anything) or picking a different, less accurate condition just to fit
the primitive. Simulate-then-broadcast (§3) already gives the same
before-you-broadcast safety without that compromise, so this was skipped
rather than forced — see `docs/keeperhub-integration.md` for the full
reasoning.

**Not used at all, stated plainly:** x402 and MPP are documented in
KeeperHub's own materials but have zero code paths in this repo — no
handshake, no payment logic. The generic workflow endpoints (`POST
/workflows`, `.../execute`) are wrapped in the client but never called by
the execution path; the Safe-specific KeeperHub surfaces (pending-tx
monitoring, signature tracking) are left unimplemented rather than
guessed at — see the doc comments in `apps/api/src/keeperhub/client.ts`
and `docs/keeperhub-integration.md` for the full verification trail of
what was and wasn't confirmed live.

## 5. Mainnet vs. testnet

**Base mainnet.** Not a testnet, not a fork. `BASE_CHAIN_ID`/`BASE_RPC_URL`
default to Base mainnet (`apps/api/src/env.ts`), and every address above
is a real Base mainnet contract, cross-checked against
`bgd-labs/aave-address-book` (Aave) and this project's own onchain
verification history for the Safe/Roles Modifier.

## 6. Tx proof

| | |
|---|---|
| Tx hash | `0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b` |
| BaseScan | https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b |
| **KeeperHub execution ID** | **`u9zr4vzbfurjvzgwz687g`** — see "Two independent confirmations" below |
| Result | Receipt `status: 0x1` (success) — real USDC withdrawn from Aave v3, returned to the Safe |
| Safe | `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9` (Base) |
| Roles Modifier | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` |
| KeeperHub executor (role member) | `0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac` |
| Aave v3 Pool (Base) | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |

### What the transaction literally looks like on BaseScan

**Read this before "verifying" it yourself** — the top-level call is
**not** the Safe calling `execTransactionWithRole` on itself. It's a
gas-sponsored execution, and BaseScan's top frame shows the sponsor/relay
step, not the Roles/Safe step. Both are real; they're just two different
layers of the same transaction. Independently re-derived twice this
session (never assumed): once via raw `eth_getTransactionByHash` /
`eth_getTransactionReceipt` against Base RPC, and once by re-querying
KeeperHub's own `GET /execute/{executionId}/status` for this exact
execution — both agree, byte for byte.

**Top-level call (what BaseScan shows first):**

| | |
|---|---|
| `from` | `0x803f5380b968b23f6a1cad58e4b4178f9c7c6734` — an unlabeled EOA (KeeperHub's own relayer, not the Safe, not the executor identity) |
| `to` | `0x5af5194b4b0909eb978e3cf1e25333852277f07d` — KeeperHub's sponsor/relay execution contract, not the Roles Modifier and not the Safe |
| function | `execute(address,address,uint256,bytes)` (selector `0x9aefaff8`) |
| decoded args | `(0xc68f0E22...968Ac` [the executor/role-member identity]`, 0x694C3F61...4dBbBE` [the Roles Modifier], `0`, `<441-byte payload>)` |

**What that payload actually contains, once decoded** (this is the part
that only shows up in BaseScan's internal calls / input-data decode, not
the top line):

```
execTransactionWithRole(
  to:            0xA238Dd80C259a72e81d7e4664a9801593F98d1c5   (Aave v3 Pool)
  value:         0
  data:          withdraw(0x833589fC...02913 [USDC], type(uint256).max, 0xfFd5c5e1...cd66a9 [the Safe])
  operation:     0 (Call)
  roleKey:       "exit_keepa"
  shouldRevert:  true
)
```

**Internal effects (receipt logs, in order):** a Safe module-execution
event, Aave's `ReserveDataUpdated`, the aUSDC token's burn + `Transfer`,
a real USDC `Transfer` from the Aave aToken contract to the Safe, Aave's
`ReserveUsedAsCollateralDisabled` (expected — the position was fully
withdrawn), Aave's own `Withdraw` event, and — the one that matters most
here — the Safe itself emitting `ExecutionFromModuleSuccess(module: <the
Roles Modifier>)`. That last event is the Safe's own on-chain
confirmation that it executed this **as a module call from the Roles
Modifier**, i.e. exactly the Zodiac Roles permission path this project
claims, even though the Safe never appears as the transaction's top-level
`from` or `to`.

### Two independent confirmations, not one

1. **On-chain, self-verified:** the receipt trace above, read directly
   from Base RPC (`eth_getTransactionReceipt`), decoded with `viem` — not
   trusted from BaseScan's UI labels, which this session's sandbox
   couldn't reach directly.
2. **KeeperHub's own execution record:** `GET /execute/u9zr4vzbfurjvzgwz687g/status`
   against KeeperHub's real API returns `status: "completed"`,
   `receipts: [{ verified: true, receiptStatus: "success", blockNumber:
   50697644 }]`, `sponsored: true`, and an `executedCall` block that
   names the exact same `topLevelTo` (`0x5af5194b...`), the same
   `functionName` (`execTransactionWithRole`), and the same target
   contract (the Roles Modifier) independently derived above. This is
   KeeperHub's own infrastructure stating, in its own words, that it
   sponsored/relayed this specific execution and that the semantic
   operation was `execTransactionWithRole` against the Roles Modifier -
   not this project's interpretation of a raw trace.

**What a judge can and can't do with the execution ID themselves:**
`u9zr4vzbfurjvzgwz687g` is real and independently re-confirmed as of this
submission (not just quoted from an old test comment), but KeeperHub does
not expose a public, unauthenticated page for a single execution — the
status endpoint above requires the org's own API key, and there's no
shareable dashboard link in KeeperHub's documented surface. A judge can't
paste that ID into a URL and see it themselves the way they can with the
BaseScan hash. What they *can* do: ask to see the raw API response above
reproduced live (it's one `GET` call), or read
`apps/api/src/keeperhub/client.ts`'s `getDirectExecutionStatus` and
`apps/api/src/scripts/verify-keeperhub.ts`'s `kh-execution-status-probe`
mode, which is the exact call that produced the JSON quoted above.

## 7. Live URLs

- **Frontend:** https://exit-keepa-web.vercel.app
- **API:** https://api-production-2e11.up.railway.app (health check: `/health`)
- **Source:** https://github.com/levithefirst/exit-keepa (default branch: `claude/exit-keepa-init-v5lzuy`)

## 8. Architecture

```
User (Safe owner)
   │  defines: rate condition + withdraw action
   ▼
Exit Keepa web (Next.js) ── strategy CRUD, preview, activate, run/simulate/broadcast
   │
   ▼
Exit Keepa API (Express + Postgres)
   │  condition ──▶ strategy ──▶ buildExitTransaction()   (server-side only;
   │                                                        never trusts a
   │                                                        target/calldata
   │                                                        from the client)
   │  Exit Guardian: read live Aave rate ─▶ evaluate condition ─▶
   │                 deterministic policy check (chain/target/selector/
   │                 asset/recipient/Roles-configured, agent/policy.ts)
   ▼
KeeperHub  ── simulate (execTransactionWithRole, simulate:true) ──▶ clean / revert reason
           ── broadcast (execTransactionWithRole, simulate:false,
                          Idempotency-Key: <execution id>) ──▶ executionId + tx hash
           ── poll GET /execute/{executionId}/status (backoff,
                X-Poll-Interval-Hint) ──▶ receipts[] (authoritative)
   ▼
Zodiac Roles Modifier  ── permission check: is this role allowed to call
                           this target + this selector, with these args?
   ▼
Safe  ── executes the call as itself
   ▼
Aave v3 Pool.withdraw(asset, amount, to)  ──▶ USDC lands back in the Safe
```

This is the logical/API-level flow - what Exit Keepa asks KeeperHub to
do. On-chain, KeeperHub broadcast the canonical proof (§6) through its
own gas-sponsored relay contract rather than a direct call, so the
literal top-level transaction on BaseScan differs from this diagram even
though the semantic operation - `execTransactionWithRole` against this
exact Roles Modifier - matches exactly. See §6 for the literal trace.

Key files: `packages/shared/src/protocols/aaveV3Base.ts` (the only place
that encodes `withdraw`), `apps/api/src/execution/buildTransaction.ts`
(the only place a stored strategy becomes a transaction),
`apps/api/src/execution/executor.ts` (the KeeperHub simulate/broadcast
calls), `apps/api/src/agent/policy.ts` (the deterministic policy check —
no LLM, no heuristics, plain boolean/arithmetic comparisons against known
values).

## 9. Built for real, not just demoed

- **No LLM anywhere in this codebase decides or translates anything.**
  Every check Exit Guardian makes is a hand-written boolean/arithmetic
  comparison (`agent/policy.ts`, `agent/decisionStateMachine.ts`,
  `agent/broadcastGuards.ts`, `execution/evaluateCondition.ts`) against a
  Zod-validated strategy — fully deterministic, fully auditable, no
  prompt or completion call anywhere in the repo.
- **Rate observation is a real Base RPC read**
  (`agent/aaveRateOracle.ts`, `getReserveData` against Aave's live Pool),
  not a value typed in for a demo.
- **Wallet-authenticated ownership is real and tested.**
  `POST /api/auth/nonce` issues a one-time nonce; the wallet signs a
  challenge via `personal_sign`; `POST /api/auth/verify` recovers the
  signer with `viem`'s `recoverMessageAddress` (real EIP-191 recovery)
  and issues a bearer session token only on a match. Every route
  touching a Safe, strategy, execution, or agent decision requires that
  token and checks it against a `safe_owners` table
  (`apps/api/src/auth/`), so a caller can only ever act on Safes they
  registered themselves. 167 tests pass (158 in `apps/api`, 9 in
  `packages/shared`), including a dedicated end-to-end cross-wallet
  ownership proof. The live demo Safe stays reachable in demo mode with
  no wallet needed via `/api/auth/demo-session`.
- **Roles permission is genuinely scoped, not a rubber stamp.** The live
  grant on the demo Safe is `scopeTarget` (function-level, not
  whole-target) plus a single-selector allow for `withdraw` — no other
  function or contract on Base is reachable through this role. Further
  tightening the grant to lock `asset`/`to` at the on-chain layer itself
  is prepared and ready to submit in
  [`ROLES_TIGHTENING.md`](ROLES_TIGHTENING.md).

## 10. How to verify in 60 seconds

1. Open **https://exit-keepa-web.vercel.app** — you should see the
   headline, the **"Live proof"** panel with a BaseScan link, and a
   "How it works" section, within the first screen.
2. Click **"Verify on BaseScan →"** in the Live proof panel (or open the
   tx hash in section 6 directly).
3. On BaseScan, confirm: **Status: Success**, **chain: Base**. The
   top-level `to` is KeeperHub's own sponsor/relay contract (this was a
   gas-sponsored execution - see §6 for exactly why), **not** the Safe -
   don't expect to see the Safe as the top-level caller. What to look for
   instead: the decoded input data resolves to `execTransactionWithRole`
   against the Roles Modifier (`0x694C3F61...4dBbBE`), and the internal
   transactions/logs show the Aave v3 Pool's `withdraw` function and the
   Safe's own `ExecutionFromModuleSuccess` event. §6 has the full literal
   breakdown, field by field.
4. Back on the site, click **"Try the demo, no wallet needed"** →
   **Dashboard** (the live-proof Safe loads automatically) → open the
   strategy that already completed the broadcast above → **"Run Exit
   Guardian"** to watch the identical simulate step run again live,
   against the same real Roles Modifier and Aave Pool, without
   re-broadcasting.

See [`JUDGE_DEMO.md`](JUDGE_DEMO.md) for the full click-by-click version
(under 5 minutes), including a deliberate refusal case.

## 11. Contact

Repo owner: `josephmorounfoluwa@gmail.com` (GitHub: `levithefirst`).
Issues: https://github.com/levithefirst/exit-keepa/issues

## 12. Demo video

Shot list and 90–120s voiceover script for a human to record:
[`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md).

