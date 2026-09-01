# Demo video script

For a human to record. Target length: **150-180 seconds**.

**Read this first — the demo Safe's Aave position is currently empty.**
The canonical proof tx already withdrew it, and this session verified
live (via a direct RPC balance read, right before this revision) that
nothing has re-supplied it since: aUSDC balance is `0`. That changes what
a live "run it again on the strategy that already succeeded" shot
actually shows today — running it now produces a **second real refusal**
(nothing left to withdraw), not a clean `wouldRevert: false`. This script
is written around that real state, not the shape of a script that would
need a lucky/funded moment to work. Two options, pick one before you
record:

- **Option A (default, needs no setup, described below):** two real
  refusals live (oversized amount, then empty position), then cut to the
  pre-existing BaseScan transaction as your success evidence. Nothing to
  prepare, nothing that can fail differently than expected.
- **Option B (a genuine live clean simulate):** before recording, supply
  real USDC to the Aave v3 Pool through the demo Safe (its own signing
  flow, a real fund-moving action — not something to script blindly, and
  not something this project's own code does on its own), then create a
  fresh strategy with amount `"max"`. If you do this, swap step 9-11
  below for: open that fresh strategy, click "Run Exit Guardian", expect
  `wouldRevert: false` and a "Simulated, not sent" state.

The rest of this script assumes **Option A**.

**Do not click "Confirm broadcast" during recording**, in either option —
Option A never reaches a state where that button does anything but sit
there disabled/unclicked; Option B's success case reaches a live
broadcast button, but clicking it is a real mainnet transaction and isn't
needed to prove a claim the BaseScan link (step 2) already proves.

## Setup before hitting record

- Have **https://exit-keepa-web.vercel.app** open, logged out (fresh tab
  or private window), so "Try the demo" is visible.
- Have a second tab open to the BaseScan proof link, ready to alt-tab to:
  https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b
- Zoom the browser to ~110-125% so on-screen text is readable in a
  recording.
- Decide up front whether you're recording with the autonomous poller on
  or off (see "Autonomous vs. on-demand" below) - it changes shots 7 and
  10's script slightly.

## Exact click-through order (Option A)

1. Homepage: `https://exit-keepa-web.vercel.app`
2. Click **"Verify on BaseScan →"** in the Live proof panel → confirm
   `Status: Success` on the BaseScan tab → switch back to the app tab
   (don't navigate away from it, just alt-tab).
3. Click **"Try the demo, no wallet needed"** in the hero.
4. You land on **Dashboard** - the live-proof Safe is already populated
   (Safe address, Roles Modifier, balances). No manual entry needed.
5. Click **"+ New strategy"**.
6. Fill the form for the **oversized-amount refusal**:
   - Name: anything, e.g. "Oversized withdrawal test"
   - Trigger: comparator **"is below"**, threshold **`100`** (100% -
     supply APR is never that high, so the condition is already true)
   - Amount: select **"Withdraw an exact amount"**, enter
     **`999999000000`** (999,999 USDC in smallest units - clearly larger
     than the Safe could ever hold)
   - Click **Preview transaction** → click **Activate strategy** on the
     review screen.
7. On the newly-activated strategy's detail page, click **"Run Exit
   Guardian"**.
8. **Wait for the result.** Expected: the receipt panel shows the
   observed live Aave rate, the condition is met, every policy check
   passes - and the automatic simulation comes back `wouldRevert: true`.
   The execution shows **Failed**, with the real revert reason. Point at
   **"Inspect the full receipt"** - every number on screen is
   independently checkable there.
9. Go back to **Dashboard**, open the **other** strategy - the one tied
   to the already-completed withdraw.
10. Click **"Run Exit Guardian"** again.
11. **Wait for the result.** Expected: same observe → decide →
    policy-check sequence - and this time it refuses too, for a
    different, equally real reason: the position it was built to
    withdraw no longer exists (already withdrawn, in the transaction
    you showed in step 2). `wouldRevert: true` again, execution shows
    **Failed**. This is the safety mechanism catching a second genuine
    failure mode, not a scripting mistake - say so on camera.
12. Cut to the **Live proof** panel or the BaseScan tab from step 2 as
    the success evidence: this exact path, on this exact Safe, already
    completed successfully once, on-chain, before this recording.

## Shot list + voiceover (Option A)

| # | Approx. time | Shot | Voiceover |
|---|------|--------------------------|-----------|
| 1 | 0:00-0:12 | Homepage hero + Live proof panel | "This is Exit Keepa. It protects an Aave position on Base by watching a rate you set, and running the exit through your own Safe when it's crossed - KeeperHub is what actually executes it, and Zodiac Roles is what makes it safe to let KeeperHub do that." |
| 2 | 0:12-0:20 | BaseScan tab, Status: Success | "This already happened for real, on Base mainnet. Real USDC, withdrawn from Aave, back into this Safe - not a simulation. Keep this in mind, because I'm about to show you why this Safe won't withdraw again right now." |
| 3 | 0:20-0:28 | Click "Try the demo" → Dashboard loads populated | "No wallet needed to see the full flow. Same backend, same real Roles Modifier and Aave Pool underneath, and the demo Safe loads automatically." |
| 4 | 0:28-0:50 | Create strategy: oversized-withdrawal fields, Preview, Activate | "First, a strategy that should fail on its own terms - a withdrawal larger than this Safe could ever hold. Not rigged for show: it's the exact failure mode a real user hits if their position changed since they configured this." |
| 5 | 0:50-1:15 | Click "Run Exit Guardian" → wait → receipt panel showing Failed + revert reason | "Exit Guardian reads the live Aave rate from Base right now, checks the condition, runs a deterministic policy check, then simulates the real call through KeeperHub. It comes back reverted - refused, with the real reason, not a canned error. Nothing was broadcast." |
| 6 | 1:15-1:25 | Navigate to the already-completed strategy | "Now the strategy tied to that transaction I showed at the start." |
| 7 | 1:25-1:50 | Click "Run Exit Guardian" → wait → receipt panel showing Failed again | "Same real sequence - and it refuses again, for a different reason this time: that position was already withdrawn, on-chain, before I hit record. There's nothing left to take. That's not a bug in this demo - it's the same safety check catching a second genuine failure mode live." |
| 8 | 1:50-2:05 | Cut back to Live proof panel / BaseScan tab | "That's the actual proof: a live Aave position, a Safe that never gives up its keys, a Roles Modifier that limits KeeperHub to exactly one function, and a real, verifiable transaction on Base mainnet - the one this Safe already completed, which is exactly why it correctly refuses to do it again." |
| 9 | 2:05-2:15 (optional, if under time) | Quick flash of the GitHub repo or `docs/SUBMISSION.md` | "Full writeup and architecture are in the repo." |

## Autonomous vs. on-demand (say this explicitly, don't let it stay implicit)

By default the autonomous poller is off (`AGENT_POLL_ENABLED=false`) -
"Run Exit Guardian" is a manual click that runs the *identical*
evaluation code the poller would run on a timer. Two honest ways to
present shots 5 and 7:

- **If you keep the poller off (default, simplest to record):** say
  "clicking this runs the exact same autonomous decision code a
  scheduled loop would run - I'm just triggering it on demand instead of
  waiting" (already reflected in the voiceover above).
- **If you turn `AGENT_POLL_ENABLED=true` on before recording:** skip
  clicking "Run Exit Guardian" and instead let each strategy sit for up
  to 30 seconds after activation - the execution row appears on its own.
  This is a stronger "autonomous" demonstration and carries no broadcast
  risk (the poller's own code has no path to a real broadcast - see
  `agent/guardian.ts`/`agent/poller.ts`), but it evaluates *every* active
  strategy on the account, not just the demo ones, so turn it back off
  right after recording if you don't want it running unattended
  long-term.

## Backup / if something is slow or fails live

- **RPC read is slow on "Run Exit Guardian":** let it sit - it's a real
  `eth_call`, not instant. If it times out on camera, cut to the BaseScan
  proof tab and narrate over it instead of retrying live.
- **API is briefly unreachable:** fall back to narrating over the
  BaseScan proof tx and the code (`agent/policy.ts`, `execution/executor.ts`)
  rather than dead air waiting on a retry.
- **The Safe somehow does hold a position again** (someone re-funded it
  since this script was written) and step 11 simulates clean instead of
  refusing: that's fine, better even - narrate it as the real success
  case (see Option B above) and skip to showing the "Simulated, not
  sent" state and the unclicked broadcast button instead of a second
  refusal.
- Keep shot 2 (the BaseScan proof) as the one shot that must land even if
  everything else has to be cut for time - it's the actual evidence.

## After recording

- Upload the video and drop the link into the DoraHacks submission form
  alongside the pitch from `docs/SUBMISSION.md`.
- This script is not itself the submission video - a human records it.
