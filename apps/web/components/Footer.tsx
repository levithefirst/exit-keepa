import Link from "next/link";
import { linkFocus } from "../lib/ui";
import { Logo } from "./Logo";

const REPO = "https://github.com/levithefirst/exit-keepa";
// This repo has no "main" branch — its default/production branch is
// claude/exit-keepa-init-v5lzuy. A "blob/main/..." link 404s.
const REPO_BRANCH = "claude/exit-keepa-init-v5lzuy";
const PROOF_TX = "https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b";

function FooterLink({ href, children, external = true }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = `text-sm text-cream-300 hover:text-mint-300 ${linkFocus}`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-cream-100/10 bg-forest-900">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="sm:col-span-2 md:col-span-1">
            <Logo iconClassName="h-5 w-5" textClassName="text-base" />
            <p className="text-pretty mt-3 max-w-xs text-sm text-cream-300">
              Protective exits for your DeFi positions, run through your own Safe. We never hold your funds.
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-cream-400">Product</h3>
            <ul className="space-y-2">
              <li><FooterLink href="/" external={false}>How it works</FooterLink></li>
              <li><FooterLink href="/create" external={false}>Create a strategy</FooterLink></li>
              <li><FooterLink href="/dashboard" external={false}>Demo dashboard</FooterLink></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-cream-400">Resources</h3>
            <ul className="space-y-2">
              <li><FooterLink href={`${REPO}#readme`}>Documentation</FooterLink></li>
              <li><FooterLink href={REPO}>Source on GitHub</FooterLink></li>
              <li><FooterLink href={`${REPO}/blob/${REPO_BRANCH}/docs/JUDGE_DEMO.md`}>Judge demo path</FooterLink></li>
              <li><FooterLink href={PROOF_TX}>Onchain proof</FooterLink></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-cream-400">Project</h3>
            <ul className="space-y-2">
              <li><FooterLink href={REPO}>GitHub</FooterLink></li>
              <li><FooterLink href={`${REPO}/issues`}>Report an issue</FooterLink></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-cream-100/10 pt-6 text-xs text-cream-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Exit Keepa. Built on Base.</p>
          <p>
            Execution is real, permission-scoped, and verifiable.{" "}
            <a href={PROOF_TX} target="_blank" rel="noreferrer" className={`underline hover:text-mint-300 ${linkFocus}`}>
              See the proof
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
