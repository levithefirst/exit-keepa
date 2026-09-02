# Demo video script

For a human to record. Target length: **120-150 seconds**.

**Read this first — demo mode was rebuilt since the last version of this
script.** Every "Try demo" click now auto-provisions a brand-new, private
sandbox Safe for that session alone — never the project's own real Safe,
and never shared with any other visitor. That's a deliberate fix: the
previous version let every visitor see and act on the same real Safe. One
consequence: the sandbox's final "simulate" step is necessarily mocked
(clearly labeled `sandbox: true` in the receipt) rather than a real
KeeperHub call, since a sandbox Safe has no real Roles Modifier deployed
for KeeperHub to check against. Everything upstream of that — the live
Aave rate read, the condition check, the policy check, the exact
transaction preview — is genuinely real. This script is written around
that, not around the old shared-Safe flow.

The two historical **refusals** referenced in shot 5 below (an oversized
withdrawal amount, and an already-empty position) are real, already-
recorded events from this project's own verification work against its
real Safe — narrate them from the receipts/BaseScan evidence rather than
re-triggering them live, since reproducing them now requires a real,
non-sandbox Safe this recording doesn't connect to.

**Do not click "Confirm broadcast" during recording.** The sandbox never
reaches a state where it does anything (broadcast is refused outright by
the API for a sandbox Safe), so there's no risk either way.

## Setup before hitting record

- Have **https://exit-keepa-web.vercel.app** open, logged out (fresh tab
  or private window), so "Try the demo" is visible.
- Have a second tab open to the BaseScan proof link, ready to alt-tab to:
  https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b
- Zoom the browser to ~110-125% so on-screen text is readable in a
  recording.

## Exact click-through order

1. Homepage: `https://exit-keepa-web.vercel.app`
2. Click **"Verify on BaseScan →"** in the Live proof panel → confirm
   `Status: Success` on the BaseScan tab → switch back to the app tab
   (don't navigate away from it, just alt-tab).
3. Click **"Try the demo, no wallet needed"** in the hero.
4. You land on **Dashboard** - your own private sandbox Safe is already
   populated (a synthetic address, Roles permission already reading
   "ready"). No manual entry needed, and nothing here is shared with
   anyone else who tries the demo.
5. Click **"+ New strategy"**. Fill the form for a condition that's
   clearly already true right now (e.g. comparator **"is below"**,
   threshold **`100`** - supply APR is never 100%+), amount **"Withdraw
   everything"**. Click **Preview transaction** → click **Activate
   strategy** on the review screen.
6. On the newly-activated strategy's detail page, click **"Run Exit
   Guardian"**.
7. **Wait for the result.** Expected: the receipt panel shows the
   observed live Aave rate, the condition is met, every policy check
   passes, and the execution shows **Simulated, not sent**. Open
   **"Inspect the full receipt"** and point at the `sandbox: true` note
   in the simulation result - say plainly that this one step is mocked
   because there's no real Roles Modifier for a sandbox Safe to check
   against, and that everything above it (the rate, the condition, the
   policy check, the exact transaction) is real.
8. Cut to the **Live proof** panel or the BaseScan tab from step 2: this
   exact pipeline, on this project's own real Safe, already completed a
   real withdrawal on-chain - narrate that it also correctly refused
   twice before that, for real reasons (an oversized configured amount,
   then an already-empty position), each caught by the same policy/
   simulate checks shown live in step 7, just against real chain state
   instead of a sandbox.

## Shot list + voiceover

| # | Approx. time | Shot | Voiceover |
|---|------|--------------------------|-----------|
| 1 | 0:00-0:12 | Homepage hero + Live proof panel | "This is Exit Keepa. It protects an Aave position on Base by watching a rate you set, and running the exit through your own Safe when it's crossed - KeeperHub is what actually executes it, and Zodiac Roles is what makes it safe to let KeeperHub do that." |
| 2 | 0:12-0:20 | BaseScan tab, Status: Success | "This already happened for real, on Base mainnet. Real USDC, withdrawn from Aave, back into this project's own Safe - not a simulation." |
| 3 | 0:20-0:28 | Click "Try the demo" → Dashboard loads populated | "No wallet needed. Every visitor who clicks this gets their own private sandbox Safe, isolated from everyone else - nobody sees my real Safe or anyone else's session." |
| 4 | 0:28-0:45 | Create strategy: fields, Preview, Activate | "A strategy: exit USDC from Aave once supply APR crosses a rate I choose. The transaction preview here is the exact real calldata this would send." |
| 5 | 0:45-1:10 | Click "Run Exit Guardian" → wait → receipt panel showing Simulated | "Exit Guardian reads the live Aave rate from Base right now - a real RPC call - checks my condition, and runs the same deterministic policy check a real strategy uses. The one thing that can't be real in a sandbox is the final onchain simulate, since there's no real Roles Modifier here to check against - so it's mocked, and labeled exactly that in the receipt. Everything above it just ran for real." |
| 6 | 1:10-1:30 | Cut back to Live proof panel / BaseScan tab | "That's why the proof that matters is this: a real Safe, a real Roles Modifier limiting KeeperHub to exactly one function, and a real, verifiable transaction on Base mainnet. Along the way, this same pipeline also correctly refused twice for real - once when a configured amount exceeded the Safe's position, once when the position was already empty - the same checks you just watched run live." |
| 7 | 1:30-1:45 (optional, if under time) | Quick flash of the GitHub repo or `docs/SUBMISSION.md` | "Full writeup and architecture are in the repo." |

## Backup / if something is slow or fails live

- **RPC read is slow on "Run Exit Guardian":** let it sit - it's a real
  `eth_call`, not instant. If it times out on camera, cut to the BaseScan
  proof tab and narrate over it instead of retrying live.
- **API is briefly unreachable:** fall back to narrating over the
  BaseScan proof tx and the code (`agent/policy.ts`, `execution/executor.ts`,
  `execution/simulate.ts`) rather than dead air waiting on a retry.
- Keep shot 2 (the BaseScan proof) as the one shot that must land even if
  everything else has to be cut for time - it's the actual evidence.

## After recording

- Upload the video and drop the link into the DoraHacks submission form
  alongside the pitch from `docs/SUBMISSION.md`.
- This script is not itself the submission video - a human records it.
