"use client";

import { useEffect, useState } from "react";
import { linkFocus } from "../lib/ui";

/**
 * The inline script in layout.tsx runs before paint and always sets an
 * explicit `data-theme="light"|"dark"` on <html> — from localStorage if
 * the visitor has toggled before, otherwise from the OS preference. So
 * by the time this component mounts there are only ever two states to
 * toggle between, never an ambiguous third "unset" one.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    setTheme(stored === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    // Read the DOM directly rather than trusting React state's timing,
    // so a click landing before the mount effect still flips correctly.
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("exit-keepa-theme", next);
    setTheme(next);
  }

  // Render both icons and let CSS pick — avoids a hydration mismatch
  // between the server's "no theme known yet" render and the client's
  // first effect pass, since the inline script has already set the
  // right data-theme attribute before this ever paints.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-cream-300 transition-colors hover:bg-forest-800 hover:text-cream-50 ${linkFocus}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="dark:hidden"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="hidden dark:block"
        aria-hidden="true"
      >
        <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
      </svg>
    </button>
  );
}
