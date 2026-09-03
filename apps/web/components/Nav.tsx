"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "../lib/wallet";
import { btnPrimarySmall, btnGhost, linkFocus } from "../lib/ui";
import { Logo } from "./Logo";
import { WalletConnectModal } from "./WalletConnectModal";
import { ProfileLoginModal } from "./ProfileLoginModal";
import { ThemeToggle } from "./ThemeToggle";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/create", label: "Create strategy" },
];

export function Nav() {
  const {
    address,
    connecting,
    error,
    disconnect,
    chainId,
    switchToBase,
    isDemo,
    enterDemoMode,
    isLocal,
    username,
  } = useWallet();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape, and auto-close if the viewport grows past the
  // mobile breakpoint while the panel happens to be open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    function onResize() {
      if (window.innerWidth >= 768) setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function closeMenu() {
    setMenuOpen(false);
  }

  const walletControls = address ? (
    <div className="flex flex-wrap items-center gap-2">
      {!isDemo && !isLocal && chainId !== 8453 && (
        <button
          onClick={switchToBase}
          className={`min-h-11 rounded-lg bg-warning/15 px-2 text-xs text-warning ${linkFocus}`}
        >
          Wrong network. Switch to Base
        </button>
      )}
      {isDemo ? (
        <span className="rounded-lg bg-warning/15 px-3 py-1 text-xs text-warning">Demo mode</span>
      ) : isLocal ? (
        <span className="rounded-lg bg-forest-700 px-3 py-1 text-xs text-cream-200">{username}</span>
      ) : (
        <span className="data-mono rounded-lg bg-forest-700 px-3 py-1 font-mono text-xs text-cream-200">
          {short(address)}
        </span>
      )}
      <button onClick={disconnect} className={`min-h-11 px-1 text-xs text-cream-300 hover:text-cream-50 ${linkFocus}`}>
        {isDemo ? "Exit demo" : isLocal ? "Sign out" : "Disconnect"}
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => enterDemoMode().catch(() => {})} className={btnGhost}>
        Try demo
      </button>
      <button onClick={() => setProfileModalOpen(true)} className={btnGhost}>
        Profile
      </button>
      <button onClick={() => setWalletModalOpen(true)} disabled={connecting} className={btnPrimarySmall}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    </div>
  );

  return (
    <nav className="sticky top-0 z-40 border-b border-cream-100/10 bg-forest-900/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
        <Link href="/" className={`shrink-0 ${linkFocus}`}>
          <Logo />
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 text-sm md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${linkFocus} ${isActive ? "text-mint-400" : "text-cream-200 hover:text-mint-300"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {walletControls}
          <ThemeToggle />
        </div>

        {/* Mobile: theme toggle stays visible, hamburger opens the rest */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            ref={menuButtonRef}
            type="button"
            className={`flex h-11 w-11 items-center justify-center rounded-lg text-cream-100 ${linkFocus}`}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              {menuOpen ? (
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              ) : (
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {menuOpen && (
        <div id={menuId} className="border-t border-cream-100/10 bg-forest-900 px-6 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMenu}
                  className={`min-h-11 rounded-lg px-2 py-2.5 text-sm ${linkFocus} ${
                    isActive ? "bg-mint-400/10 text-mint-400" : "text-cream-200 hover:bg-cream-100/5"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-3 border-t border-cream-100/10 pt-3">{walletControls}</div>
        </div>
      )}

      {error && !walletModalOpen && (
        <p className="mx-auto max-w-5xl px-6 pb-2 text-xs text-pretty text-danger">{error}</p>
      )}
      <WalletConnectModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
      <ProfileLoginModal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
    </nav>
  );
}
