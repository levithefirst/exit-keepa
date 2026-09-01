# Exit Keepa

Exit Keepa integrates **KeeperHub** as the deterministic execution layer
for protective exits of **Aave v3** positions held in user-owned
**Gnosis Safes**, constrained by **Zodiac Roles**. Aave and Safe are the
live systems users already use; Exit Keepa + KeeperHub are how a
rate-based exit condition becomes a simulated-then-broadcast withdraw
that lands onchain without ever giving the agent the user's keys.

> "If the monitored rate crosses my threshold, withdraw my position back
> to my Safe."

**Built for KeeperHub's Agent Economy hackathon**
([dorahacks.io/hackathon/agent-economy](https://dorahacks.io/hackathon/agent-economy/detail)).
See [`docs/SUBMISSION.md`](docs/SUBMISSION.md) for the full submission.

**Live demo:** [`https://exit-keepa-web.vercel.app`](https://exit-keepa-web.vercel.app) —
the full app, live. API: `https://api-production-2e11.up.railway.app`.
Click **"Try demo"** in the nav bar to explore the full flow against the
live-proof Safe, without a wallet extension. See
[`docs/JUDGE_DEMO.md`](docs/JUDGE_DEMO.md) for an exact, timed
click-through.

**Hackathon judges:** see [`docs/SUBMISSION.md`](docs/SUBMISSION.md) for
the pitch, live evidence (on-chain Roles config + a real simulation
response, re-verified against production right before submission), and
the exact judge path.

## What it actually does (v1 scope)

Exit Keepa v1 supports exactly **one** protocol and **one** action,
deliberately, rather than a generic "call any protocol" system:

- **Protocol:** Aave v3 on Base
- **Action:** `withdraw(asset, amount, to)` on Aave's Pool contract —
  withdraws a USDC supply position back to your Safe
- **Trigger:** a rate condition (`supply_apr`/`borrow_apr`/`utilization`
  vs. a basis-point threshold) you define per strategy

Every address and function selector below was independently verified,
not guessed:

| | |
|---|---|
| Aave v3 Pool (Base) | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` — cross-checked against `bgd-labs/aave-address-book`'s `AaveV3Base.sol`, the canonical address list Aave Labs itself maintains |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Function | `withdraw(address asset, uint256 amount, address to)` |
| Selector | `0x69328dec` — computed locally via keccak256, not recalled |

This requires the Safe to already hold a USDC supply position on Aave v3
Base (i.e. you've separately called `supply()` there). No `approve` step
is needed for the exit itself — an aToken burn is internal to the Pool
contract.

## How execution is authorized (Safe + Zodiac Roles)

```
Safe  →  Zodiac Roles Modifier  →  execTransactionWithRole  →  Safe executes
```

This path was independently verified earlier in this project: a real,
harmless self-call transaction was broadcast and confirmed on Base
(`0xf2122ab591a73f81c1d1290f4830d5576866e0a5e817d9687450f2b11481278c`).

KeeperHub is the executor, but it can only ever call
`execTransactionWithRole` on your Roles Modifier — and the Roles Modifier
only permits what's explicitly scoped to a role. **A role permits nothing
by default.** The fully-scoped target for Exit Keepa's `withdraw` action
is:

1. `scopeTarget(roleKey, targetAddress)` — `targetAddress` = the Aave Pool
   (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`). Moves the target's
   clearance from `None` to `Function`, so *no* function is callable on it
   until step 2 explicitly allows one.
2. `scopeFunction(roleKey, targetAddress, selector, conditions, options)`
   — `selector` = `0x69328dec` (`withdraw`), `options` = `None` (plain
   call, no value, no delegatecall), with a parameter condition fixing
   `asset == USDC` and `to == the Safe itself` (`amount` left
   unrestricted). Once this is live, the role can withdraw USDC from
   Aave and the funds can only ever land back in the Safe that owns them.

**What's actually granted on the live demo Safe right now** is a real
middle state between "any function, any target" and that fully-scoped
end state, not either extreme:

- **Step 1 is live**: `scopeTarget` has been applied, so the Aave Pool's
  clearance is `Function`, not whole-target `allowTarget`. On top of it,
  the `withdraw` selector (`0x69328dec`) has been explicitly allowed for
  the role via Zodiac's function-level allow. **No other function on the
  Aave Pool is callable through this role** — `supply`, `borrow`,
  `liquidate`, and every other Pool function are rejected by the Roles
  Modifier itself before Exit Keepa's own code ever runs.
- **Step 2's parameter conditions are not yet set.** The `withdraw`
  allowance carries no `asset`/`to` condition — the Roles Modifier will
  pass a call with *any* `asset` and *any* recipient `to`, not just USDC
  back to this Safe. Right now, "only USDC, only back to this Safe" is
  enforced by **Exit Keepa's own application-level policy check**
  (`agent/policy.ts`'s `assetBound`/`recipientBound`, see below), not by
  an on-chain condition — a real, stated gap, not glossed over. Closing
  it means re-running `scopeFunction` with the asset/recipient
  `ConditionFlat[]` described above; the exact calldata for that step is
  prepared in [`docs/ROLES_TIGHTENING.md`](docs/ROLES_TIGHTENING.md).
- The demo Safe may also still show a **`Wildcard` clearance on the Safe
  address itself** in the Roles config. That's residual from earlier demo
  setup, unrelated to the Aave withdraw path above — it does not grant
  anything against the Aave Pool, and should not be read as part of this
  permission's scope. It's flagged here so a judge inspecting the Roles
  config directly isn't misled by it.

**A real Aave v3 USDC withdraw has been executed end-to-end through this
exact path** — see "Live proof" below — proving the architecture works
against real chain state, under the permission state described above.

## User flow

1. **Connect wallet** (Home / any page's nav bar — any EIP-1193 injected
   wallet, e.g. MetaMask or Coinbase Wallet).
2. **Connect a Safe** (Dashboard) — register the Safe address, and its
   Roles Modifier address + role key if already configured.
3. **Create a strategy** (Create Strategy) — protocol/action is fixed to
   the one supported above; you choose the trigger condition and the
   withdraw amount ("entire position" or an exact smallest-unit amount).
4. **Review the exact transaction** — the target contract, function,
   decoded arguments, and raw calldata are shown before anything is
   activated. This is deterministically rebuilt server-side from the
   stored strategy — the frontend never supplies a target/function/
   calldata that gets trusted directly.
5. **Activate** — turns monitoring on. Does not simulate or broadcast
   anything by itself.
6. **Run Exit Guardian** (Strategy Detail) — reads the live Aave supply/
   borrow rate on Base, checks it against your condition, and runs a
   deterministic policy check (right chain, right contract, right
   function, right asset, funds returning only to your Safe, Roles
   configured). If the condition isn't met, nothing happens. If it's met
   but the policy check fails, the attempt is refused with a specific
   reason and nothing reaches KeeperHub. If it's met and the policy check
   passes, an execution is created and automatically simulated —
   `execTransactionWithRole` with `simulate: true`, through KeeperHub,
   against the real Roles Modifier and Aave Pool — landing on either
   `simulated` (would succeed) or `failed` (the exact revert reason). A
   background poller runs this same check on an interval when enabled
   (`AGENT_POLL_ENABLED=true` — off by default so a fresh deploy never
   starts creating real execution rows on its own).
7. **Execute (broadcast)** — only enabled once a simulation has actually
   succeeded; runs the identical call with `simulate: false` and an
   `Idempotency-Key` (KeeperHub's Safe First-Write Sequence), keyed to
   this execution's own stable id so a retried request replays instead
   of double-broadcasting. KeeperHub's `executionId` is saved as soon as
   it's known, then `GET /execute/{executionId}/status` is polled with
   backoff (honoring `X-Poll-Interval-Hint`) until a receipt confirms the
   outcome. A transaction hash is only ever shown/stored once a receipt
   says so — never fabricated, and never trusted from the self-reported
   status alone.
8. **History** — every execution attempt, its status, KeeperHub's own
   execution id, and a BaseScan link for any receipt-confirmed broadcast,
   is kept on the strategy detail page. A still-confirming broadcast
   keeps re-checking its status automatically.

## For judges

See [`docs/JUDGE_DEMO.md`](docs/JUDGE_DEMO.md) for the exact click path
(under 5 minutes), and [`docs/SUBMISSION.md`](docs/SUBMISSION.md) for the
full pitch and honest-limitations list. A demo video script for a human
to record is at [`docs/DEMO_VIDEO_SCRIPT.md`](docs/DEMO_VIDEO_SCRIPT.md).

- You can do everything through step 6 (simulate) with **zero funds at
  risk** — connecting a wallet, registering any Safe address, creating a
  strategy, and inspecting/simulating the exact transaction is all
  read-only against chain state.
- Step 7 (a real broadcast) additionally requires a Safe that (a) holds a
  real USDC supply position on Aave v3 Base, and (b) has actually been
  granted the Roles permission described above. For the demo Safe listed
  in "Live proof" below, both are already true — that's why its broadcast
  is a real, confirmed on-chain transaction rather than a simulation. Try
  it yourself with **any other Safe address** and you'll see the same
  simulate step correctly refuse to broadcast until those two conditions
  are met for that Safe.
- The **"Run Exit Guardian"** control on the strategy detail page runs
  the real autonomous decision path on demand, live: it reads the actual
  Aave rate from Base, not a value you type in. Every decision (including
  ones that don't act) is recorded and independently inspectable via its
  full receipt — intent, observation, policy check, simulation result.

## Live proof

This is **pre-existing chain history, not something a judge triggers**.
A real Aave v3 USDC withdraw was broadcast end-to-end through this exact
Safe → Roles Modifier → KeeperHub path on Base mainnet, before this
submission — the judge path below points at it rather than asking anyone
to re-broadcast against an already-emptied demo position:

| | |
|---|---|
| Tx hash | `0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b` |
| BaseScan | https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b |
| Result | Receipt status `0x1` (success) — USDC returned to the Safe |
| Safe | `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9` (Base) |
| Roles Modifier | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` |
| KeeperHub executor | `0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac` |

This was independently verified against the chain itself (not just the
app's own claim) via `eth_getTransactionReceipt`. The app's own
execution-history row for this broadcast briefly showed `status: failed`
due to a hash-extraction bug (fixed — see the executor tests) even though
the on-chain transaction had already succeeded; the chain, not the
database, is the source of truth here.

## Wallet-authenticated ownership

`GET /api/auth/nonce`, `POST /api/auth/verify`, `POST /api/auth/demo-session`
(`apps/api/src/routes/auth.ts`) implement a SIWE-style flow: sign a
one-time nonce with `personal_sign`, exchange the recovered signature for
a bearer session token, and every subsequent request to a Safe/strategy/
execution/agent-decision route is checked against a `safe_owners` table
(`apps/api/src/auth/session.ts`), so a caller can only ever read or act
on Safes they registered themselves. See
[`docs/SUBMISSION.md`](docs/SUBMISSION.md) for the full test list.

## Architecture

```
apps/web    Next.js (App Router) — wallet connect, dashboard, strategy CRUD, simulate/execute UI
apps/api    Express + Drizzle ORM — strategy/execution state machine, KeeperHub integration
packages/shared   Types, Zod schemas, and the Aave v3 Base protocol module (address constants + calldata encoder)
```

Key backend pieces:

- `packages/shared/src/protocols/aaveV3Base.ts` — the only place that
  encodes a `withdraw` call; throws rather than encoding anything for a
  non-USDC asset.
- `apps/api/src/execution/buildTransaction.ts` — the only place that
  turns a stored strategy into a transaction. Never accepts a
  target/function/calldata from a caller.
- `apps/api/src/execution/executor.ts` — calls KeeperHub's
  `execTransactionWithRole` with `simulate: true`/`false`; only trusts a
  transaction hash that passes real hex-format validation.
- `apps/api/src/execution/stateMachine.ts` — the broadcast idempotency
  rule (`decideBroadcast`), enforced with a conditional `UPDATE ... WHERE
  status = 'simulated'` so two concurrent requests can never both
  broadcast, and a retry after a successful broadcast is always a no-op.

## Local setup

```bash
npm install

cp .env.example apps/api/.env
cp .env.example apps/web/.env.local   # only NEXT_PUBLIC_* vars are read
```

Fill in `apps/api/.env` with a real `DATABASE_URL`, `KEEPERHUB_API_KEY`,
and `KEEPERHUB_WEBHOOK_SECRET`. Fill in `apps/web/.env.local` with
`NEXT_PUBLIC_API_URL=http://localhost:4000`. Never commit either file.

Run migrations against your database:

```bash
npm run db:migrate
```

Start both apps in dev mode (separate terminals):

```bash
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000
```

Health checks: `GET /health` on the API, `GET /api/health` on the web app.

## Testing

```bash
npm run test --workspace apps/api
npm run test --workspace packages/shared
```

167 tests total (158 in `apps/api`, 9 in `packages/shared`, verified by
running both commands above): chain-boundary enforcement (rejecting a
Safe registered on any chain other than Base before building a
Base-targeted transaction), calldata correctness (against
independently-computed hex fixtures, not the encoder checking itself),
condition-comparator logic, execution state-transition/idempotency
rules, KeeperHub response parsing (including refusing to trust a
malformed hash, distinguishing a confirmed KeeperHub rejection from an
ambiguous network/timeout failure, and the Safe First-Write Sequence's
Idempotency-Key/status-polling handling), and end-to-end tests
(`apps/api/test/e2e.test.ts`, `apps/api/test/auth.e2e.test.ts`) that
walk create strategy → activate → condition check → simulate →
broadcast → duplicate-broadcast rejection → recorded transaction hash,
against an in-memory fake of the database and a mocked KeeperHub
client.

## Environment variables

See `.env.example` for the full list; all are validated at process
startup (`apps/api/src/env.ts`, `apps/web/lib/env.ts`) — the app refuses
to boot with missing/malformed required configuration.

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | API | Neon Postgres connection string |
| `KEEPERHUB_API_KEY` | API | Never logged or exposed to the client |
| `KEEPERHUB_WEBHOOK_SECRET` | API | HMAC secret for `/api/webhooks/keeperhub` |
| `BASE_CHAIN_ID` / `BASE_RPC_URL` | API | Default to Base mainnet |
| `CORS_ORIGINS` | API | Set to `*` in production (this API has no cookie/session auth to protect) - unset means CORS is fully disabled and every browser request from the deployed frontend fails |
| `NEXT_PUBLIC_API_URL` | Web | Must point at the deployed API's public URL |

## Database

Schema: `apps/api/src/db/schema.ts` (Drizzle ORM). Tables:

- `safe_accounts` — chain, Safe address, optional Roles Modifier address + role key
- `exit_strategies` — condition (jsonb) + action (jsonb, validated `ExitAction`) + status
- `keeperhub_executions` — one row per execution attempt: idempotency key (unique), status, request/response payloads, tx hash, broadcast/confirmed timestamps, error message
- `audit_events` — append-only log of every state change

Migrations live in `apps/api/drizzle/` with a proper `meta/` journal
(earlier migrations in this project's history were never actually
runnable — no journal existed — which is why the previous production
database had zero tables; this is fixed).

```bash
npm run db:generate --workspace apps/api   # after changing schema.ts
npm run db:migrate --workspace apps/api    # apply migrations
```

## KeeperHub integration

**KeeperHub surfaces used** (all through the plain REST Direct Execution
API — no MCP client/server in this repo):

- `POST /execute/contract-call` — `execTransactionWithRole` against the
  Roles Modifier, `simulate: true` first, then `simulate: false` once
  clean (`apps/api/src/keeperhub/client.ts`'s `callContractFunction`).
- **`Idempotency-Key`** header on every broadcast, sourced from the
  execution row's own stable id — never minted fresh per HTTP attempt.
  `idempotentReplay`, `409 idempotency_conflict`, and
  `409 idempotency_in_progress` are each handled as their own case, not
  folded into a generic error.
- **`GET /execute/{executionId}/status`** polling with backoff, honoring
  `X-Poll-Interval-Hint`. `receipts[]` (independently re-fetched from the
  chain by KeeperHub) are treated as authoritative over the self-reported
  `status`/`transactionHash` fields.
- `GET /chains` — confirms Base is enabled.
- **Evaluated and skipped:** `POST /execute/check-and-execute` — would
  stay Roles-bound (the action leg is still `execTransactionWithRole`),
  but its condition check requires a single-scalar contract read, and
  Exit Keepa's real trigger (Aave's supply APR) only exists inside a
  15-field struct return with no single-scalar getter. See
  `docs/SUBMISSION.md` §4 for the full reasoning.

`apps/api/src/keeperhub/client.ts` and `apps/api/src/keeperhub/types.ts`
document, inline, exactly what was live-verified against KeeperHub's real
API this session (contract-call resolution, the `functionArgs` JSON-
stringified-array quirk, the `execTransactionWithRole` simulation and
real-broadcast response shapes) versus what's implemented directly from
KeeperHub's own published Direct Execution API reference but not yet
independently live-exercised by this project (the Idempotency-Key and
status-polling paths — see `docs/keeperhub-integration.md`'s
"Documented (2026-09-01)" section and `docs/SUBMISSION.md`'s "what still
breaks" list for the honest gap). `apps/api/src/execution/executor.ts` is
written to never trust an unverified shape — see its doc comments.

See `docs/keeperhub-integration.md` and `docs/zodiac-verification-evidence.md`
for the full research trail.

## Deployment

**Backend (Railway) — live:**

- Project: `exit-keepa` / service `api`, tracking branch
  `claude/exit-keepa-init-v5lzuy`
- URL: `https://api-production-2e11.up.railway.app`
- Build: `npm install && npm run build:api` (Railway dashboard setting —
  note this overrides `apps/api/railway.json`'s `build`/`deploy` fields
  for this service; the dashboard config is authoritative)
- **Pre-deploy command** (set directly on the Railway service, runs
  before every deploy): `npm run db:migrate --workspace apps/api` —
  idempotent, safe to run on every restart
- Start: `npm run start --workspace apps/api`
- Health check: `/health`

**Frontend (Vercel) — live:**

- Project: `exit-keepa-web`, tracking branch `claude/exit-keepa-init-v5lzuy`
- URL: `https://exit-keepa-web.vercel.app`
- Root Directory: `apps/web`; Install Command runs the real monorepo
  `npm install`, Build Command runs `npm run build:web` — see
  [`docs/VERCEL_DEPLOY.md`](docs/VERCEL_DEPLOY.md) for the exact
  settings and the two build-breaking misconfigurations that were fixed
  to get here (Root Directory, and the real `npm install` needing to run
  as the Install Command rather than buried inside the Build Command).

**Database (Neon):** already provisioned; migrations run automatically on
every Railway deploy via the pre-deploy command above.
