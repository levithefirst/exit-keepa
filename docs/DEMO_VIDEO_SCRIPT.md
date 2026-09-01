# Demo video script

For a human to record. Target length: **150-180 seconds** (this session
expanded it from an earlier 90-120s draft that skipped the refusal case
entirely - fitting a real refusal *and* a real success *and* the
on-chain proof honestly needs the extra time, not a shortcut). Screen
capture + voiceover, no editing tricks required - every shot is a real
click on the live site. Practice the click path once against
[`JUDGE_DEMO.md`](JUDGE_DEMO.md) before recording so nothing stalls on a
slow RPC response.

**Do not click "Confirm broadcast" during recording** - the demo Safe's
position was already withdrawn once (see the Live proof link); a second
broadcast is a real mainnet transaction and isn't needed to prove the
claim.

## Setup before hitting record

- Have **https://exit-keepa-web.vercel.app** open, logged out (fresh tab
  or private window), so "Try the demo" is visible.
- Have a second tab open to the BaseScan proof link, ready to alt-tab to:
  https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b
- Zoom the browser to ~110-125% so on-screen text is readable in a
  recording.
- Decide up front whether you're recording with the autonomous poller on
  or off (see "Autonomous vs. on-demand" below) - it changes shot 6's
  script slightly.

## Exact click-through order

1. Homepage: `https://exit-keepa-web.vercel.app`
2. Click **"Verify on BaseScan →"** in the Live proof panel → confirm
   `Status: Success` on the BaseScan tab → switch back to the app tab
   (don't navigate away from it, just alt-tab).
3. Click **"Try the demo, no wallet needed"** in the hero.
4. You land on **Dashboard** - the live-proof Safe is already populated
   (Safe address, Roles Modifier, balances). No manual entry needed.
5. Click **"+ New strategy"**.
6. Fill the form for the **refusal case**:
   - Name: anything, e.g. "Oversized withdrawal test"
   - Trigger: comparator **"is below"**, threshold **`100`** (100% -
     supply APR is never that high, so the condition is already true)
   - Amount: select **"Withdraw an exact amount"**, enter
     **`999999000000`** (999,999 USDC in smallest units - clearly larger
     than the Safe could hold)
   - Click **Preview transaction** → click **Activate strategy** on the
     review screen.
7. On the newly-activated strategy's detail page, click **"Run Exit
   Guardian"**.
8. **Wait for the result.** Expected: the receipt panel shows the
   observed live Aave rate, the condition is met, every policy check
   passes - and the automatic simulation comes back `wouldRevert: true`.
   The execution shows **Failed**, with the real revert reason (the Safe
   doesn't hold that much). Point at **"Inspect the full receipt"** -
   every number on screen is independently checkable there.
9. Go back to **Dashboard**, open the **other** strategy - the one tied
   to the already-completed withdraw (or, if none exists yet in this
   demo session, create a fresh one with amount **"Withdraw everything"**
   instead of an exact number, which self-limits to whatever the Safe
   actually holds).
10. Click **"Run Exit Guardian"** again.
11. **Wait for the result.** Expected: same observe → decide →
    policy-check sequence, this time `wouldRevert: false`. The execution
    lands on **"Simulated, not sent"** automatically. An **"Execute
    (broadcast)"** button appears below it.
12. Point at that button **without clicking it**.
13. Cut back to the homepage **Live proof** panel, or the BaseScan tab
    from step 2.

## Shot list + voiceover

| # | Approx. time | Shot | Voiceover |
|---|------|--------------------------|-----------|
| 1 | 0:00-0:12 | Homepage hero + Live proof panel | "This is Exit Keepa. It protects an Aave position on Base by watching a rate you set, and running the exit through your own Safe when it's crossed - KeeperHub is what actually executes it, and Zodiac Roles is what makes it safe to let KeeperHub do that." |
| 2 | 0:12-0:20 | BaseScan tab, Status: Success | "This already happened for real, on Base mainnet. Real USDC, withdrawn from Aave, back into this Safe - not a simulation." |
| 3 | 0:20-0:28 | Click "Try the demo" → Dashboard loads populated | "No wallet needed to see the full flow. This is demo mode - same backend, same real Roles Modifier and Aave Pool underneath, and the demo Safe loads automatically." |
| 4 | 0:28-0:50 | Create strategy: oversized-withdrawal fields, Preview, Activate | "First, I'm setting up a strategy that should fail - a withdrawal larger than this Safe actually holds. This isn't rigged to fail for show: it's the exact failure mode a real user hits if their position changed since they configured this." |
| 5 | 0:50-1:15 | Click "Run Exit Guardian" → wait → receipt panel showing Failed + revert reason | "Exit Guardian reads the live Aave rate from Base right now, checks the condition, runs a deterministic policy check, then simulates the real call through KeeperHub. It comes back reverted - the Safe doesn't hold that much - and Exit Guardian reports it as a real refusal, not a canned error. Nothing was broadcast." |
| 6 | 1:15-1:25 | Navigate to the already-completed strategy | "Now the strategy that already succeeded - same rate, same Safe, a withdrawal size that actually fits." |
| 7 | 1:25-1:45 | Click "Run Exit Guardian" → wait → receipt panel showing Simulated clean | "Same sequence - and this time the simulation comes back clean. The execution moves to 'Simulated, not sent.' Exit Guardian never broadcasts on its own; a broadcast button appears, but I'm not clicking it." |
| 8 | 1:45-1:55 | Point at the disabled/unclicked "Execute (broadcast)" button | "This Safe's position was already withdrawn for real, through this exact path, before this video - a second broadcast isn't needed to prove the claim." |
| 9 | 1:55-2:10 | Cut back to Live proof panel / BaseScan tab | "That's the integration end to end: a live Aave position, a Safe that never gives up its keys, a Roles Modifier that limits KeeperHub to exactly one function, and a real, verifiable transaction on Base mainnet to show for it." |
| 10 | 2:10-2:20 (optional, if under time) | Quick flash of the GitHub repo or `docs/SUBMISSION.md` | "Full writeup and architecture are in the repo." |

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
  clicking "Run Exit Guardian" and instead let the strategy sit for up
  to 30 seconds after activation - the execution row appears on its own.
  This is a stronger "autonomous" demonstration and carries no broadcast
  risk (the poller's own code has no path to a real broadcast - see
  `agent/guardian.ts`/`agent/poller.ts`), but it evaluates *every* active
  strategy on the account, not just the demo one, so turn it back off
  right after recording if you don't want it running unattended
  long-term.

## Backup / if something is slow or fails live

- **RPC read is slow on "Run Exit Guardian":** let it sit - it's a real
  `eth_call`, not instant. If it times out on camera, cut to the BaseScan
  proof tab and narrate over it instead of retrying live.
- **API is briefly unreachable:** fall back to narrating over the
  BaseScan proof tx and the code (`agent/policy.ts`, `execution/executor.ts`)
  rather than dead air waiting on a retry.
- Keep shot 2 (the BaseScan proof) as the one shot that must land even if
  everything else has to be cut for time - it's the actual evidence.

## After recording

- Upload the video and drop the link into the DoraHacks submission form
  alongside the pitch from `docs/SUBMISSION.md`.
- This script is not itself the submission video - a human records it.
