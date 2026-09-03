"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "../lib/wallet";
import { btnPrimary, btnSecondary, linkFocus } from "../lib/ui";
import { FeatureSwitcher } from "../components/FeatureSwitcher";
import { Faq } from "../components/Faq";
import { WalletConnectModal } from "../components/WalletConnectModal";

const PROOF_TX = "0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b";

// Positioned only in the gutter to the right of the (max-w-3xl) headline
// column, well inside the (max-w-5xl) hero's own box — never a negative
// offset, so nothing depends on viewport width beyond the lg breakpoint
// or risks pushing the page into horizontal scroll.
const HERO_BADGES = [
  { label: "Simulate-first", pos: "lg:right-2 lg:top-0", rotate: "rotate-3" },
  { label: "Zodiac Roles", pos: "lg:right-8 lg:top-24", rotate: "-rotate-6" },
  { label: "Sponsored gas", pos: "lg:right-0 lg:top-48", rotate: "-rotate-2" },
  { label: "No LLM in the loop", pos: "lg:right-10 lg:top-72", rotate: "rotate-2" },
];

const STATS = [
  { value: "1", label: "function the executor can ever call" },
  { value: "$0", label: "gas cost on the exit, sponsored" },
  { value: "182", label: "tests passing, run on every push" },
  { value: "0", label: "LLM calls anywhere in the decision path" },
];

const PIPELINE = [
  {
    step: "1",
    who: "Your Safe",
    what: "Holds the funds and the Aave position, start to finish. It never sends its private key anywhere.",
  },
  {
    step: "2",
    who: "Zodiac Roles Modifier",
    what: "Pre-authorizes one narrow slice of power: withdraw(asset, amount, to) on the Aave Pool, asset locked to USDC, recipient locked to this exact Safe.",
  },
  {
    step: "3",
    who: "KeeperHub",
    what: "The only thing that ever broadcasts. Simulates the exact call against live chain state first. Broadcast only unlocks after that comes back clean.",
  },
  {
    step: "4",
    who: "Aave v3 Pool",
    what: "Executes the withdraw. USDC lands back in the Safe that owned it the whole time.",
  },
];

const GUARANTEES = [
  {
    title: "Scoped, not trusted",
    body: "KeeperHub's permission is enforced onchain by the Roles Modifier itself: one function, one contract, one recipient. Not a promise in a README.",
  },
  {
    title: "Simulate before it's real",
    body: "Every exit is dry-run against live chain state through KeeperHub first. Broadcast only unlocks once that simulation comes back clean.",
  },
  {
    title: "Deterministic, always",
    body: "The policy check is plain boolean and arithmetic comparisons: no model, no prompt, nothing that could interpret a condition differently twice.",
  },
  {
    title: "Wallet-authenticated",
    body: "Ownership is a real EIP-191 signature, recovered server-side. You can only ever act on a Safe you actually registered.",
  },
  {
    title: "Receipts, not self-reports",
    body: "Success is only ever recorded once a receipt independently re-fetched from the chain confirms it, never from a hash alone.",
  },
  {
    title: "Revocable anytime",
    body: "The Roles permission lives on your Safe. Editing or revoking it takes effect immediately, no coordination with Exit Keepa required.",
  },
];

export default function HomePage() {
  const { address, connecting, error, enterDemoMode } = useWallet();
  const router = useRouter();
  const [startingDemo, setStartingDemo] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  async function startDemo() {
    setStartingDemo(true);
    try {
      await enterDemoMode();
      router.push("/dashboard");
    } catch {
      // enterDemoMode already recorded this in useWallet()'s error state,
      // shown next to the button below - nothing further to do here except
      // make sure the button re-enables instead of staying stuck.
    } finally {
      setStartingDemo(false);
    }
  }

  return (
    <main className="space-y-28">
      {/* Hero */}
      <section className="relative space-y-5 pb-4 pt-6 text-center sm:text-left">
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          {HERO_BADGES.map((b) => (
            <span
              key={b.label}
              className={`absolute ${b.pos} ${b.rotate} rounded-full border border-cream-100/15 bg-forest-800/90 px-3 py-1.5 text-xs font-medium text-cream-200 shadow-lg backdrop-blur-sm`}
            >
              {b.label}
            </span>
          ))}
        </div>

        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-cream-100/15 bg-forest-800/60 px-3 py-1 text-xs font-medium text-cream-300">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          Live on Base, real Aave withdrawals
        </span>
        <h1 className="text-balance relative mx-auto max-w-3xl font-display text-4xl font-bold leading-tight text-cream-50 sm:mx-0 sm:text-5xl lg:text-6xl">
          Set your exit <span className="font-accent italic text-mint-400">once</span>. Never miss it again.
        </h1>
        <p className="text-pretty mx-auto max-w-2xl text-lg text-cream-300 sm:mx-0">
          Exit Keepa watches your Aave USDC position for the rate you choose. The moment it&apos;s hit, a
          pre-approved withdrawal runs through your own Safe, automatically.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          {address ? (
            <Link href="/dashboard" className={btnPrimary}>
              Go to dashboard
            </Link>
          ) : (
            <>
              <button onClick={() => setWalletModalOpen(true)} disabled={connecting} className={btnPrimary}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
              <WalletConnectModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
              <button onClick={startDemo} disabled={startingDemo} className={btnSecondary}>
                {startingDemo ? "Starting demo…" : "Try the demo, no wallet needed"}
              </button>
            </>
          )}
        </div>
        {error && !walletModalOpen && <p className="text-pretty relative text-sm text-danger">{error}</p>}
      </section>

      {/* Stats strip */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-cream-100/10 bg-cream-100/10 sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="bg-forest-950 px-4 py-6 text-center sm:px-5">
            <p className="data-mono font-display text-3xl font-bold text-mint-400">{s.value}</p>
            <p className="text-pretty mt-1 text-xs text-cream-400">{s.label}</p>
          </div>
        ))}
      </section>

      {/* Live proof */}
      <section className="rounded-xl border border-mint-400/25 bg-forest-800/60 p-6 sm:p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-mint-400">Proof, not promises</span>
        </div>
        <h2 className="text-balance mb-2 font-display text-xl font-bold text-cream-50">
          This <span className="font-accent italic text-mint-400">already</span> happened on Base
        </h2>
        <p className="text-pretty max-w-2xl text-sm text-cream-300">
          This isn&apos;t a demo. Exit Keepa&apos;s full path, from your Safe through Zodiac Roles to KeeperHub,
          withdrew real USDC from Aave and sent it back to the Safe that owns it. Check it yourself, right now.
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
          <p className="text-cream-300">Result: success. USDC returned to the Safe.</p>
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
          <h2 className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">
            How it <span className="font-accent italic text-mint-400">works</span>
          </h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">
            Three steps. Each one you can verify for yourself.
          </p>
        </div>
        <FeatureSwitcher />
      </section>

      {/* Under the hood — the literal pipeline */}
      <section>
        <div className="mb-8 text-center">
          <h2 className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">
            What <span className="font-accent italic text-mint-400">actually</span> runs, in order
          </h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">
            No step is hidden behind &quot;magic.&quot; Here&apos;s the literal call chain, once your condition is
            hit.
          </p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((p, i) => (
            <li key={p.step} className="relative rounded-xl border border-cream-100/10 bg-forest-800/60 p-5">
              <span className="data-mono font-display text-2xl font-bold text-mint-400/50">{p.step}</span>
              <h3 className="mt-2 font-semibold text-cream-50">{p.who}</h3>
              <p className="text-pretty mt-1.5 text-sm text-cream-300">{p.what}</p>
              {i < PIPELINE.length - 1 && (
                <span
                  className="absolute -right-4 top-1/2 hidden -translate-y-1/2 text-cream-500 sm:block lg:right-[-1.1rem]"
                  aria-hidden="true"
                >
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Safety guarantees */}
      <section>
        <div className="mb-8 text-center">
          <h2 className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">
            Why it&apos;s <span className="font-accent italic text-mint-400">safe</span> to let this run
          </h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">
            Six guarantees, each one you can go check in the code or on the chain, not a marketing claim.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GUARANTEES.map((g) => (
            <div key={g.title} className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-5">
              <h3 className="mb-1.5 font-semibold text-cream-50">{g.title}</h3>
              <p className="text-pretty text-sm text-cream-300">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* For judges */}
      <section className="rounded-xl border border-warning/30 bg-warning/5 p-6">
        <h2 className="mb-2 font-semibold text-warning">Trying this without a wallet?</h2>
        <p className="text-pretty text-sm text-cream-300">
          Click <strong className="text-cream-100">&quot;Try the demo&quot;</strong> above to get your own private
          sandbox Safe, build a strategy, and walk the full flow end to end. No wallet extension, no funds at risk,
          and no two visitors ever share the same demo Safe. Its Roles permission reads as ready and simulating a
          strategy is mocked and clearly labeled as such - it isn&apos;t deployed on any real chain. The BaseScan
          proof above is separate and genuinely real: it&apos;s the transaction from this project&apos;s own
          verified Safe, not something your demo session touches.
        </p>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="mb-8 text-center font-display text-2xl font-bold text-cream-50 sm:text-3xl">
          Common questions
        </h2>
        <Faq />
      </section>

      {/* Closing CTA */}
      <section className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-8 text-center sm:p-12">
        <h2 className="text-balance mx-auto max-w-xl font-display text-2xl font-bold text-cream-50 sm:text-3xl">
          Your Safe already knows how to protect itself. <span className="font-accent italic text-mint-400">Give it the order.</span>
        </h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {address ? (
            <Link href="/dashboard" className={btnPrimary}>
              Go to dashboard
            </Link>
          ) : (
            <button onClick={startDemo} disabled={startingDemo} className={btnPrimary}>
              {startingDemo ? "Starting demo…" : "Try the demo, no wallet needed"}
            </button>
          )}
        </div>
        {error && !walletModalOpen && <p className="text-pretty mt-3 text-sm text-danger">{error}</p>}
      </section>
    </main>
  );
}
