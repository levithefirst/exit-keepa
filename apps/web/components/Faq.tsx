"use client";

import { useEffect, useRef } from "react";

const FAQ_ITEMS = [
  {
    q: "What is Exit Keepa?",
    a: "A way to protect a DeFi position from an adverse rate move: you define an exit condition once, and when it's crossed, a pre-authorized exit transaction runs through your own Safe. Exit Keepa never holds your keys or your funds.",
  },
  {
    q: "How does an automated exit actually work?",
    a: "You create a strategy (the condition and the exact withdraw action), activate it, and Exit Keepa monitors for the condition. When it's met, it prepares an execution, simulates it, and only then can it be broadcast — every step recorded.",
  },
  {
    q: "Why does Exit Keepa use KeeperHub?",
    a: "KeeperHub is the executor that calls into your Safe on your behalf. It can only ever call one function — execTransactionWithRole — on your Roles Modifier. It never has a way to call anything else, on any other contract.",
  },
  {
    q: "What happens before execution?",
    a: "Exit Keepa deterministically rebuilds the exact transaction from your stored strategy, runs it as a simulation, and only enables a real broadcast once that simulation comes back clean. Nothing is ever built from data supplied at trigger time.",
  },
  {
    q: "How does simulation work?",
    a: "The same execTransactionWithRole call is sent to KeeperHub with simulate: true. It's checked against the real Roles Modifier and the real Aave Pool on Base — a genuine dry run, not a mocked response — and returns either a clean result or the exact revert reason.",
  },
  {
    q: "What protects the Safe?",
    a: "A Zodiac Roles Modifier. By default a role can do nothing. Exit Keepa's role is scoped to withdraw() on Aave's Pool, with the recipient fixed to the Safe itself — funds can never be routed anywhere else, and no other Aave action is reachable.",
  },
  {
    q: "Does Exit Keepa control my funds?",
    a: "No. Your Safe holds the funds at all times. Exit Keepa (via KeeperHub) can only trigger the one narrow, pre-approved action your Roles permission allows — it can't move funds outside that scope, and it never takes custody.",
  },
  {
    q: "Can I test this without a live position?",
    a: "Yes — demo mode registers a fixed demo identity with no wallet extension required, so you can create a strategy, review the exact transaction, and simulate it without any funds at risk.",
  },
  {
    q: "What happens when execution fails?",
    a: "A failed simulation is recorded as failed with the real revert reason — it's never broadcast. If a broadcast attempt fails with a network/timeout error rather than a confirmed rejection from KeeperHub, that's recorded distinctly too, so a real, unconfirmed attempt is never silently treated as either a success or a clean failure.",
  },
  {
    q: "How can I verify an execution actually happened?",
    a: "Every real broadcast's transaction hash is only ever stored if it's a well-formed, validated hash — never fabricated. Check it directly on BaseScan; the chain, not Exit Keepa's own database, is the source of truth.",
  },
];

/** Optional JS enhancement: closing other items when one opens. Native <details> behavior (independent, all can stay open) still works with JS disabled. */
export function Faq() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll("details"));
    function handleToggle(this: HTMLDetailsElement) {
      if (!this.open) return;
      for (const other of items) {
        if (other !== this) other.open = false;
      }
    }
    items.forEach((item) => item.addEventListener("toggle", handleToggle));
    return () => items.forEach((item) => item.removeEventListener("toggle", handleToggle));
  }, []);

  return (
    <div ref={containerRef} className="mx-auto max-w-2xl divide-y divide-cream-100/10">
      {FAQ_ITEMS.map((item) => (
        <details key={item.q} className="group py-4">
          <summary
            className={
              "flex cursor-pointer list-none items-center justify-between gap-4 text-cream-100 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70 rounded"
            }
          >
            <span className="text-pretty font-medium">{item.q}</span>
            <svg
              className="faq-chevron h-4 w-4 shrink-0 text-mint-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <p className="text-pretty mt-3 text-sm leading-relaxed text-cream-300">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
