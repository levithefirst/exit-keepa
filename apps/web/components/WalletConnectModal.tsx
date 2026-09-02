"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BRAVE_WALLET_RDNS,
  COINBASE_RDNS,
  METAMASK_RDNS,
  OKX_WALLET_RDNS,
  RABBY_RDNS,
  RAINBOW_RDNS,
  TRUST_WALLET_RDNS,
  useWallet,
} from "../lib/wallet";
import { linkFocus } from "../lib/ui";
import { WalletIcon } from "./WalletIcon";
import type { WALLET_ICON_SVG } from "../lib/walletIconSvg";

interface WalletOption {
  rdns: string;
  name: string;
  description: string;
  installUrl: string;
  iconId: keyof typeof WALLET_ICON_SVG;
  /** Ambient `window.ethereum.isX` flag some extensions set even without
   * an EIP-6963 announcement - checked as a fallback, not the primary
   * detection path (see `installed` below). */
  ambientFlag?: "isMetaMask" | "isCoinbaseWallet" | "isBraveWallet" | "isRabby" | "isTrust" | "isTrustWallet";
}

/** Every wallet here is a real EIP-1193 injected provider relevant to an
 * EVM chain (Base) - no non-EVM wallets (Cosmos/Starknet/Bitcoin-only,
 * etc.), matching this app's single-chain scope. Icons are each wallet's
 * own real logomark (see lib/walletIconSvg.ts), not letter monograms. */
const WALLET_OPTIONS: WalletOption[] = [
  {
    rdns: METAMASK_RDNS,
    name: "MetaMask",
    description: "Connect using the MetaMask browser extension",
    installUrl: "https://metamask.io/download",
    iconId: "MetaMask",
    ambientFlag: "isMetaMask",
  },
  {
    rdns: COINBASE_RDNS,
    name: "Coinbase Wallet",
    description: "Connect using the Coinbase Wallet extension",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    iconId: "CoinbaseWallet",
    ambientFlag: "isCoinbaseWallet",
  },
  {
    rdns: RABBY_RDNS,
    name: "Rabby",
    description: "Connect using the Rabby browser extension",
    installUrl: "https://rabby.io/",
    iconId: "Rabby",
    ambientFlag: "isRabby",
  },
  {
    rdns: RAINBOW_RDNS,
    name: "Rainbow",
    description: "Connect using the Rainbow browser extension",
    installUrl: "https://rainbow.me/extension",
    iconId: "Rainbow",
  },
  {
    rdns: TRUST_WALLET_RDNS,
    name: "Trust Wallet",
    description: "Connect using the Trust Wallet browser extension",
    installUrl: "https://trustwallet.com/browser-extension",
    iconId: "TrustWallet",
    ambientFlag: "isTrust",
  },
  {
    rdns: OKX_WALLET_RDNS,
    name: "OKX Wallet",
    description: "Connect using the OKX Wallet browser extension",
    installUrl: "https://www.okx.com/web3",
    iconId: "OkxWallet",
  },
  {
    rdns: BRAVE_WALLET_RDNS,
    name: "Brave Wallet",
    description: "Connect using Brave's built-in wallet",
    installUrl: "https://brave.com/wallet/",
    iconId: "BraveWallet",
    ambientFlag: "isBraveWallet",
  },
];

/** Sentinel rdns for the "use whatever's injected" fallback row - not a
 * real EIP-6963 identifier, just a key into WALLET_OPTIONS-shaped UI. */
const OTHER_INJECTED = "other-injected";

export function WalletConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connecting, error, discoveredProviders, hasProvider, address } = useWallet();
  const [pendingRdns, setPendingRdns] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Close on Escape; return focus to the dialog on open for a11y.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Once a connection attempt resolves (success or failure), stop showing
  // that option as "connecting…". A success also closes the modal.
  useEffect(() => {
    if (!connecting) setPendingRdns(null);
  }, [connecting]);

  useEffect(() => {
    if (address) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!open) return null;

  async function handleConnect(rdns?: string) {
    setPendingRdns(rdns ?? OTHER_INJECTED);
    await connect(rdns);
  }

  const ambientEthereum = typeof window !== "undefined" ? window.ethereum : undefined;

  // Any real, installed wallet this app doesn't have a curated card for
  // (Zerion, Frame, Backpack, whatever else announces itself) - rendered
  // with its own self-announced name/icon per the EIP-6963 spec, rather
  // than only ever showing the 7 wallets hardcoded above. A wallet that's
  // genuinely installed and standards-compliant should never be invisible
  // here just because it isn't one of those 7.
  const curatedRdns = new Set(WALLET_OPTIONS.map((o) => o.rdns));
  const otherDiscovered = Object.values(discoveredProviders).filter((d) => !curatedRdns.has(d.info.rdns));

  // "Other injected wallet" (no name/icon to show) is the last-resort
  // fallback: an ambient `window.ethereum` with zero EIP-6963 announcements
  // at all (an older extension, or a mobile wallet's in-app browser).
  const genericInjectedAvailable = Boolean(ambientEthereum) && Object.keys(discoveredProviders).length === 0;

  // Rendered via a portal straight onto <body> rather than in place: this
  // component is mounted inside <Nav>, and Nav's own `backdrop-blur`
  // (backdrop-filter) establishes a containing block for any
  // `position: fixed` descendant per the CSS spec - without the portal,
  // this modal's "fixed inset-0" was being sized/positioned relative to
  // the ~70px-tall nav bar instead of the viewport, which is what made it
  // render squashed into the top of the screen on every viewport size.
  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-forest-950/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* min-h-full + flex centers the dialog when it's shorter than the
          viewport, and lets the *page* (this wrapper, via overflow-y-auto
          above) scroll when it's taller - a fixed max-h + internal scroll
          alone still clipped the top of the wallet list on short mobile
          viewports since the dialog was vertically centered with no room
          above it. */}
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="my-8 w-full max-w-sm rounded-xl border border-cream-100/10 bg-forest-800 p-5 shadow-2xl outline-none"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id={titleId} className="font-display text-lg font-semibold text-cream-50">
              Connect a wallet
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-cream-300 hover:bg-cream-100/10 hover:text-cream-50 ${linkFocus}`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>

          <p className="mb-4 text-sm text-cream-300">Exit Keepa runs on Base. Pick a wallet to sign in with.</p>

          <ul className="space-y-2">
          {WALLET_OPTIONS.map((opt) => {
            const installed =
              Boolean(discoveredProviders[opt.rdns]) || Boolean(opt.ambientFlag && ambientEthereum?.[opt.ambientFlag]);
            const isPending = connecting && pendingRdns === opt.rdns;
            return (
              <li key={opt.rdns}>
                {installed ? (
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={() => handleConnect(opt.rdns)}
                    className={`flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-forest-900 disabled:cursor-not-allowed disabled:opacity-60 ${linkFocus}`}
                  >
                    <WalletIcon id={opt.iconId} label={opt.name} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-cream-50">{opt.name}</span>
                      <span className="block text-xs text-cream-400">
                        {isPending ? "Confirm in your wallet…" : opt.description}
                      </span>
                    </span>
                    {isPending && (
                      <span
                        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cream-100/30 border-t-mint-400"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/30 px-3 py-2.5 opacity-80">
                    <WalletIcon id={opt.iconId} label={opt.name} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-cream-200">{opt.name}</span>
                      <span className="block text-xs text-cream-400">Not detected in this browser</span>
                    </span>
                    <a
                      href={opt.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-md border border-cream-100/20 px-2.5 py-1 text-xs font-medium text-cream-100 hover:border-mint-400/40 hover:text-mint-300 ${linkFocus}`}
                    >
                      Install
                    </a>
                  </div>
                )}
              </li>
            );
          })}

          {otherDiscovered.map((d) => {
            const isPending = connecting && pendingRdns === d.info.rdns;
            return (
              <li key={d.info.rdns}>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => handleConnect(d.info.rdns)}
                  className={`flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-forest-900 disabled:cursor-not-allowed disabled:opacity-60 ${linkFocus}`}
                >
                  {/* Self-announced EIP-6963 icon - always a data: URI per spec,
                      not a remote fetch. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.info.icon} alt="" className="h-9 w-9 shrink-0 rounded-lg" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-cream-50">{d.info.name}</span>
                    <span className="block text-xs text-cream-400">
                      {isPending ? "Confirm in your wallet…" : "Detected in this browser"}
                    </span>
                  </span>
                  {isPending && (
                    <span
                      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cream-100/30 border-t-mint-400"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}

          {genericInjectedAvailable && (
            <li>
              <button
                type="button"
                disabled={connecting}
                onClick={() => handleConnect(undefined)}
                className={`flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-forest-900 disabled:cursor-not-allowed disabled:opacity-60 ${linkFocus}`}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-forest-700 text-sm font-bold text-cream-100"
                  aria-hidden="true"
                >
                  ◆
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-cream-50">Other injected wallet</span>
                  <span className="block text-xs text-cream-400">
                    {connecting && pendingRdns === OTHER_INJECTED
                      ? "Confirm in your wallet…"
                      : "Use the wallet extension already in this browser"}
                  </span>
                </span>
                {connecting && pendingRdns === OTHER_INJECTED && (
                  <span
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cream-100/30 border-t-mint-400"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          )}

          {!hasProvider && !genericInjectedAvailable && (
            <li className="rounded-lg border border-cream-100/10 bg-forest-900/30 px-3 py-2.5 text-xs text-cream-400">
              No wallet extension detected. Install one above, then refresh this page.
            </li>
          )}
        </ul>

        {error && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
            {error}
          </p>
        )}

          <p className="mt-4 text-center text-xs text-cream-400">
            New to wallets?{" "}
            <a
              href="https://ethereum.org/en/wallets/find-wallet/"
              target="_blank"
              rel="noopener noreferrer"
              className={`text-cream-300 underline hover:text-mint-300 ${linkFocus}`}
            >
              Learn more
            </a>
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
