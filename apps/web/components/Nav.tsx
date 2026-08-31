"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function Nav() {
  const { address, connecting, error, connect, disconnect, chainId, switchToBase, isDemo, enterDemoMode } =
    useWallet();

  return (
    <nav className="border-b border-white/10 bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2 font-semibold text-white">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-black">
            EK
          </span>
          Exit Keepa
        </Link>
        <div className="flex items-center gap-5 text-sm">
          <Link href="/dashboard" className="text-gray-400 transition-colors hover:text-white">
            Dashboard
          </Link>
          <Link href="/create" className="text-gray-400 transition-colors hover:text-white">
            Create Strategy
          </Link>
          {address ? (
            <div className="flex items-center gap-3">
              {!isDemo && chainId !== 8453 && (
                <button onClick={switchToBase}>
                  <Badge tone="warning">Wrong network — switch to Base</Badge>
                </button>
              )}
              {isDemo ? (
                <Badge tone="warning">Demo mode</Badge>
              ) : (
                <span className="data-mono rounded-full border border-white/10 bg-surface px-3 py-1 font-mono text-xs text-gray-300">
                  {short(address)}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={disconnect} className="px-0">
                {isDemo ? "Exit demo" : "Disconnect"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={connect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect Wallet"}
              </Button>
              <Button variant="ghost" size="sm" onClick={enterDemoMode} className="px-0 underline">
                Try demo mode
              </Button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="mx-auto max-w-5xl px-6 pb-2.5 text-xs text-danger">{error}</p>
      )}
    </nav>
  );
}
