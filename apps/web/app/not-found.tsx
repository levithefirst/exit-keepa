import Link from "next/link";
import { btnPrimary } from "../lib/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center py-16" aria-labelledby="not-found-title">
      <section className="w-full max-w-xl rounded-2xl border border-cream-100/10 bg-forest-800/60 p-8 text-center sm:p-12">
        <p className="data-mono text-sm text-mint-400">404</p>
        <h1 id="not-found-title" className="mt-3 font-display text-3xl font-bold text-cream-50">That page does not exist.</h1>
        <p className="text-pretty mx-auto mt-3 max-w-md text-sm text-cream-300">The link may be outdated or the page may have moved. Return to Exit Keepa and start from there.</p>
        <Link href="/" className={`mt-6 inline-flex ${btnPrimary}`}>Back to Exit Keepa</Link>
      </section>
    </main>
  );
}
