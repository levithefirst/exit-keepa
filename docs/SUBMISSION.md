# Exit Keepa — Hackathon Submission

## Pitch

Exit Keepa protects a DeFi position from an adverse rate move: a user
defines a threshold once, and when it's crossed, a pre-authorized exit
transaction executes through their own Safe — without Exit Keepa ever
holding their keys. Execution runs through KeeperHub, and authorization
is enforced entirely by a Zodiac Roles Modifier scoped to the user's Safe,
so the automation can only ever do the one thing it was explicitly
granted permission to do.

## Architecture

```
Rate condition  →  Exit Keepa (API + DB)  →  KeeperHub  →  Zodiac Roles Modifier  →  Safe  →  Aave v3 Pool.withdraw()
```

- **apps/web** — Next.js frontend: connect wallet, register a Safe, create
  a strategy, preview the exact transaction, activate, simulate.
- **apps/api** — Express + Postgres: stores strategies/executions, builds
  the exact withdraw transaction deterministically from stored data
  (never from client-supplied calldata), calls KeeperHub for
  simulate/broadcast.
- **KeeperHub** — executes `execTransactionWithRole` on the Roles
  Modifier on the user's behalf.
- **Zodiac Roles Modifier** — the only thing that can actually authorize
  a call on the Safe; scoped per role key to specific targets/functions.
- **Aave v3 Pool** — `withdraw(address asset, uint256 amount, address to)`
  is the one supported exit action in v1.

## Live deployment

- **API (live):** https://api-production-2e11.up.railway.app
- **Frontend:** not publicly reachable from this build session — see
  "Frontend deployment" below for the exact blocker and manual steps.
- **Safe:** `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9`
- **Roles Modifier:** `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE`
- **Role key (`exit_keepa`):** `0x657869745f6b6565706100000000000000000000000000000000000000000000`
- **Aave v3 Pool (Base):** `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- **KeeperHub executor (role member):** `0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac`

## Evidence: the authorization path is real and working

**1. On-chain Roles config, re-verified live via Gnosis Guild's public
subgraph** (`gnosisguild.squids.live/roles:production`) immediately before
this submission was written:

```json
{
  "key": "0x657869745f6b6565706100000000000000000000000000000000000000000000",
  "targets": [
    { "address": "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", "clearance": "Target", "executionOptions": "None" },
    { "address": "0xffd5c5e17e09e012c99550bfb2ef88d370cd66a9", "clearance": "Target", "executionOptions": "None" }
  ]
}
```

The `exit_keepa` role is granted `Target` clearance (whole-target,
`allowTarget`-style) on both the Aave v3 Pool and the Safe itself.

**2. Live simulation** (`POST /api/exit-strategies/447e68d9-.../executions/.../simulate`
against the live API, `simulate: true`, immediately before this
submission):

```json
{
  "status": "failed",
  "responsePayload": {
    "success": false,
    "wouldRevert": true,
    "revertReason": "ModuleTransactionFailed",
    "failureKind": "revert"
  },
  "errorMessage": "ModuleTransactionFailed"
}
```

This proves the full chain works: KeeperHub correctly builds and submits
`execTransactionWithRole` calldata, the Roles Modifier correctly
authorizes the `withdraw` call against the Aave Pool (the earlier
`ConditionViolation(2)` / `TargetAddressNotAllowed` from before the
`allowTarget` grant is gone), and the call reaches the Safe. It reverts
one level deeper, inside the actual Aave `withdraw()` call, with
`ModuleTransactionFailed` — the generic Zodiac wrapper for "the
authorized call itself failed" — consistent with this Safe holding no
Aave v3 USDC supply position (no aToken balance to withdraw).

**3. No broadcast was performed.** `wouldRevert: true` means the
transaction would fail on-chain; broadcasting it would just waste gas for
an identical revert. Per this project's own rule (never broadcast unless
a simulation actually succeeded), nothing was submitted.

## Honest limitations

- **No live on-chain rate oracle.** The trigger condition is checked
  against a rate value supplied to the "create execution" step (matching
  what a real monitor would observe), not read live from Aave — decoding
  `Pool.getReserveData()` correctly requires confirming the exact struct
  layout for the deployed Aave version, which wasn't independently
  verified, so it isn't guessed at.
- **The Roles grant is user-signed**, deliberately: Exit Keepa never
  submits a Roles configuration transaction itself. The app generates a
  Safe-specific deep link into Gnosis Guild's own Roles app
  (`https://app.safe.global/apps/open?safe=base:<safe>&appUrl=...roles.gnosisguild.org`)
  so the Safe's own signers review and approve it.
- **A successful real withdraw still requires an actual Aave position.**
  The demo Safe has no USDC supplied to Aave v3 Base, so any real
  broadcast would revert with `ModuleTransactionFailed`. Funding the Safe
  and calling Aave's `supply()` once (outside this app - a manual Safe
  transaction) is what turns the current "authorization proven, action
  blocked only by missing funds" state into a real, broadcastable
  withdraw.
- **Frontend deployment**: see below.

## Frontend deployment

`apps/web` builds and typechecks cleanly against
`NEXT_PUBLIC_API_URL=https://api-production-2e11.up.railway.app` (verified
this session). A Vercel project named `exit-keepa-web` already exists,
but this session's connected Vercel integration gets `403 Forbidden` on
every read/list/create against it - almost certainly because it was
created directly in the Vercel dashboard rather than through this
integration, which only gets access to projects it creates itself.

**Manual steps** (2 minutes, from the Vercel dashboard):
1. Open the existing `exit-keepa-web` project (or, if none exists in your
   account, New Project → import `levithefirst/exit-keepa`).
2. Root Directory: `apps/web`. Framework: Next.js (auto-detected).
3. Environment variable: `NEXT_PUBLIC_API_URL` = `https://api-production-2e11.up.railway.app`
4. Deploy. `apps/web/vercel.json` already sets the correct monorepo build
   command (`cd ../.. && npm install && npm run build:web`).

## Judge path

1. Open the deployed web app → **Connect Wallet**.
2. **Dashboard** → register any Safe (or the demo Safe address above).
3. **Create Strategy** → pick a trigger condition → **Preview** shows the
   exact target/function/calldata and the Roles permission required.
4. **Activate** the strategy.
5. **Strategy Detail** → enter a rate that satisfies the condition →
   **Create Execution** → **Simulate** → see a truthful success/failure
   result (never a fabricated one).
6. A real broadcast is only enabled after a simulation actually succeeds
   (`wouldRevert: false`) - which for this demo Safe requires it to
   actually hold a funded Aave v3 USDC position first.
