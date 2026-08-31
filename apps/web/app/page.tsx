"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";
import { btnPrimary, btnSecondary, linkFocus } from "../lib/ui";
import { FeatureSwitcher } from "../components/FeatureSwitcher";
import { Faq } from "../components/Faq";

const PROOF_TX = "0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b";

export default function HomePage() {
  const { address, connect, connecting, enterDemoMode } = useWallet();

  return (
    <main className="space-y-24">
      {/* Hero */}
      <section className="space-y-5 pt-6 text-center sm:text-left">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cream-100/15 bg-forest-800/60 px-3 py-1 text-xs font-medium text-cream-300">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          Live on Base — Aave v3 USDC exits
        </span>
        <h1 className="text-balance mx-auto max-w-3xl font-display text-4xl font-bold leading-tight text-cream-50 sm:mx-0 sm:text-5xl">
          Protect your DeFi position before rates turn against you.
        </h1>
        <p className="text-pretty mx-auto max-w-2xl text-lg text-cream-300 sm:mx-0">
          Set the condition once. Exit Keepa watches it and prepares the exit — executed through your own Safe,
          never through us.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          {address ? (
            <Link href="/dashboard" className={btnPrimary}>
              Go to dashboard
            </Link>
          ) : (
            <>
              <button onClick={connect} disabled={connecting} className={btnPrimary}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
              <Link href="/dashboard" onClick={enterDemoMode} className={btnSecondary}>
                Try the demo — no wallet needed
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Live proof */}
      <section className="rounded-xl border border-mint-400/25 bg-forest-800/60 p-6 sm:p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-mint-400">Verified onchain proof</span>
        </div>
        <h2 className="text-balance mb-2 font-display text-xl font-bold text-cream-50">
          A real exit, already executed on Base
        </h2>
        <p className="text-pretty max-w-2xl text-sm text-cream-300">
          This exact path — Safe → Zodiac Roles → KeeperHub simulate → broadcast — already executed a real Aave v3
          USDC withdraw on Base mainnet. Not a mock, not a testnet run: an onchain transaction anyone can check
          independently, right now.
        </p>
        <div className="data-mono mt-4 space-y-1.5 rounded-lg bg-forest-950/60 p-4 font-mono text-xs text-cream-200">
          <p className="break-all">
            <span className="text-cream-400">Tx: </span>
            <a
              href={`https://basescan.org/tx/${PROOF_TX}`}
              target="_blank"
              rel="noreferrer"
              className={`text-mint-300 underline hover:text-mint-200 ${linkFocus}`}
            >
              {PROOF_TX}
            </a>
          </p>
          <p className="text-cream-300">Result: success (receipt status 0x1) — USDC returned to the Safe</p>
        </div>
        <a
          href={`https://basescan.org/tx/${PROOF_TX}`}
          target="_blank"
          rel="noreferrer"
          className={`mt-4 inline-flex ${btnSecondary}`}
        >
          Verify on BaseScan →
        </a>
      </section>

      {/* Feature switcher */}
      <section>
        <div className="mb-8 text-center">
          <h2 className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">How it works</h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">
            Three steps, each one verifiable on its own — from setting your condition to a permission-scoped
            broadcast.
          </p>
        </div>
        <FeatureSwitcher />
      </section>

      {/* Plain-language + technical layer */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-6">
          <h3 className="mb-2 font-semibold text-cream-50">In plain terms</h3>
          <p className="text-pretty text-sm text-cream-300">
            Exit Keepa watches for the condition you defined and prepares the exit. It never holds your funds or
            your keys — your Safe stays in control the whole time.
          </p>
        </div>
        <div className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-6">
          <h3 className="mb-2 font-semibold text-cream-50">Technically</h3>
          <p className="text-pretty text-sm text-cream-300">
            Execution is routed through KeeperHub and constrained by a Zodiac Roles Modifier before it ever reaches
            your Safe — the role can call exactly one function, on one contract, with the recipient fixed to your
            Safe.
          </p>
        </div>
      </section>

      {/* For judges */}
      <section className="rounded-xl border border-warning/30 bg-warning/5 p-6">
        <h2 className="mb-2 font-semibold text-warning">For judges: a safe way to try this</h2>
        <p className="text-pretty text-sm text-cream-300">
          No wallet? Click <strong className="text-cream-100">&quot;Try the demo&quot;</strong> above to register a
          Safe, create a strategy, and inspect/simulate the exact transaction Exit Keepa would run — all without any
          funds at risk or a wallet extension. The demo Safe is pre-fillable on the Dashboard. Real execution
          requires a Safe that (a) holds a real USDC supply position on Aave v3 Base and (b) has the narrow Roles
          permission actually granted onchain — both are already true for the demo Safe, which is why the proof
          above is real, not simulated.
        </p>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="mb-8 text-center font-display text-2xl font-bold text-cream-50 sm:text-3xl">
          Frequently asked
        </h2>
        <Faq />
      </section>
    </main>
  );
}
