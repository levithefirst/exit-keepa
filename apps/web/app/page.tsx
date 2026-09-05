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

const HERO_BADGES = [
  { label: "Simulate-first", pos: "lg:right-2 lg:top-0", rotate: "rotate-3" },
  { label: "Zodiac Roles", pos: "lg:right-8 lg:top-24", rotate: "-rotate-6" },
  { label: "Sponsored gas", pos: "lg:right-0 lg:top-48", rotate: "-rotate-2" },
  { label: "No LLM in the loop", pos: "lg:right-10 lg:top-72", rotate: "rotate-2" },
];

const STATS = [
  { value: "1", label: "function the executor can ever call" },
  { value: "$0", label: "gas cost on the exit, sponsored" },
  { value: "222", label: "tests passing in the current build" },
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
    what: "The execution layer. Exit Keepa prepares and simulates the exact permitted call before the execution path proceeds.",
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
    body: "The Safe's permission boundary restricts the executor to the permitted action. One function, one protocol contract, one recipient.",
  },
  {
    title: "Simulate before it's real",
    body: "Every autonomous exit is simulated before execution. If the simulation does not pass, the exit stops.",
  },
  {
    title: "Deterministic, always",
    body: "The policy check is plain boolean and arithmetic comparisons. No model or prompt decides whether the condition is met.",
  },
  {
    title: "Your wallet stays yours",
    body: "Exit Keepa never receives a Safe private key or seed phrase. Authorization is performed by the Safe's owners.",
  },
  {
    title: "Receipts, not self-reports",
    body: "A completed real execution is verified from the resulting chain state and receipt rather than treating a submitted transaction hash as proof.",
  },
  {
    title: "Revocable",
    body: "The permission lives on your Safe. Its owners can edit or revoke the authorization without giving Exit Keepa custody of the Safe.",
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
      // enterDemoMode already records this in useWallet()'s error state.
    } finally {
      setStartingDemo(false);
    }
  }

  return (
    <main className="space-y-28">
      <section className="relative space-y-5 pb-4 pt-6 text-center sm:text-left" aria-labelledby="hero-title">
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          {HERO_BADGES.map((b) => (
            <span key={b.label} className={`absolute ${b.pos} ${b.rotate} rounded-full border border-cream-100/15 bg-forest-800/90 px-3 py-1.5 text-xs font-medium text-cream-200 shadow-lg backdrop-blur-sm`}>
              {b.label}
            </span>
          ))}
        </div>

        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-cream-100/15 bg-forest-800/60 px-3 py-1 text-xs font-medium text-cream-300">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" aria-hidden="true" />
          Live on Base, real Aave withdrawals
        </span>
        <h1 id="hero-title" className="text-balance relative mx-auto max-w-3xl font-display text-4xl font-bold leading-tight text-cream-50 sm:mx-0 sm:text-5xl lg:text-6xl">
          Set your exit. <span className="font-accent italic text-mint-400">Walk away.</span>
        </h1>
        <p className="text-pretty mx-auto max-w-2xl text-lg text-cream-300 sm:mx-0">
          Exit Keepa watches your DeFi position and automatically executes the permitted exit when your condition is met.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          {address ? (
            <Link href="/dashboard" className={btnPrimary}>Go to dashboard</Link>
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

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-cream-100/10 bg-cream-100/10 sm:grid-cols-4" aria-label="Project facts">
        {STATS.map((s) => (
          <div key={s.label} className="bg-forest-950 px-4 py-6 text-center sm:px-5">
            <p className="data-mono font-display text-3xl font-bold text-mint-400">{s.value}</p>
            <p className="text-pretty mt-1 text-xs text-cream-400">{s.label}</p>
          </div>
        ))}
      </section>

      <section id="proof" className="scroll-mt-24 rounded-xl border border-mint-400/25 bg-forest-800/60 p-6 sm:p-8" aria-labelledby="proof-title">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-mint-400" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide text-mint-400">Proof, not promises</span>
        </div>
        <h2 id="proof-title" className="text-balance mb-2 font-display text-xl font-bold text-cream-50">
          A real execution you can verify
        </h2>
        <p className="text-pretty max-w-2xl text-sm text-cream-300">
          Exit Keepa has completed the full path from a Safe through the permission boundary and KeeperHub to a real Aave withdrawal on Base. Check the transaction yourself.
        </p>
        <div className="data-mono mt-4 space-y-1.5 rounded-lg bg-forest-950/60 p-4 font-mono text-xs text-cream-200">
          <p className="break-all">
            <span className="text-cream-400">Tx: </span>
            <a href={`https://basescan.org/tx/${PROOF_TX}`} target="_blank" rel="noreferrer" className={`text-mint-300 underline hover:text-mint-200 ${linkFocus}`}>
              {PROOF_TX}
            </a>
          </p>
          <p className="text-cream-300">Result: success. USDC returned to the Safe.</p>
        </div>
        <a href={`https://basescan.org/tx/${PROOF_TX}`} target="_blank" rel="noreferrer" className={`mt-4 inline-flex ${btnSecondary}`}>
          Verify on BaseScan →
        </a>
      </section>

      <section id="how-it-works" className="scroll-mt-24" aria-labelledby="how-title">
        <div className="mb-8 text-center">
          <h2 id="how-title" className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">
            How it <span className="font-accent italic text-mint-400">works</span>
          </h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">Define the condition, authorize the exit, then let the system watch.</p>
        </div>
        <FeatureSwitcher />
      </section>

      <section id="product" className="scroll-mt-24" aria-labelledby="pipeline-title">
        <div className="mb-8 text-center">
          <h2 id="pipeline-title" className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">
            What <span className="font-accent italic text-mint-400">actually</span> runs, in order
          </h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">The autonomous lifecycle after your condition is met.</p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((p, i) => (
            <li key={p.step} className="relative rounded-xl border border-cream-100/10 bg-forest-800/60 p-5">
              <span className="data-mono font-display text-2xl font-bold text-mint-400/50" aria-hidden="true">{p.step}</span>
              <h3 className="mt-2 font-semibold text-cream-50">{p.who}</h3>
              <p className="text-pretty mt-1.5 text-sm text-cream-300">{p.what}</p>
              {i < PIPELINE.length - 1 && (
                <span className="absolute -right-4 top-1/2 hidden -translate-y-1/2 text-cream-500 sm:block lg:right-[-1.1rem]" aria-hidden="true">→</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section id="security" className="scroll-mt-24" aria-labelledby="security-title">
        <div className="mb-8 text-center">
          <h2 id="security-title" className="text-balance font-display text-2xl font-bold text-cream-50 sm:text-3xl">
            Why the <span className="font-accent italic text-mint-400">permission</span> is narrow
          </h2>
          <p className="text-pretty mx-auto mt-2 max-w-xl text-cream-300">The security model is part of the product, not a footnote.</p>
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

      <section id="keeperhub" className="scroll-mt-24 rounded-xl border border-cream-100/10 bg-forest-800/60 p-6 sm:p-8" aria-labelledby="keeperhub-title">
        <p className="text-xs font-semibold uppercase tracking-wide text-mint-400">KeeperHub</p>
        <h2 id="keeperhub-title" className="mt-2 font-display text-2xl font-bold text-cream-50">Exit Keepa decides when. KeeperHub handles the execution path.</h2>
        <p className="text-pretty mt-3 max-w-2xl text-sm text-cream-300">
          Exit Keepa watches the condition, checks the policy, builds the deterministic transaction and prepares the simulation. KeeperHub is the execution layer used by the real path. The Safe remains the owner and the permission boundary stays in force.
        </p>
        <div className="mt-5 grid gap-2 text-sm text-cream-200 sm:grid-cols-6">
          {['Trigger', 'Prepare', 'Simulate', 'KeeperHub', 'Execute', 'Verify'].map((step, i) => (
            <div key={step} className="rounded-lg border border-cream-100/10 bg-forest-950/50 px-3 py-3 text-center">
              <span className="text-cream-500">{i + 1}</span><span className="ml-2">{step}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="scope" className="scroll-mt-24 rounded-xl border border-cream-100/10 bg-forest-800/60 p-6 sm:p-8" aria-labelledby="scope-title">
        <h2 id="scope-title" className="font-display text-2xl font-bold text-cream-50">Current execution scope</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-cream-100/10 p-4"><p className="text-xs uppercase tracking-wide text-cream-500">Chain</p><p className="mt-1 font-semibold text-cream-100">Base</p></div>
          <div className="rounded-lg border border-cream-100/10 p-4"><p className="text-xs uppercase tracking-wide text-cream-500">Protocol</p><p className="mt-1 font-semibold text-cream-100">Aave v3</p></div>
          <div className="rounded-lg border border-cream-100/10 p-4"><p className="text-xs uppercase tracking-wide text-cream-500">Action</p><p className="mt-1 font-semibold text-cream-100">USDC withdrawal to the Safe</p></div>
        </div>
        <p className="text-pretty mt-4 text-sm text-cream-300">The scope is intentionally narrow. It is a working execution path, not a claim of broad protocol coverage.</p>
      </section>

      <section id="demo" className="scroll-mt-24 rounded-xl border border-warning/30 bg-warning/5 p-6" aria-labelledby="demo-title">
        <h2 id="demo-title" className="mb-2 font-semibold text-warning">Try the sandbox</h2>
        <p className="text-pretty text-sm text-cream-300">
          Click <strong className="text-cream-100">Try the demo</strong> to get a private sandbox session. It walks the autonomous lifecycle without a wallet, funds, or a real broadcast. Demo completion is explicitly separate from a real onchain execution.
        </p>
      </section>

      <section id="faq" className="scroll-mt-24" aria-labelledby="faq-title">
        <h2 id="faq-title" className="mb-8 text-center font-display text-2xl font-bold text-cream-50 sm:text-3xl">Common questions</h2>
        <Faq />
      </section>

      <section className="rounded-xl border border-cream-100/10 bg-forest-800/60 p-8 text-center sm:p-12" aria-labelledby="closing-title">
        <h2 id="closing-title" className="text-balance mx-auto max-w-xl font-display text-2xl font-bold text-cream-50 sm:text-3xl">
          Set the condition. <span className="font-accent italic text-mint-400">Walk away.</span>
        </h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {address ? (
            <Link href="/dashboard" className={btnPrimary}>Go to dashboard</Link>
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
