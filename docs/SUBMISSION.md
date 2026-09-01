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
| Result | Receipt `status: 0x1` (success) — real USDC withdrawn from Aave v3, returned to the Safe |
| Safe | `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9` (Base) |
| Roles Modifier | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` |
| KeeperHub executor (role member) | `0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac` |
| Aave v3 Pool (Base) | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |

Independently verified against the chain itself via
`eth_getTransactionReceipt`, not just read from this app's own database.
(Exit Keepa's own execution-history row for this broadcast briefly showed
`status: failed` due to a hash-extraction bug that was since fixed — the
chain, not the app's database, is the source of truth here.)

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

Key files: `packages/shared/src/protocols/aaveV3Base.ts` (the only place
that encodes `withdraw`), `apps/api/src/execution/buildTransaction.ts`
(the only place a stored strategy becomes a transaction),
`apps/api/src/execution/executor.ts` (the KeeperHub simulate/broadcast
calls), `apps/api/src/agent/policy.ts` (the deterministic policy check —
no LLM, no heuristics, plain boolean/arithmetic comparisons against known
values).

## 9. What still breaks / unfinished (candid)

- **No LLM anywhere in this codebase decides or translates anything.**
  Every check Exit Guardian makes is a hand-written boolean/arithmetic
  comparison (`agent/policy.ts`, `agent/decisionStateMachine.ts`,
  `agent/broadcastGuards.ts`, `execution/evaluateCondition.ts`) against a
  Zod-validated strategy, not a model interpreting natural language.
  Grepping the repo for an AI SDK dependency, prompt, or completion call
  returns nothing.
- **Rate observation is a real Base RPC read**
  (`agent/aaveRateOracle.ts`, `getReserveData` against Aave's live Pool),
  not a demo value typed in — but the strategy's *threshold* is whatever
  the user configures, and the demo path in `docs/JUDGE_DEMO.md`
  deliberately picks a threshold that's certainly already crossed so a
  judge sees a decision immediately, rather than waiting for a real
  market move.
- **The Roles permission is scoped to `withdraw`, but its `asset`/`to`
  parameters are not locked onchain yet.** The live grant: `scopeTarget`
  (Aave Pool clearance is `Function`, not whole-target) plus the
  `withdraw` selector (`0x69328dec`) allowed — no other function on the
  Pool is reachable through this role. But the Roles Modifier itself
  currently accepts *any* `asset`/`amount`/`to` for that `withdraw` call;
  "only USDC, only back to this Safe" is enforced today by Exit Keepa's
  own `agent/policy.ts` (`assetBound`/`recipientBound` checks), not by an
  onchain condition. This is a real, live gap between the app-layer
  guarantee and the chain-layer guarantee. The exact calldata to close it
  — a `scopeFunction` call adding those two parameter conditions — is
  prepared and unsubmitted in [`ROLES_TIGHTENING.md`](ROLES_TIGHTENING.md).
- **A residual `Wildcard` clearance on the Safe address itself** may
  still appear in the Roles config from earlier demo setup. It grants
  nothing on the Aave Pool and is unrelated to the withdraw path above —
  flagged here so a judge inspecting the Roles config directly via
  Gnosis Guild's subgraph isn't misled by it into thinking it's part of
  this permission.
- **Wallet-authenticated ownership is real, tested, and stops at a clear
  boundary — not "no auth."** `POST /api/auth/nonce` issues a one-time
  nonce; the wallet signs a challenge embedding it via `personal_sign`;
  `POST /api/auth/verify` recovers the signer with `viem`'s
  `recoverMessageAddress` (real EIP-191 recovery) and issues a bearer
  session token only on a match. Every route touching a Safe, strategy,
  execution, or agent decision requires that token and checks it against
  a `safe_owners` table (`apps/api/src/auth/`), so a second wallet gets a
  403 on the first wallet's resources. 114 backend tests pass, 11 of
  them dedicated to this flow: real key-pair signing via `viem/accounts`,
  wrong-key/wrong-message rejection, nonce replay protection, nonce and
  session expiry, and an end-to-end cross-wallet 403 proof. **What it
  does not do:** independently verify the recorded owner address against
  that Safe's actual onchain multisig signer set — it proves possession
  of a private key and this app's own DB-level ownership record,
  established at registration time, not a live check of the Safe's real
  signer configuration. That's a separate, harder problem, out of scope
  here. The live demo Safe stays reachable in demo mode via a fixed,
  unreachable-by-signature identity through `/api/auth/demo-session`,
  so "Try demo" needs no wallet while a real connected wallet gets
  genuine exclusive ownership of its own Safes.
- **The autonomous background poller is off by default everywhere**,
  including the live Railway deployment, until `AGENT_POLL_ENABLED=true`
  is set — deliberate, so a fresh deploy never silently starts creating
  real execution rows against live chain state on its own. The on-demand
  "Run Exit Guardian" button runs the identical decision path regardless.
- **Single protocol, single action, by design.** Aave v3 Base USDC
  `withdraw` only — no multi-chain, no other protocol, no chat interface,
  no agent-to-agent negotiation.
- **The `GET /execute/{executionId}/status` polling path is built directly
  from KeeperHub's own published API reference, not yet live-exercised
  against a real polled execution** — the one confirmed real broadcast to
  date (§6) settled synchronously with a verifiable hash on its initial
  response, before this session's Idempotency-Key/status-polling work
  existed. `apps/api/src/keeperhub/client.ts`'s `getDirectExecutionStatus`
  and the receipts-are-authoritative decision logic
  (`apps/api/src/execution/statusOutcome.ts`) are covered by unit and
  integration tests built from the documented response shape, and the
  existing synchronous-hash path (unaffected when KeeperHub never returns
  an `executionId` to poll) is unchanged and still covered by the
  original live-captured-response regression test. Treat the next real
  broadcast as the live check on the polling path specifically.
- **Aave oracle/aUSDC-balance reads are verified by static analysis**
  (a real local Keccak-256 computation for the `getReserveData` selector,
  Aave's own source for the `ReserveDataLegacy` field layout and the
  aUSDC address) but this sandbox's egress proxy blocks a live `eth_call`
  from this environment to independently confirm the exact runtime
  values — treat first production use as the final cross-check.

## 10. How to verify in 60 seconds

1. Open **https://exit-keepa-web.vercel.app** — you should see the
   headline, the **"Live proof"** panel with a BaseScan link, and a
   "How it works" section, within the first screen.
2. Click **"Verify on BaseScan →"** in the Live proof panel (or open the
   tx hash in section 6 directly).
3. On BaseScan, confirm: **Status: Success**, **chain: Base**, the `to`
   address is the Safe calling itself via `execTransactionWithRole`, and
   the internal transactions decode to a call into the Aave v3 Pool's
   `withdraw` function.
4. Back on the site, click **"Try the demo, no wallet needed"** →
   **Dashboard** → **"Fill in the live demo Safe"** → open the strategy
   that already completed the broadcast above → **"Run Exit Guardian"**
   to watch the identical simulate step run again live, against the same
   real Roles Modifier and Aave Pool, without re-broadcasting.

See [`JUDGE_DEMO.md`](JUDGE_DEMO.md) for the full click-by-click version
(under 5 minutes), including a deliberate refusal case.

## 11. Contact

Repo owner: `josephmorounfoluwa@gmail.com` (GitHub: `levithefirst`).
Issues: https://github.com/levithefirst/exit-keepa/issues

## 12. Demo video

Shot list and 90–120s voiceover script for a human to record:
[`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md).

---

## Appendix: what was already on the branch when this session started

`agent-economy-first-place` (an earlier, unmerged branch) had already
built real Aave rate-decoding logic, independently re-verified and reused
here. It was not merged as-is: it deleted the only UI path that ever
created an execution row and replaced it with an endpoint that returned a
decision without ever persisting one (an approved decision was a dead
end — no way to reach simulation or broadcast), had no polling loop, no
edge-trigger state, and no persisted refusal status. This submission's
implementation supersedes it.
