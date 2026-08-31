"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";

const STEPS = [
  {
    step: "1",
    title: "Configure",
    body: "Pick your Safe, the position to protect, and the rate that should trigger an exit.",
  },
  {
    step: "2",
    title: "Review & simulate",
    body: "See the exact on-chain transaction Exit Keepa will run, and simulate it before anything is live.",
  },
  {
    step: "3",
    title: "Automated exit",
    body: "When your condition is met, KeeperHub executes the authorized transaction through your Safe's Roles Modifier.",
  },
];

export default function HomePage() {
  const { address, connect, connecting } = useWallet();

  return (
    <main className="space-y-16">
      <section className="space-y-5 pt-4">
        <Badge tone="info">Aave v3 on Base · v1</Badge>
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
          Protect your DeFi position before rates turn against you.
        </h1>
        <p className="max-w-2xl text-gray-400">
          Exit Keepa watches a rate condition you define and, when it&apos;s crossed, executes a pre-authorized exit
          transaction through your Safe — automatically, without you needing to be online.
        </p>
        {address ? (
          <LinkButton href="/dashboard">Go to Dashboard</LinkButton>
        ) : (
          <div className="flex items-center gap-4">
            <Button onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect Wallet to Get Started"}
            </Button>
            <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
              or try demo mode →
            </Link>
          </div>
        )}
      </section>

      <Card className="border-accent/25 bg-accent-soft">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="success">Verified on-chain</Badge>
        </div>
        <h2 className="mb-2 font-semibold text-white">Live proof — a real completed withdraw on Base</h2>
        <p className="text-sm text-gray-300">
          This exact flow — Safe + Roles Modifier + KeeperHub simulate/broadcast — already executed a real Aave v3
          USDC withdraw on Base mainnet through the demo Safe, verified independently on-chain (not just claimed by
          the app).
        </p>
        <div className="data-mono mt-3 space-y-1 rounded-lg bg-black/20 p-3 font-mono text-xs text-gray-300">
          <p className="break-all">
            Tx:{" "}
            <a
              href="https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b
            </a>
          </p>
          <p className="text-gray-400">Result: success (receipt status 0x1) — USDC returned to the Safe</p>
        </div>
      </Card>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <Card key={s.step}>
            <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-mono font-semibold text-gray-300">
              {s.step}
            </div>
            <h3 className="mb-1 font-medium text-white">{s.title}</h3>
            <p className="text-sm text-gray-400">{s.body}</p>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold text-white">Supported protocol (v1)</h2>
          <p className="text-sm text-gray-400">
            <strong className="text-gray-200">Aave v3 on Base</strong> — Exit Keepa withdraws your Base USDC supply
            position from Aave back to your Safe. This requires you to already hold a USDC supply position on Aave
            v3 Base via your Safe.
          </p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold text-white">How execution is authorized</h2>
          <p className="text-sm text-gray-400">
            Exit Keepa never holds your keys. Your Safe has a Zodiac Roles Modifier enabled, scoped so that only the
            exact withdraw call on Aave&apos;s USDC market — paid back to your own Safe — can be executed under Exit
            Keepa&apos;s role. KeeperHub is the executor, but it can never do anything outside that narrow
            permission.
          </p>
        </Card>
      </section>

      <Alert tone="info" title="For judges: a safe way to try this">
        No wallet? Click <strong className="text-gray-200">&quot;Try demo mode&quot;</strong> in the nav bar to
        register a Safe, create a strategy, and inspect/simulate the exact transaction Exit Keepa would run — all
        without any funds at risk or a wallet extension. The demo Safe is pre-fillable on the Dashboard. Real
        execution requires a Safe that (a) holds a real USDC supply position on Aave v3 Base and (b) has the narrow
        Roles permission above actually granted on-chain — both are already true for the demo Safe, which is why its
        tx above is real, not simulated.
      </Alert>
    </main>
  );
}
