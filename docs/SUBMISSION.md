# Exit Keepa — Hackathon Submission

## Pitch

Exit Keepa protects a DeFi position from an adverse rate move: a user
defines a threshold once, and when it's crossed, a pre-authorized exit
transaction executes through their own Safe — without Exit Keepa ever
holding their keys. Execution runs through KeeperHub, and authorization
is enforced entirely by a Zodiac Roles Modifier scoped to the user's Safe,
so the automation can only ever do the one thing it was explicitly
granted permission to do. This isn't just a design on paper: a real Aave
v3 USDC withdraw has already been executed end-to-end through this exact
path on Base mainnet — see "Live proof" below.

## Architecture

```
Rate condition  →  Exit Keepa (API + DB)  →  KeeperHub  →  Zodiac Roles Modifier  →  Safe  →  Aave v3 Pool.withdraw()
```

- **apps/web** — Next.js frontend: connect a wallet (or use "Try demo
  mode" with no wallet extension needed), register a Safe, create a
  strategy, preview the exact transaction, activate, simulate, broadcast,
  and view execution history — all against the live API.
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
- **Frontend:** pending manual Vercel deploy — this environment's
  connected Vercel integration gets `409 Conflict`/`403 Forbidden` against
  the existing `exit-keepa-web` project (an account/token permission
  restriction, not an app bug — `apps/web` builds and typechecks cleanly).
  See [`VERCEL_DEPLOY.md`](VERCEL_DEPLOY.md) for the exact manual steps.
  In the meantime, run it locally (see the main [README](../README.md#local-setup))
  and use "Try demo mode" to explore the full flow without a wallet.
- **Safe:** `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9`
- **Roles Modifier:** `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE`
- **Role key (`exit_keepa`):** `0x657869745f6b6565706100000000000000000000000000000000000000000000`
- **Aave v3 Pool (Base):** `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- **KeeperHub executor (role member):** `0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac`
- **Submission branch:** `claude/exit-keepa-init-v5lzuy` (repo default
  branch; kept in sync with the working branch `claude/verify-railway-mcp-tk0q6h`)

## Live proof: a real broadcast succeeded

A real Aave v3 USDC withdraw was broadcast through this exact
Safe → Roles Modifier → KeeperHub path and confirmed on Base mainnet:

| | |
|---|---|
| Tx hash | `0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b` |
| BaseScan | https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b |
| Result | Receipt `status: 0x1` (success) — USDC returned to the Safe |

This was independently verified against the chain itself via
`eth_getTransactionReceipt` — not just taken from the app's own database.
In fact, the app's own execution-history row for this exact broadcast
briefly showed `status: failed`, because the hash-extraction logic didn't
recognize KeeperHub's success response shape
(`{status: "completed", transactionHash, ...}` has no `wouldRevert` key,
which is what the code was keying off of). That bug is now fixed —
`extractTransactionHash()` in `apps/api/src/execution/executor.ts` checks
`transactionHash`/`txHash`/`hash` across the top level and `result`/`data`
sub-objects, with regression tests using the real response payload. The
chain, not a database row, was always the actual source of truth for
whether the withdraw happened; this fix makes the app agree with it.

### How this was reached

1. **On-chain Roles config**, verified live via Gnosis Guild's public
   subgraph (`gnosisguild.squids.live/roles:production`): the `exit_keepa`
   role has `Target` clearance (`allowTarget`-style) on both the Aave v3
   Pool and the Safe itself.
2. **The Safe was funded** with a real USDC supply position on Aave v3
   Base (verified independently via a direct `eth_call` to the aUSDC
   token contract for the Safe's balance).
3. **Simulation** (`simulate: true`) against the live API returned
   `wouldRevert: false`.
4. **Broadcast** (`simulate: false`) was then triggered once, per this
   project's own rule of never broadcasting without a preceding clean
   simulation — producing the confirmed transaction above.

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
  so the Safe's own signers review and approve it. What's actually
  granted on the live demo Safe is the broader `allowTarget` grant rather
  than the narrower `scopeFunction` (with asset/recipient conditions)
  documented as the ideal in the main README — a real trade-off, since
  the narrower grant requires generating a `ConditionFlat[]` encoding via
  `zodiac-roles-sdk` that wasn't completed before submission.
- **A successful real withdraw requires an actual Aave position** on the
  Safe being used. That's true for the demo Safe above (hence the real
  broadcast); a different Safe without one will correctly simulate to a
  revert and never reach broadcast.
- **Frontend deployment** is a manual Vercel step — see above.

## Judge path (under 5 minutes)

1. Open the web app (deployed URL once live, or `npm run dev:web` locally
   against the live API) → click **"Try demo mode"** (no wallet needed).
2. **Dashboard** → click **"Fill in the live demo Safe"** to pre-fill the
   real Safe/Roles Modifier/role key above → **Save Safe**.
3. **Create Strategy** → pick a trigger condition → **Preview** shows the
   exact target/function/calldata and the Roles permission required.
4. **Activate** the strategy.
5. **Strategy Detail** → enter a rate that satisfies the condition →
   **Create Execution** → **Simulate** → see the real result
   (`wouldRevert: false` for the demo Safe, since it already holds an
   Aave position and the permission is already granted).
6. Broadcasting again would move real funds on an already-completed demo
   position, so it isn't repeated in the UI walkthrough — the "Live
   proof" panel on the home page and above links directly to the already-
   confirmed transaction instead.
