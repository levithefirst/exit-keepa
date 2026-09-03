# Judge demo path (under 5 minutes)

This has two independent parts: **your own live walkthrough** (demo mode
— an isolated sandbox Safe, auto-provisioned just for your session, never
shared with any other visitor) and **static, independently-verifiable
proof** that the exact same pipeline executed a real withdrawal on a real
Safe (the "Live proof" BaseScan transaction). Demo mode never touches that
real Safe — every "Try demo" click gets a brand-new sandbox, so nothing
you do here is broadcast or shared with anyone else.

## 0. Prerequisites

None. No wallet extension, no funds, no Safe of your own. Any modern
browser.

**Nothing to configure before recording.** The autonomous poller is on by
default in production, so an activated strategy is genuinely being
watched every 30 seconds with nobody present. If you'd rather not wait for
the interval on camera, the **"Check now"** button runs the exact same
code path (`agent/guardian.ts`'s `evaluateStrategy`) immediately — it is
the same agent, triggered by hand, not a different manual route.

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

Click **"Try demo"** in the top nav. No wallet prompt appears. Under the
hood this goes through the same session-token exchange a real wallet
connection does (`POST /api/auth/demo-session`), just without a
signature — and it also auto-provisions a brand-new, private sandbox Safe
for this session alone, with its Roles permission pre-configured so
there's no setup wall to hit. Nobody else — not even another judge
opening the same link at the same time — sees or shares it; a real
connected wallet still gets genuine exclusive ownership of its own real
Safes and strategies the normal way.

## 3. Your own sandbox Safe

Click **Dashboard**. Your session's own sandbox Safe loads automatically
— a synthetic address, generated fresh for you, never deployed on any
real chain. Its Roles Modifier and role key are pre-set (also synthetic)
so the dashboard reads "✓ Roles permission ready to execute through"
immediately, with nothing to configure.

## 4. Create a strategy, activate it, and watch Exit Keepa do the rest

Click **"+ New strategy"**. Pick a trigger and Preview → **Activate**.
That is the last thing you do. Open the strategy: it reads **WATCHING**,
and Exit Keepa is now checking the live Aave supply APR on Base every 30
seconds on its own. Press **"Check now"** if you don't want to wait for
the interval — same code path, just triggered immediately.

**Expected result.** Pick a threshold that's clearly *not* met yet (e.g.
"is below 0.01%") and the strategy stays at **WATCHING** with nothing
attempted — exactly as it should be. Pick one that's clearly *already*
met (e.g. "is below 100%") and, with no further clicking, the whole
lifecycle runs: the live rate is read (a real RPC read, not a canned
number), the edge crossing is claimed exactly once, every policy check
passes (right chain, right contract, right function, right asset, funds
returning only to this Safe, Roles configured), the transaction is
simulated, and the execution completes. The page ends on **"Demo
execution completed."**

**What is and isn't real here, precisely.** Everything upstream of the
chain is real: the rate, the condition check, the policy check, the exact
calldata that would be sent, the one-execution-per-crossing claim, the
status handling. What cannot be real is anything requiring a Safe and a
Roles Modifier actually deployed on Base, which a sandbox correctly does
not have — so the simulate step is labelled `"sandbox": true` and the
execution finishes as **`demo_completed`**, never `succeeded`, with **no
transaction hash**, because no transaction exists. Exit Keepa does not
show you a hash it can't back. For a real hash, see step 6.

## 5. The real thing: independently-verifiable proof, not a live demo

The interactive walkthrough above intentionally never touches this
project's own real Safe — that's the isolation fix this whole flow was
rebuilt around. Instead, the claim that this pipeline genuinely executes
on a real Safe is backed by a real, already-confirmed transaction you can
verify yourself, completely independent of demo mode:

## 6. Verify the existing on-chain proof

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

This transaction was executed by the exact same simulate → broadcast code
path the sandbox walkthrough in step 4 exercises, just on this project's
own real Safe rather than your sandbox one, and before this demo session
even existed. The chain, not Exit Keepa's own database, is the source of
truth for whether it happened.

## What to never click during a live demo

- Nothing in the sandbox walkthrough (step 4) needs caution — a sandbox
  Safe has no chain to reach, so no click there can move real money.
- Anything on `app.safe.global` / `roles.gnosisguild.org` if you follow a
  "Open Zodiac Roles app" link on a *real, non-sandbox* Safe you don't
  control — that opens the real Safe Apps UI for that Safe's actual
  signers, not a sandbox. (The sandbox Safe's own Roles panel already
  reads "ready," so there's no reason to click that link during the
  sandbox walkthrough at all.)

## If a live external dependency fails mid-demo

- **API unreachable:** every page shows a red error message inline
  (never a silent blank screen) — check
  `https://api-production-2e11.up.railway.app/health` directly.
- **Base RPC unreachable during a check:** the check itself
  fails with a real error message (a genuine RPC failure, not a fabricated
  refusal) — retry, or fall back to the pre-verified "Live proof"
  transaction.
- **KeeperHub unreachable:** doesn't affect the sandbox walkthrough at all
  (its simulate step never calls KeeperHub - see step 4). On a real,
  non-sandbox Safe, the execution row is marked `failed` with an explicit
  message rather than hanging or reporting a false success; if the error
  text says the outcome "could not be confirmed," that specific
  broadcast's state is genuinely unknown - point to the pre-verified
  "Live proof" transaction instead of retrying live.
