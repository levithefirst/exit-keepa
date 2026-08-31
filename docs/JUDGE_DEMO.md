# Judge demo path (under 5 minutes)

Everything in this doc is safe: through step 5 nothing is broadcast, and
step 6 is optional (it re-runs a simulation against a Safe that has
already completed a real broadcast once — see "Live proof").

## 0. Prerequisites

None. No wallet extension, no funds, no Safe of your own. Any modern
browser.

## 1. Start here

**https://exit-keepa-web.vercel.app**

You should see the Exit Keepa landing page: a headline about protecting
a DeFi position from an adverse rate move, a **"Live proof"** panel with
a real BaseScan transaction link, a 3-step "how it works" summary, and a
"For judges" callout.

If this URL shows a blank page, a Vercel error screen, or
`DEPLOYMENT_NOT_FOUND` — that's a real problem, not part of the demo.
See `docs/VERCEL_DEPLOY.md`. Fall back to the API directly:
`https://api-production-2e11.up.railway.app/health` should return
`{"status":"ok",...}`.

## 2. Enter demo mode

Click **"Try demo mode"** in the top nav bar. No wallet prompt appears —
you're now using a fixed local demo identity, clearly labeled **"Demo
mode"** in the nav. This is not a real wallet connection and never will
be mistaken for one.

## 3. Connect the live demo Safe

Click **Dashboard** in the nav. You'll see a "Connect your Safe" form.
Click **"Fill in the live demo Safe"** — this pre-fills the real,
on-chain Safe/Roles Modifier/role key below (not placeholder data):

| | |
|---|---|
| Safe | `0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9` |
| Roles Modifier | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` |
| Role key | `0x657869745f6b6565706100000000000000000000000000000000000000000000` |

Click **"Save Safe"**. The dashboard now shows the Safe's real ETH/USDC
balances (read live via `eth_call` against Base) and an empty
strategies list.

**Expected state:** dashboard shows the Safe card with real balances, no
strategies yet.

## 4. Create a strategy

Click **"+ New Strategy"** (or **Create Strategy** in the nav). Leave the
defaults (protocol is fixed to Aave v3 Base USDC; trigger "is below 2%")
or adjust the threshold. Click **"Preview Transaction"**.

**Expected screen:** the exact transaction Exit Keepa will run — target
contract (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`, the Aave v3
Pool), decoded function/args, and raw calldata — deterministically
rebuilt server-side, never trusted from the browser. Because the demo
Safe already has Roles configured, this shows a real buildable
transaction, not a "permission missing" notice.

Click **"Activate Strategy"**. This only turns monitoring on — nothing
is simulated or broadcast yet.

**Expected state:** strategy status badge reads **Active**.

## 5. Simulate

Click **"View Strategy"** (or find it from the Dashboard's strategy
list). In the "Manual trigger" card, leave the default rate or enter one
that satisfies the condition, then click **"Check & Create Execution"**.
An execution row appears with status **pending**. Click **Simulate** on
it.

**Expected result:** status becomes **simulated**, meaning KeeperHub ran
`execTransactionWithRole` with `simulate: true` against the real Roles
Modifier and Aave Pool on Base and it would succeed
(`wouldRevert: false`) — because this exact Safe already holds a real
Aave USDC position and the permission is already granted. Nothing has
been broadcast. Try the same flow with any other (non-demo) Safe address
and this step will correctly show a revert reason instead — the
permission and position requirements are real, not theater.

## 6. Do not re-broadcast the demo Safe (optional step, read first)

An **Execute (broadcast)** button now appears. **Do not click it during
judging** — it would attempt a second real on-chain withdrawal against a
Safe that has already been emptied by the first one (harmless — it will
either revert cleanly on insufficient balance, or move a trivial
residual amount — but it is a real mainnet transaction, not a demo
action, and re-runs are not needed to prove the claim). Instead:

## 7. Verify the existing on-chain proof

On the home page, the **"Live proof"** panel links directly to the
already-confirmed transaction:

**Tx:** `0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b`
**BaseScan:** https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b

Open it. Confirm independently (not just trusting this doc):

- Status: success
- Chain: Base
- `to`: the Safe (`0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9`) — the
  Safe calling itself via `execTransactionWithRole`
- Method / internal calls decode to a call into the Aave v3 Pool
  (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`)'s `withdraw` function

This transaction was executed by the exact same code path you just
exercised in steps 4-5 (simulate → broadcast), on this same demo Safe,
before this demo session. The chain, not Exit Keepa's own database, is
the source of truth for whether it happened.

## What to never click during a live demo

- **Execute (broadcast)** on the pre-filled demo Safe's execution (step
  6) — real mainnet transaction, not required to prove the claim.
- Anything on `app.safe.global` / `roles.gnosisguild.org` if you follow
  the "Open Zodiac Roles app" link from a strategy review — that's the
  real Safe Apps UI for the demo Safe's actual signers, not a sandbox.

## If a live external dependency fails mid-demo

- **API unreachable:** every page shows a red error message inline
  (never a silent blank screen or infinite spinner) - check
  `https://api-production-2e11.up.railway.app/health` directly.
- **KeeperHub unreachable during simulate/broadcast:** the execution row
  is marked `failed` with an explicit message rather than hanging or
  reporting a false success. If the error text says the outcome
  "could not be confirmed," that specific execution's broadcast state is
  genuinely unknown (see README's transaction-integrity notes) - point
  to the pre-verified "Live proof" transaction instead of retrying live.
- **Vercel frontend down, API still up:** fall back to describing the
  architecture from this doc plus the raw API (`curl .../api/health`,
  `.../api/exit-strategies`) and the BaseScan proof link - the on-chain
  claim does not depend on the frontend being up.
