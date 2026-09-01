# Demo video script

For a human to record. Target length: **90–120 seconds**. Screen capture +
voiceover, no editing tricks required — every shot is a real click on the
live site. Practice the click path once against
[`JUDGE_DEMO.md`](JUDGE_DEMO.md) before recording so nothing stalls on a
slow RPC response.

**Do not click "Confirm broadcast" during recording** — the demo Safe's
position was already withdrawn once (see the Live proof link); a second
broadcast is a real mainnet transaction and isn't needed to prove the
claim.

## Setup before hitting record

- Have **https://exit-keepa-web.vercel.app** open, logged out (fresh tab
  or private window), so "Try the demo" is visible.
- Have a second tab open to the BaseScan proof link, ready to alt-tab to:
  https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b
- Zoom the browser to ~110–125% so on-screen text is readable in a
  recording.

## Shot list + voiceover

| # | Time | Shot (what's on screen) | Voiceover |
|---|------|--------------------------|-----------|
| 1 | 0:00–0:12 | Homepage hero + "Live proof" panel, cursor hovering the Basescan link | "This is Exit Keepa. It protects an Aave position on Base by watching a rate you set, and running the exit through your own Safe when it's crossed — KeeperHub is what actually executes it, and Zodiac Roles is what makes it safe to let KeeperHub do that." |
| 2 | 0:12–0:20 | Click "Verify on BaseScan →", let the BaseScan tx page load, scroll to show Status: Success | "This already happened for real, on Base mainnet. Real USDC, withdrawn from Aave, back into this Safe — not a simulation, and not something I'm about to re-trigger for this video." |
| 3 | 0:20–0:30 | Back to app, click "Try the demo, no wallet needed" → land on Dashboard | "No wallet needed to see the full flow. This is demo mode — a fixed identity, same backend, same real Roles Modifier and Aave Pool underneath." |
| 4 | 0:30–0:42 | Click "Fill in the live demo Safe" → show the pre-filled Safe / Roles Modifier / role key fields → "Save Safe" | "This Safe, Roles Modifier, and role key are the real onchain values — not placeholders. Saving just registers them with Exit Keepa; nothing onchain changes yet." |
| 5 | 0:42–0:55 | Open the existing strategy (the one tied to the completed withdraw) → point at the strategy detail page's transaction preview (target, function, decoded args) | "Before anything runs, Exit Keepa shows the exact transaction it would send — the real Aave Pool address, the real `withdraw` selector, the real decoded arguments. This is rebuilt server-side from the saved strategy every time, never trusted from the browser." |
| 6 | 0:55–1:10 | Click "Run Exit Guardian" → wait for the result → show the decision receipt panel (observed rate, policy check, simulation result) | "Run Exit Guardian and it does the real thing: reads the live Aave rate from Base right now, checks it against the condition, runs a deterministic policy check — right chain, right contract, right function — and then simulates the actual call through KeeperHub against the real Roles Modifier. Every one of these numbers is inspectable in the receipt, not just a label." |
| 7 | 1:10–1:20 | Point at the "Simulated, not sent" state and the disabled/optional "Execute (broadcast)" button, without clicking it | "Simulation came back clean, so a broadcast button appears — but I'm not clicking it. This Safe's position was already withdrawn for real, in the transaction I showed at the start, through this exact same path." |
| 8 | 1:20–1:35 | Cut back to the homepage Live proof panel / footer "See the proof" link | "That's the integration end to end: a live Aave position, a Safe that never gives up its keys, a Roles Modifier that limits KeeperHub to exactly one function, and a real, verifiable transaction on Base mainnet to show for it." |
| 9 | 1:35–1:45 (optional, if under time) | Quick flash of `docs/SUBMISSION.md` or the GitHub repo | "Full writeup, architecture, and the honest list of what's still unfinished are in the repo's SUBMISSION doc." |

## Backup / if something is slow or fails live

- **RPC read is slow on "Run Exit Guardian":** let it sit — it's a real
  `eth_call`, not instant. If it times out on camera, cut to the BaseScan
  proof tab and narrate over it instead of retrying live.
- **API is briefly unreachable:** fall back to narrating over the
  BaseScan proof tx and the code (`agent/policy.ts`, `execution/executor.ts`)
  rather than dead air waiting on a retry.
- Keep shot 2 (the BaseScan proof) as the one shot that must land even if
  everything else has to be cut for time — it's the actual evidence.

## After recording

- Upload the video and drop the link into the DoraHacks submission form
  alongside the pitch from `docs/SUBMISSION.md`.
- This script is not itself the submission video — a human records it.
