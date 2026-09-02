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

## 4. Create a strategy and watch Exit Guardian evaluate it live

Click **"+ New strategy"**. Pick a trigger and Preview → Activate it, then
open the strategy and click **"Run Exit Guardian"** (or, if the
autonomous poller is enabled, just wait — it checks every 30 seconds on
its own).

**Expected result:** Exit Guardian reads the live Aave supply APR on Base
right now (a real RPC read — the same call a real strategy uses, not a
canned number) and checks it against your chosen condition. Pick a
threshold that's clearly *not* met yet (e.g. "is below 0.01%") to see
**Normal: condition not met** — nothing attempted, exactly as it should
be. Pick one that's clearly *already* met (e.g. "is below 100%") to see
it **trigger**: every real policy check passes (right chain, right
contract, right function, right asset, funds returning only to this Safe,
Roles configured), and the transaction preview shows the exact real
calldata this strategy would run.

**What's mocked, and why:** the one thing that can't be real here is the
final "would this actually revert on-chain" simulate step — that requires
a real Roles Modifier and a real Safe genuinely deployed on Base, which a
sandbox correctly does not have. That step is clearly labeled
`"sandbox": true` in the receipt (open **"Inspect the full receipt"**) and
always comes back clean, rather than either faking a specific revert
reason or leaving the whole flow at a dead end. Everything upstream of it
— the rate, the condition check, the policy check, the exact transaction
that would be sent — is real. Broadcasting from a sandbox is refused
outright by the API (409, "This is a demo sandbox Safe...") — there is no
"Confirm broadcast" path that does anything here.

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

- Nothing in the sandbox walkthrough (step 4) needs caution — broadcast is
  refused outright there by design, so there is no "real money" click to
  avoid.
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
- **Base RPC unreachable during "Run Exit Guardian":** the check itself
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
