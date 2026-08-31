"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function Nav() {
  const { address, connecting, error, connect, disconnect, chainId, switchToBase, isDemo, enterDemoMode } =
    useWallet();

  return (
    <nav className="border-b border-white/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold text-white">
          Exit Keepa
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-gray-300 hover:text-white">
            Dashboard
          </Link>
          <Link href="/create" className="text-gray-300 hover:text-white">
            Create Strategy
          </Link>
          {address ? (
            <div className="flex items-center gap-2">
              {!isDemo && chainId !== 8453 && (
                <button
                  onClick={switchToBase}
                  className="rounded bg-yellow-600/20 px-2 py-1 text-xs text-yellow-300"
                >
                  Wrong network — switch to Base
                </button>
              )}
              {isDemo ? (
                <span className="rounded bg-yellow-600/20 px-3 py-1 text-xs text-yellow-300">Demo mode</span>
              ) : (
                <span className="rounded bg-white/10 px-3 py-1 font-mono text-xs">{short(address)}</span>
              )}
              <button onClick={disconnect} className="text-xs text-gray-400 hover:text-white">
                {isDemo ? "Exit demo" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={connect}
                disabled={connecting}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
              >
                {connecting ? "Connecting..." : "Connect Wallet"}
              </button>
              <button onClick={enterDemoMode} className="text-xs text-gray-400 underline hover:text-white">
                Try demo mode
              </button>
            </div>
          )}
        </div>
      </div>
      {error && <p className="mx-auto max-w-5xl px-6 pb-2 text-xs text-red-400">{error}</p>}
    </nav>
  );
}
