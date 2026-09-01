"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COINBASE_RDNS, METAMASK_RDNS, useWallet } from "../lib/wallet";
import { linkFocus } from "../lib/ui";

interface WalletOption {
  rdns: string;
  name: string;
  description: string;
  installUrl: string;
  icon: React.ReactNode;
}

/** Small inline monogram badges instead of pulling real wallet logos as
 * external images - keeps this self-contained (no CDN image host in the
 * artifact/CSP allowlist to worry about) while still being instantly
 * recognizable next to the wallet's name. */
function Monogram({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
      style={{ background: bg, color: fg }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    rdns: METAMASK_RDNS,
    name: "MetaMask",
    description: "Connect using the MetaMask browser extension",
    installUrl: "https://metamask.io/download",
    icon: (
      <Monogram bg="#f6851b" fg="#1a1200">
        M
      </Monogram>
    ),
  },
  {
    rdns: COINBASE_RDNS,
    name: "Coinbase Wallet",
    description: "Connect using the Coinbase Wallet extension",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    icon: (
      <Monogram bg="#0052ff" fg="#ffffff">
        C
      </Monogram>
    ),
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

  // "Other injected wallet" is only worth showing when there's an ambient
  // `window.ethereum` that isn't already covered by an EIP-6963 announcement
  // (e.g. an older wallet extension, or a mobile wallet's in-app browser).
  const genericInjectedAvailable = Boolean(ambientEthereum) && Object.keys(discoveredProviders).length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border border-cream-100/10 bg-forest-800 p-5 shadow-2xl outline-none"
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
              Boolean(discoveredProviders[opt.rdns]) ||
              (opt.rdns === METAMASK_RDNS && Boolean(ambientEthereum?.isMetaMask)) ||
              (opt.rdns === COINBASE_RDNS && Boolean(ambientEthereum?.isCoinbaseWallet));
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
                    {opt.icon}
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
                    {opt.icon}
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

          {genericInjectedAvailable && (
            <li>
              <button
                type="button"
                disabled={connecting}
                onClick={() => handleConnect(undefined)}
                className={`flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-forest-900 disabled:cursor-not-allowed disabled:opacity-60 ${linkFocus}`}
              >
                <Monogram bg="#3a4f42" fg="#e4d8b8">
                  ◆
                </Monogram>
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
  );
}
