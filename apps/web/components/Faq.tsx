"use client";

import { useEffect, useRef } from "react";

const FAQ_ITEMS = [
  {
    q: "What is Exit Keepa?",
    a: "A way to protect a DeFi position from a bad rate move. You set an exit condition once, and when it's crossed, a pre-approved transaction runs through your own Safe. Exit Keepa never holds your keys or your funds.",
  },
  {
    q: "How does it actually work?",
    a: "You create a strategy: the condition and the exact withdrawal it should trigger. Once it's active, Exit Keepa watches for that condition. When it's met, it prepares the transaction, simulates it, and only then can it be sent. Every step is recorded.",
  },
  {
    q: "Why does Exit Keepa use KeeperHub?",
    a: "KeeperHub is what actually calls your Safe on your behalf. It can only call one function, execTransactionWithRole, through your Roles Modifier. It has no way to call anything else, on any other contract.",
  },
  {
    q: "What happens before an exit is sent?",
    a: "Exit Keepa rebuilds the exact transaction from your saved strategy every time, runs it as a simulation, and only allows a real send once that simulation comes back clean. Nothing is ever built from data entered at the last second.",
  },
  {
    q: "How does simulation work?",
    a: "The same transaction is sent to KeeperHub in simulation mode. It's checked against the real Roles Modifier and the real Aave Pool on Base, a genuine test, not a guess, and returns either a clean result or the exact reason it would fail.",
  },
  {
    q: "What protects my Safe?",
    a: "A Zodiac Roles Modifier. By default it can do nothing. The live permission scopes the role to exactly one function, withdraw() on Aave's Pool on Base — no other function or contract is reachable through it. Exit Keepa's own checks make sure every withdraw it builds sends funds back to your Safe; locking that same rule into the onchain permission itself is the next tightening step, tracked in the repo.",
  },
  {
    q: "Does Exit Keepa control my funds?",
    a: "No. Your Safe holds your funds at all times. Exit Keepa, through KeeperHub, can only trigger the one narrow action your Roles permission allows. It can't move funds outside that scope, and it never takes custody.",
  },
  {
    q: "Can I try this without a real position?",
    a: "Yes. Demo mode gives you a fixed identity with no wallet extension required, so you can create a strategy, review the exact transaction, and simulate it with nothing at risk.",
  },
  {
    q: "What happens if an execution fails?",
    a: "A failed simulation is recorded as failed, with the real reason, and it's never sent. If a real broadcast fails from a network or timeout issue rather than a clear rejection, that's recorded differently too, so an uncertain attempt is never mistaken for a success or a clean failure.",
  },
  {
    q: "How do I know an exit actually happened?",
    a: "We only store a transaction hash if it's real and well-formed, never invented. Check it yourself on BaseScan. The blockchain, not our database, is what actually proves it happened.",
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
