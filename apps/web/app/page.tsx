"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";

export default function HomePage() {
  const { address, connect, connecting } = useWallet();

  return (
    <main className="space-y-12">
      <section className="space-y-4 pt-8">
        <h1 className="text-4xl font-bold text-white">Protect your DeFi position before rates turn against you.</h1>
        <p className="max-w-2xl text-gray-300">
          Exit Keepa watches a rate condition you define and, when it&apos;s crossed, executes a pre-authorized exit
          transaction through your Safe — automatically, without you needing to be online.
        </p>
        {address ? (
          <Link
            href="/dashboard"
            className="inline-block rounded bg-accent px-5 py-2.5 font-medium text-black"
          >
            Go to Dashboard
          </Link>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="rounded bg-accent px-5 py-2.5 font-medium text-black disabled:opacity-50"
          >
            {connecting ? "Connecting..." : "Connect Wallet to Get Started"}
          </button>
        )}
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          { step: "1", title: "Configure", body: "Pick your Safe, the position to protect, and the rate that should trigger an exit." },
          { step: "2", title: "Review & Simulate", body: "See the exact on-chain transaction Exit Keepa will run, and simulate it before anything is live." },
          { step: "3", title: "Automated Exit", body: "When your condition is met, KeeperHub executes the authorized transaction through your Safe&apos;s Roles Modifier." },
        ].map((s) => (
          <div key={s.step} className="rounded-lg border border-white/10 p-5">
            <div className="mb-2 text-sm font-mono text-accent">Step {s.step}</div>
            <h3 className="mb-1 font-semibold text-white">{s.title}</h3>
            <p className="text-sm text-gray-400">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-white/10 p-6">
        <h2 className="mb-2 font-semibold text-white">Supported protocol (v1)</h2>
        <p className="text-sm text-gray-400">
          <strong className="text-gray-200">Aave v3 on Base</strong> — Exit Keepa withdraws your Base USDC supply
          position from Aave (<code className="text-xs">withdraw(asset, amount, to)</code> on Aave&apos;s Pool contract,{" "}
          <code className="text-xs">0xA238Dd80C259a72e81d7e4664a9801593F98d1c5</code>) back to your Safe. This
          requires you to already hold a USDC supply position on Aave v3 Base via your Safe.
        </p>
      </section>

      <section className="rounded-lg border border-white/10 p-6">
        <h2 className="mb-2 font-semibold text-white">How execution is authorized</h2>
        <p className="text-sm text-gray-400">
          Exit Keepa never holds your keys. Your Safe has a Zodiac Roles Modifier enabled, scoped so that only the
          exact <code className="text-xs">withdraw()</code> call on Aave&apos;s USDC market — paid back to your own Safe
          — can be executed under Exit Keepa&apos;s role. KeeperHub is the executor, but it can never do anything outside
          that narrow permission.
        </p>
      </section>

      <section className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-6">
        <h2 className="mb-2 font-semibold text-yellow-300">For judges: a safe way to try this</h2>
        <p className="text-sm text-gray-400">
          You can connect a wallet, register a Safe, create a strategy, and inspect/simulate the exact transaction
          Exit Keepa would run — all without any funds at risk. Real execution additionally requires a Safe that (a)
          holds a real USDC supply position on Aave v3 Base and (b) has the narrow Roles permission described above
          actually granted on-chain (see README for the exact permission spec and why it isn&apos;t pre-granted here).
        </p>
      </section>
    </main>
  );
}
