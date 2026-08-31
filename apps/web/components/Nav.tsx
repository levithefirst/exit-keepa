"use client";

import Link from "next/link";
import { useWallet } from "../lib/wallet";
import { btnPrimarySmall, linkFocus } from "../lib/ui";

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function Nav() {
  const { address, connecting, error, connect, disconnect, chainId, switchToBase, isDemo, enterDemoMode } =
    useWallet();

  return (
    <nav className="border-b border-white/10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4">
        <Link href="/" className={`shrink-0 font-semibold text-white ${linkFocus}`}>
          Exit Keepa
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link href="/dashboard" className={`text-gray-300 hover:text-white ${linkFocus}`}>
            Dashboard
          </Link>
          <Link href="/create" className={`text-gray-300 hover:text-white ${linkFocus}`}>
            Create strategy
          </Link>
          {address ? (
            <div className="flex flex-wrap items-center gap-2">
              {!isDemo && chainId !== 8453 && (
                <button
                  onClick={switchToBase}
                  className={`min-h-11 rounded bg-yellow-600/20 px-2 text-xs text-yellow-300 ${linkFocus}`}
                >
                  Wrong network — switch to Base
                </button>
              )}
              {isDemo ? (
                <span className="rounded bg-yellow-600/20 px-3 py-1 text-xs text-yellow-300">Demo mode</span>
              ) : (
                <span className="rounded bg-white/10 px-3 py-1 font-mono text-xs tabular-nums">
                  {short(address)}
                </span>
              )}
              <button onClick={disconnect} className={`min-h-11 px-1 text-xs text-gray-400 hover:text-white ${linkFocus}`}>
                {isDemo ? "Exit demo" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={connect} disabled={connecting} className={btnPrimarySmall}>
                {connecting ? "Connecting..." : "Connect wallet"}
              </button>
              <button onClick={enterDemoMode} className={`min-h-11 px-1 text-xs text-gray-400 underline hover:text-white ${linkFocus}`}>
                Try demo mode
              </button>
            </div>
          )}
        </div>
      </div>
      {error && <p className="mx-auto max-w-5xl px-6 pb-2 text-xs text-red-400 text-pretty">{error}</p>}
    </nav>
  );
}
