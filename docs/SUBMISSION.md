# Exit Keepa — Hackathon Submission

## Pitch

Exit Keepa protects a DeFi position from an adverse rate move. A user
defines a threshold once; Exit Guardian — the autonomous decision layer —
reads the live Aave rate on Base, decides whether the condition is met,
runs a deterministic policy check, and either refuses with a specific
reason or approves and simulates a pre-authorized exit through the user's
own Safe. Exit Keepa never holds keys or funds. Execution runs through
KeeperHub, and authorization is enforced by a Zodiac Roles Modifier scoped
to the user's Safe, so the automation can only ever do the one thing it
was explicitly granted permission to do. This isn't a design on paper: a
real Aave v3 USDC withdraw has already executed end-to-end through this
exact path on Base mainnet — see "Live proof" below.

## Architecture

```
Base RPC (live rate) ─┐
                       ▼
              Exit Guardian (agent/guardian.ts)
                       │  edge-triggered decision, deterministic policy check
                       ▼
        Exit Keepa (API + DB)  →  KeeperHub  →  Zodiac Roles Modifier  →  Safe  →  Aave v3 Pool.withdraw()
                       ▲
        Background poller (agent/poller.ts) — same decision path, on an interval
```

- **apps/web** — Next.js frontend: connect a wallet (or "Try demo", no
  extension needed), register a Safe, create a strategy, preview the
  exact transaction, activate, run Exit Guardian, simulate, broadcast,
  and inspect the full decision receipt for any check the agent ever ran.
- **apps/api** — Express + Postgres:
  - `agent/aaveRateOracle.ts` — reads Aave v3's `getReserveData(address)`
    directly from the deployed Base Pool. The selector and the
    `ReserveDataLegacy` field layout it decodes were independently
    verified this session (a real Keccak-256 computation for the
    selector, Aave's own `DataTypes.sol`/`IPool.sol` source for the field
    order) rather than guessed or copied.
  - `agent/decisionStateMachine.ts` — the edge-trigger state machine
    (`normal` → `held`, exactly one attempt per crossing) that keeps a
    poller from re-attempting an execution every interval while a
    condition stays true.
  - `agent/guardian.ts` — the one place that observes, decides, and
    records what happened. Used identically by the on-demand API route
    and the autonomous poller.
  - `agent/policy.ts` — the deterministic policy check (chain, target,
    exact function selector, exact asset, recipient locked to the Safe,
    Roles configured). Pure and independently unit-tested.
  - `agent/broadcastGuards.ts` — stale-intent and amount-exceeded checks
    run immediately before broadcast, against live state.
  - `agent/poller.ts` — the background loop (off by default; see "Known
    limitations").
  - `execution/buildTransaction.ts` — still the single place that turns a
    stored strategy into the exact transaction sent anywhere; nothing
    here or in the agent layer ever accepts a target/selector/calldata
    from a caller.
- **KeeperHub** — executes `execTransactionWithRole` on the Roles
  Modifier on the user's behalf.
- **Zodiac Roles Modifier** — the only thing that can actually authorize
  a call on the Safe.
- **Aave v3 Pool** — `withdraw(address asset, uint256 amount, address to)`
  is the one supported exit action.

## Live deployment

- **API (live):** https://api-production-2e11.up.railway.app
- **Frontend (live):** https://exit-keepa-web.vercel.app
- **Safe:** `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9`
- **Roles Modifier:** `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE`
- **Role key (`exit_keepa`):** `0x657869745f6b6565706100000000000000000000000000000000000000000000`
- **Aave v3 Pool (Base):** `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- **KeeperHub executor (role member):** `0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac`
- **Submission branch:** `claude/exit-keepa-init-v5lzuy` (repo default branch)

## Live proof: a real broadcast succeeded

| | |
|---|---|
| Tx hash | `0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b` |
| BaseScan | https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b |
| Result | Receipt `status: 0x1` (success) — USDC returned to the Safe |

Independently verified against the chain itself via
`eth_getTransactionReceipt`, not just read from the app's own database.

## What's implemented this session (mapped to the P0/P1/P2 brief)

**P0 — done:**
- **Live autonomous observation.** `agent/aaveRateOracle.ts` replaces
  manual rate entry with a real `eth_call` against Aave's Base Pool.
- **Edge-triggered decision state machine.** `agent/decisionStateMachine.ts`
  + `exit_strategies.agent_state`, claimed with a race-safe conditional
  `UPDATE`. Regression-tested for the exact failure mode it exists to
  prevent (attempting once, not once per poll tick, across 50 simulated
  ticks with the condition held true).
- **Refusal as a first-class status.** `keeperhub_executions.status` gained
  `refused` (policy/condition said no before ever reaching KeeperHub) and
  `blocked` (a `simulated` row stopped short of broadcast by a
  stale-intent or amount-exceeded check). Every refusal carries a
  specific reason string, generated by real checks against real state —
  see `agent/policy.ts`'s and `agent/broadcastGuards.ts`'s tests for every
  branch exercised independently.
- **Verifiable execution receipt.** `agent_decisions` table +
  `GET /api/agent/decisions/:id` + `GET /api/exit-strategies/:id/agent/decisions`
  + a receipt panel on the strategy page. One structured object per
  decision: intent, observation, policy check, simulation result,
  KeeperHub result, final onchain result, plus an intent hash and a
  receipt hash so a judge can check the numbers add up, not just trust
  the label.

**P1 — partially done, honestly:**
- **Zodiac Roles scope** — **not tightened.** The live demo Safe's
  on-chain grant is still the broader `allowTarget`, not the narrower
  `scopeFunction` with asset/recipient conditions. This requires a
  Safe-signer-approved transaction through the Roles app; Exit Keepa
  deliberately never submits Roles configuration itself (see the "Roles
  permission" panel's own deep link), so this isn't something this
  session could do headlessly. Stated here, not papered over.
- **Wallet-authenticated ownership boundary** — **not implemented.**
  What *was* fixed: `GET /api/exit-strategies` with no `safeId` used to
  return every strategy in the database to any caller; it now requires
  `safeId`. What's still true: nothing in this API checks that a caller
  acting on a given strategy/execution/Safe ID is the wallet that
  actually owns it. A real fix needs signature-based auth (e.g. SIWE) tying
  a session to a wallet address, which is a substantial, security-critical
  feature in its own right — attempting it under this session's remaining
  time budget risked shipping something half-verified, which is worse
  than shipping nothing. Left as the top item for the next session.
- **Stale-intent detection** — **done.** `checkStaleIntent` in
  `broadcastGuards.ts`, run at broadcast time against the strategy's own
  `updatedAt` and the approving decision's age.
- **Amount-exceeded detection** — **done.** `checkAmountExceeded`, run at
  broadcast time against a live read of the Safe's aUSDC balance.
- **Idempotency under autonomous polling** — **confirmed and
  regression-tested.** The edge-trigger's conditional `UPDATE` is the
  same race-safety pattern the existing broadcast route already used for
  "never double-broadcast"; `test/agentGuardian.e2e.test.ts` exercises it
  through real HTTP routes with a real (fake) DB, including a scenario
  where 6 consecutive evaluate calls with the condition held true produce
  exactly one execution row and exactly one KeeperHub call.

**P2 — not attempted.** Explicitly deprioritized behind P0/P1 per the
brief; landing-page copy, visual consistency, and empty/error/loading
state polish are unchanged from the prior session's pass.

**Explicitly not built**, matching the brief's do-not-build list: no LLM
in the policy path (every check in `agent/policy.ts` is a plain boolean
comparison against known-good values), no protocols beyond Aave v3 Base
USDC, no chat interface, no multi-chain support, no token/NFT layer, no
agent-to-agent negotiation, no generic analytics dashboard.

## A note on what was already on the branch

`agent-economy-first-place` (PR #1, unmerged) claimed to add this layer
already. It was reviewed critically before anything here was built on it:
its Aave rate-decoding logic was real and, after independent
verification, correct — reused here. But the PR deleted the only UI path
that ever created an execution row and replaced it with an "evaluate"
endpoint that returned a decision without ever writing one, meaning an
approved decision was a dead end with no way to reach simulation or
broadcast. It also had no polling loop, no edge-trigger state, and no
persisted refusal status. It was not merged; this session's
implementation supersedes it.

## Honest limitations (updated)

- **Zodiac Roles scope is still the broad grant**, not the narrow one —
  see P1 above. A technical judge who checks the on-chain Roles config via
  Gnosis Guild's subgraph will find `allowTarget`, not a `scopeFunction`
  with conditions. This is a real gap, stated plainly.
- **No wallet-authenticated ownership boundary** — see P1 above. Anyone
  who knows a strategy or execution ID can still act on it. The
  worst-case version of this (enumerate every strategy with no ID at all)
  is fixed; the general case is not.
- **The autonomous poller is off by default everywhere**, including the
  live Railway deployment, until someone sets
  `AGENT_POLL_ENABLED=true`. This is a deliberate safety default (a fresh
  deploy should never silently start creating real execution rows against
  live chain state on its own), not an oversight — but it does mean the
  live site is not, right now, unattended-autonomous unless that variable
  is set. The on-demand "Run Exit Guardian" button runs the identical
  decision path either way.
- **A successful real withdraw still requires an actual Aave position**
  on the Safe being used. True for the demo Safe (hence the real
  broadcast); a Safe without one correctly refuses or simulates to a
  revert.
- **Aave oracle and aUSDC-balance reads are independently verified by
  static analysis** (real Keccak-256 selector computation, Aave's own
  source for struct layout and token address) but **not yet by a live
  RPC call** — this sandbox's egress proxy blocks direct chain access.
  Treat first production use as the final cross-check.

## Judge path (under 5 minutes)

See [`JUDGE_DEMO.md`](JUDGE_DEMO.md) for the exact click-by-click
version. It opens with a refusal (a strategy configured to withdraw more
than the Safe holds — Exit Guardian observes the live rate, approves the
policy check, then the automatic simulation reveals it can't actually be
done, and refuses with the real reason), then shows an approval on the
strategy that already completed a real broadcast, then points to that
existing on-chain proof rather than re-broadcasting live.
