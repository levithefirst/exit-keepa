"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "../lib/wallet";
import { btnPrimarySmall, linkFocus } from "../lib/ui";

/**
 * "Sign in with a profile" - username/password, an alternate login method
 * alongside "Connect wallet" (WalletConnectModal.tsx), not a replacement
 * for it. Same dialog pattern/theme as that modal. No external provider and
 * no redirect: a direct API call via lib/wallet.tsx's signUp/logIn.
 */
export function ProfileLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signUp, logIn, address } = useWallet();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  // Reset the form each time the modal is (re-)opened, so a previous
  // session's leftover input/error never bleeds into a fresh attempt.
  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setFormError(null);
    }
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signUp(username, password);
      } else {
        await logIn(username, password);
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

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
              {mode === "signup" ? "Create a profile" : "Sign in to your profile"}
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

          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label htmlFor="profile-username" className="mb-1 block text-xs font-medium text-cream-300">
                Username
              </label>
              <input
                id="profile-username"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_]+"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2 text-sm text-cream-50 outline-none focus:border-mint-400/40"
                placeholder="lowercase letters, numbers, underscore"
              />
            </div>
            <div>
              <label htmlFor="profile-password" className="mb-1 block text-xs font-medium text-cream-300">
                Password
              </label>
              <input
                id="profile-password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
                maxLength={200}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-cream-100/10 bg-forest-900/60 px-3 py-2 text-sm text-cream-50 outline-none focus:border-mint-400/40"
                placeholder="at least 8 characters"
              />
            </div>

            <button type="submit" disabled={submitting} className={`w-full ${btnPrimarySmall}`}>
              {submitting ? "Please wait…" : mode === "signup" ? "Create profile" : "Sign in"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "signup" ? "login" : "signup"));
              setFormError(null);
            }}
            className={`mt-3 w-full text-center text-xs text-cream-300 hover:text-cream-50 ${linkFocus}`}
          >
            {mode === "signup" ? "Already have a profile? Sign in" : "Need a profile? Create one"}
          </button>

          {formError && (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
              {formError}
            </p>
          )}

          <p className="mt-4 text-pretty text-center text-xs text-cream-500">
            Everything you build stays in a sandbox until you connect a real wallet and Safe.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
