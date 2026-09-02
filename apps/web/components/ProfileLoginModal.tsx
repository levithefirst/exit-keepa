"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "../lib/wallet";
import { linkFocus } from "../lib/ui";

/** Google's official 4-color "G" glyph (brand guidelines require the exact
 * colors, not currentColor) - see developers.google.com/identity/branding.
 * Exported so Nav.tsx's signed-in pill can reuse the same glyph. */
export function GoogleIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 34.7 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.6C41.4 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

/** X's official wordmark glyph - a single monochrome path, so it's drawn
 * with currentColor and inherits the surrounding text color, staying
 * legible in both themes rather than being pinned to one fixed color.
 * Exported so Nav.tsx's signed-in pill can reuse the same glyph. */
export function XIcon({ className = "h-6 w-6 text-cream-50" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.4l8.1-9.3L1 2h7.2l5 6.6L18.9 2Zm-1.2 18h1.7L6.4 3.9H4.6L17.7 20Z"
      />
    </svg>
  );
}

/**
 * "Sign in with a profile" - Google/X, an alternate login method alongside
 * "Connect wallet" (WalletConnectModal.tsx), not a replacement for it. Same
 * dialog pattern/theme as that modal; a full page redirect (via
 * loginWithGoogle/loginWithX in lib/wallet.tsx) rather than a popup, so it
 * behaves identically across browsers and mobile.
 */
export function ProfileLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { loginWithGoogle, loginWithX, address, error } = useWallet();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (address) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-forest-950/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
              Sign in with a profile
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

          <p className="mb-4 text-pretty text-sm text-cream-300">
            A separate way to use Exit Keepa without a wallet extension. Get your own persistent sandbox to build
            and review strategies; connect a real wallet later to protect an actual Safe.
          </p>

          <ul className="space-y-2">
            <li>
              <button
                type="button"
                onClick={loginWithGoogle}
                className={`flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-forest-900 ${linkFocus}`}
              >
                <GoogleIcon />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-cream-50">Continue with Google</span>
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={loginWithX}
                className={`flex w-full items-center gap-3 rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2.5 text-left transition-colors hover:border-mint-400/40 hover:bg-forest-900 ${linkFocus}`}
              >
                <XIcon />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-cream-50">Continue with X</span>
                </span>
              </button>
            </li>
          </ul>

          {error && (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          <p className="mt-4 text-pretty text-center text-xs text-cream-500">
            Everything you build stays in a sandbox until you connect a real wallet and Safe. No password is ever
            shared with Exit Keepa.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
