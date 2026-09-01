# Judge demo path (under 5 minutes)

The path below opens with a **refusal**, on purpose: the point of Exit
Guardian is that it can say no. Everything through the refusal step is
completely safe — nothing is broadcast until the very last step, and that
step is optional (it re-runs a real broadcast against a Safe that has
already completed one — see "Live proof").

## 0. Prerequisites

None. No wallet extension, no funds, no Safe of your own. Any modern
browser.

**Before recording:** if you want the demo to show the fully unattended
autonomous loop (not just the on-demand "Run Exit Guardian" button), set
`AGENT_POLL_ENABLED=true` on the Railway API service first — it's off by
default everywhere so a fresh deploy never silently starts polling live
chain state and creating real execution rows on its own. The on-demand
button runs the exact same code path either way (`agent/guardian.ts`'s
`evaluateStrategy`), so the demo works correctly with the poller off too —
you're just clicking the trigger yourself instead of waiting for the
30-second interval.

## 1. Start here

**https://exit-keepa-web.vercel.app**

You should see the Exit Keepa landing page: a headline, a **"Live
proof"** panel with a real BaseScan transaction link, a 3-step "how it
works" summary, and a "For judges" callout.

If this URL shows a blank page or a Vercel error — that's a real problem,
not part of the demo. Fall back to the API directly:
`https://api-production-2e11.up.railway.app/health` should return
`{"status":"ok",...}`.

## 2. Enter demo mode

Click **"Try demo"** in the top nav. No wallet prompt appears — you're
using a fixed local demo identity, clearly labeled **"Demo mode"** in the
nav. Under the hood this now goes through the same session-token exchange
a real wallet connection does (`POST /api/auth/demo-session`), just
without a signature — invisible to you, but it's what lets the live demo
Safe stay usable in demo mode while a real connected wallet gets genuine
exclusive ownership of its own Safes and strategies.

## 3. The live demo Safe

Click **Dashboard**. The real, on-chain Safe already used for the proof
transaction loads automatically — no manual entry needed:

| | |
|---|---|
| Safe | `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9` |
| Roles Modifier | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` |
| Role key | `0x657869745f6b6565706100000000000000000000000000000000000000000000` |

## 4. Create a strategy that will genuinely refuse

Click **"+ New strategy"**. Set the trigger to something that's certainly
already true right now (e.g. "is below 100%" — supply APR is never
100%+), so Exit Guardian has an immediate crossing to react to. Set the
withdraw amount to **an exact amount clearly larger than the Safe could
hold** — e.g. `999999000000` (999,999 USDC, smallest units). Click
**Preview**, then **Activate**.

This isn't a fake amount picked to force a demo failure for its own sake
— it's the same failure mode a real user hits if their configured
withdrawal no longer matches their actual position (a partial withdrawal
happened elsewhere, or the position was smaller than they remembered).
Exit Guardian is supposed to catch exactly this.

## 5. Watch it refuse

Open the strategy, and click **"Run Exit Guardian"** (or, if the
autonomous poller is enabled, just wait — it checks every 30 seconds on
its own).

**Expected result:** Exit Guardian reads the live Aave supply rate on
Base, confirms your condition is met, confirms every policy check passes
(right chain, right contract, right function, right asset, funds
returning only to this Safe, Roles configured) — and then the automatic
simulation against the real KeeperHub/Roles Modifier/Aave Pool comes back
`wouldRevert: true`: the Safe doesn't actually hold that much. The
execution is marked **Failed**, with the real revert reason, not a
canned string. Nothing was broadcast.

Open **"Inspect the full receipt"** — every claim in this paragraph is
independently checkable there: the exact observed rate, the exact policy
check results, the exact simulation response.

## 6. About "watching it succeed" live

**Read this before demoing the success case — the Safe's Aave position
is currently empty**, verified live (aUSDC balance: `0`) right before
this revision. The canonical proof tx (step 8) already withdrew it, and
nothing has re-supplied it since. This changes what a live re-run
against the already-completed strategy actually shows:

Navigate to the strategy that already holds the real completed withdraw
and click **"Run Exit Guardian"** anyway. **Expected result today:**
another real refusal — `wouldRevert: true`, because there is nothing
left to withdraw. This is not a bug in the demo; it's the exact same
safety mechanism from step 5 catching a second real failure mode (a
stale strategy pointed at a position that no longer exists), live,
unscripted. Frame it that way rather than expecting a clean simulate.

**To show an actual clean `wouldRevert: false` simulation live**, the
Safe needs a real Aave USDC position again first — supply USDC to the
Aave v3 Pool through this Safe (outside Exit Keepa's own scope; use the
Safe's normal signing flow) before recording, then create a fresh
strategy with `amount: "max"`. That's a real fund-moving action only the
Safe's own signers can take, not something to script blindly.

**If you don't re-fund it:** treat the pre-existing BaseScan transaction
(step 8) as the success evidence — it's a real, already-confirmed
success on this exact path — and present the live demo as two real
refusals (oversized amount, then empty position) plus that existing
proof, rather than forcing a third live call that will also revert.

## 7. Do not re-broadcast the demo Safe

**Do not click "Confirm broadcast" during judging** in either case above
— even the empty-position run reaches only `Simulated`/`Failed`, never a
real broadcast, but if you do fund a fresh position and get a clean
simulation, a broadcast from it is a real mainnet transaction and isn't
needed to prove the claim already proven in step 8. Instead:

## 8. Verify the existing on-chain proof

The home page's **"Live proof"** panel links directly to the
already-confirmed transaction:

**Tx:** `0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b`
**BaseScan:** https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b

Open it. Confirm independently:

- Status: success
- Chain: Base
- **`to` is KeeperHub's own sponsor/relay contract, not the Safe** - this
  was a gas-sponsored execution (KeeperHub's own status API confirms
  `sponsored: true` for this exact execution), so the top-level caller on
  BaseScan is never the Safe or the Roles Modifier directly. Don't expect
  otherwise.
- What actually proves the claim: the decoded input data resolves to
  `execTransactionWithRole` against the Roles Modifier
  (`0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE`), the internal calls
  reach the Aave v3 Pool's `withdraw` function, and the Safe itself emits
  `ExecutionFromModuleSuccess` in the logs - its own on-chain
  confirmation that it executed this as a module call from the Roles
  Modifier.
- See `docs/SUBMISSION.md` §6 for the full field-by-field trace,
  independently re-derived both from raw Base RPC and from KeeperHub's
  own execution-status API (execution ID `u9zr4vzbfurjvzgwz687g`).

This transaction was executed by the same simulate → broadcast path you
just exercised in steps 5-6, on this same demo Safe, before this demo
session. The chain, not Exit Keepa's own database, is the source of
truth for whether it happened.

## What to never click during a live demo

- **"Confirm broadcast"** on the already-completed demo Safe (step 7) —
  real mainnet transaction, not required to prove the claim.
- Anything on `app.safe.global` / `roles.gnosisguild.org` if you follow
  the "Open Zodiac Roles app" link — that's the real Safe Apps UI for the
  demo Safe's actual signers, not a sandbox.

## If a live external dependency fails mid-demo

- **API unreachable:** every page shows a red error message inline
  (never a silent blank screen) — check
  `https://api-production-2e11.up.railway.app/health` directly.
- **Base RPC unreachable during "Run Exit Guardian":** the check itself
  fails with a real error message (a genuine RPC failure, not a fabricated
  refusal) — retry, or fall back to the pre-verified "Live proof"
  transaction.
- **KeeperHub unreachable during simulate/broadcast:** the execution row
  is marked `failed` with an explicit message rather than hanging or
  reporting a false success. If the error text says the outcome "could
  not be confirmed," that specific broadcast's state is genuinely
  unknown — point to the pre-verified "Live proof" transaction instead of
  retrying live.
