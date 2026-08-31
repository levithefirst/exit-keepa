"use client";

import { useState } from "react";
import { linkFocus } from "../lib/ui";

/** Small copy affordance for long addresses/hashes — text stays truncatable via the parent's break-all. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (older browser, insecure context) - non-fatal, just no feedback.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex min-h-11 items-center px-2 text-xs text-cream-400 hover:text-cream-100 ${linkFocus}`}
      aria-label={`${label} to clipboard`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
