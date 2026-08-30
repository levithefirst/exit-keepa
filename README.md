# Exit Keepa

Exit Keepa protects a DeFi position from an adverse rate move by letting
you define an exit condition once, then executing the exit automatically
through your own Safe — without ever holding your keys.

> "If the monitored rate crosses my threshold, withdraw my position back
> to my Safe."

**Live demo:** connect a wallet at the deployed web app (see
[Deployment](#deployment) for the URL once you've deployed it — Vercel
deployment from this environment was blocked by an account permission
issue, see that section), or run it locally in a couple of minutes (see
[Local setup](#local-setup)). The API is live at
`https://api-production-2e11.up.railway.app`.

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
by default.** For Exit Keepa's `withdraw` action, the narrowest possible
permission is:

1. `scopeTarget(roleKey, targetAddress)` — `targetAddress` = the Aave Pool
   (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`). Moves the target's
   clearance from `None` to `Function`, so *no* function is callable on it
   until step 2 explicitly allows one.
2. `scopeFunction(roleKey, targetAddress, selector, conditions, options)`
   — `selector` = `0x69328dec` (`withdraw`), `options` = `None` (plain
   call, no value, no delegatecall), with a parameter condition fixing
   `asset == USDC` and `to == the Safe itself` (`amount` is left
   unrestricted). This means the role can withdraw USDC from Aave, and
   the funds can only ever land back in the Safe that owns them — never
   anywhere else, and no other Aave action (supply, borrow, liquidate,
   flash-loan) is reachable.

**This permission is not pre-granted anywhere in this repo or its
deployment.** The exact `ConditionFlat[]` byte encoding for step 2 is a
flattened-tree encoding that Zodiac's own tooling (`zodiac-roles-sdk`)
generates and round-trip-verifies — hand-rolling it for a permission that
gates fund movement is exactly the kind of guess this project has
avoided throughout. Generate it with that SDK, review the exact
`scopeTarget`/`scopeFunction` calldata it produces, and grant it from the
Safe's own owner(s) before real execution can succeed. Until then,
simulating a `withdraw` through an unscoped role will correctly revert
with `ConditionViolation(2, ...)` — `2` is `TargetAddressNotAllowed` in
Zodiac's `PermissionChecker.Status` enum (verified against
`gnosisguild/zodiac-modifier-roles` source), meaning the target isn't
authorized yet, not that anything else is wrong.

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
6. **Simulate** (Strategy Detail) — runs `execTransactionWithRole` with
   `simulate: true` through KeeperHub against the real Roles Modifier and
   Aave Pool on Base, and shows whether it would succeed or the exact
   revert reason.
7. **Execute (broadcast)** — only enabled once a simulation has actually
   succeeded; runs the identical call with `simulate: false`. The
   returned transaction hash is only ever shown/stored if it's a
   well-formed 66-character hash — never fabricated.
8. **History** — every execution attempt, its status, and a BaseScan link
   for any real broadcast, is kept on the strategy detail page.

## For judges

- You can do everything through step 6 (simulate) with **zero funds at
  risk** — connecting a wallet, registering any Safe address, creating a
  strategy, and inspecting/simulating the exact transaction is all
  read-only against chain state.
- Step 7 (a real broadcast) additionally requires a Safe that (a) holds a
  real USDC supply position on Aave v3 Base, and (b) has actually been
  granted the narrow Roles permission described above — see that section
  for why this isn't pre-granted in the deployed demo.
- The "manual trigger" control on the strategy detail page exists because
  v1 has no live on-chain rate oracle wired up yet — see **Known
  limitations** below. It lets you enter the rate a real monitor would
  have observed, and the server independently re-checks it against the
  strategy's stored condition before creating an execution — it never
  trusts a client-supplied "yes, the condition is true."

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

53 tests total: calldata correctness (against independently-computed hex
fixtures, not the encoder checking itself), condition-comparator logic,
execution state-transition/idempotency rules, KeeperHub response parsing
(including refusing to trust a malformed hash), and an end-to-end test
(`apps/api/test/e2e.test.ts`) that walks create strategy → activate →
condition check → simulate → broadcast → duplicate-broadcast rejection →
recorded transaction hash, against an in-memory fake of the database and
a mocked KeeperHub client.

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
| `DIAGNOSTIC_SECRET` | API | Optional; gates the temporary `/internal/diagnostics/*` routes used during this project's KeeperHub/Roles verification work — see `docs/` |
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

`apps/api/src/keeperhub/client.ts` and `apps/api/src/keeperhub/types.ts`
document, inline, exactly what was live-verified against KeeperHub's real
API this session (contract-call resolution, the `functionArgs` JSON-
stringified-array quirk, the `execTransactionWithRole` simulation
response shape) versus what remains unverified (the exact response shape
for a real broadcast). `apps/api/src/execution/executor.ts` is written to
never trust an unverified shape — see its doc comments.

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

**Frontend (Vercel) — not deployed from this environment:**

Both `create_git_project` and a manual `deploy_to_vercel` file-tree
deploy were attempted for a new `exit-keepa-web` project and both failed
with `403 forbidden: You don't have permission to create a ... Deployment
for this project` — an account/token permission restriction on this
environment's connected Vercel access, not a bug in the app itself (the
app builds and typechecks cleanly, see below). To deploy it yourself:

```bash
# from the Vercel dashboard, or via the Vercel CLI:
vercel link            # create/link a project, root directory: apps/web
vercel env add NEXT_PUBLIC_API_URL production   # https://api-production-2e11.up.railway.app
vercel --prod
```

Or connect the GitHub repo directly in the Vercel dashboard (New Project
→ Import `levithefirst/exit-keepa` → root directory `apps/web` → it will
pick up `apps/web/vercel.json`'s build command, which builds
`packages/shared` first).

**Database (Neon):** already provisioned; migrations run automatically on
every Railway deploy via the pre-deploy command above.

## Known limitations

- **No live on-chain rate oracle.** Reading Aave's actual current
  supply/borrow APR requires decoding `Pool.getReserveData()`'s returned
  struct, whose exact field layout differs across Aave v3 versions. This
  wasn't decoded without independently confirming which exact version is
  deployed at the specific Base Pool address in use — guessing a struct
  layout for a value that gates fund movement is exactly the kind of
  guess this project avoids. The strategy detail page instead lets you
  enter the rate a monitor would have observed, and the server
  independently re-validates it against the condition before creating an
  execution.
- **The Roles permission for `withdraw` is not pre-granted anywhere.**
  See "How execution is authorized" above for the exact spec and why the
  final calldata should come from Zodiac's own SDK rather than being
  hand-encoded here.
- **Single protocol/action only.** By design for v1 — see "What it
  actually does" above.
- **Frontend deploy is a manual step** for the reason described in
  Deployment above.
