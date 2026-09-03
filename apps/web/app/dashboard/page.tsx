"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildRolesSafeAppUrl, buildZodiacModulesSafeAppUrl, buildCreateSafeUrl } from "@exit-keepa/shared";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { resolveSafeId } from "../../lib/resolveSafeId";
import { setStoredSafeId } from "../../lib/storage";
import { btnPrimary, btnGhost, btnSecondarySmall, inputBase, linkFocus, card } from "../../lib/ui";
import { StatusPill } from "../../components/StatusPill";
import { CopyButton } from "../../components/CopyButton";

const BASESCAN = "https://basescan.org";

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-6">
      <div className="h-7 w-40 rounded bg-cream-100/10" />
      <div className="h-24 rounded-xl border border-cream-100/10 bg-forest-800/40" />
      <div className="h-16 rounded-xl border border-cream-100/10 bg-forest-800/40" />
    </div>
  );
}

export default function DashboardPage() {
  const { address, isDemo, enterDemoMode } = useWallet();
  const [startingDemo, setStartingDemo] = useState(false);
  const [safeId, setSafeId] = useState<string | null | undefined>(undefined); // undefined = still resolving
  const [safe, setSafe] = useState<any>(null);
  const [balances, setBalances] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [formSafeAddress, setFormSafeAddress] = useState("");
  const [formRoles, setFormRoles] = useState("");
  const [formRoleKey, setFormRoleKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Resolve which Safe (if any) this session already has, without ever
  // asking a returning real wallet to type an address in again. For a real
  // wallet, checks local cache first, then falls back to the account's own
  // list of registered Safes. Demo mode always skips the cache: every "Try
  // demo" click is a brand-new, isolated session with its own sandbox
  // Safe, and the client always displays that session under the same
  // fixed "demo-mode" label - so caching by that label would hand a new
  // demo session an old one's now-inaccessible safeId. See resolveSafeId.
  //
  // `cancelled` guards against a real, observed race: switching identity
  // (e.g. a real wallet with no Safe yet clicking "Try demo instead", or
  // two rapid clicks on either Try-demo button) re-runs this effect before
  // the previous call resolved. Without this guard, an older, slower
  // resolveSafeId (or the second effect's slower Promise.all below) can
  // finish AFTER a newer, faster one and silently overwrite the screen
  // with a different identity's Safe - concretely, the second effect's
  // real-Safe balance fetch hits live RPC and is measurably slower than a
  // sandbox Safe's fetch, so a real Safe loaded earlier in the same tab
  // can clobber a demo Safe loaded moments later. Also resets the stale
  // safe/balances/strategies immediately so nothing from a previous
  // identity is still on screen while the new one resolves.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setSafeId(undefined);
    setSafe(null);
    setBalances(null);
    setStrategies([]);
    setError(null);
    resolveSafeId(address, isDemo).then((id) => {
      if (!cancelled) setSafeId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [address, isDemo]);

  useEffect(() => {
    if (!safeId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getSafeAccount(safeId), api.getSafeBalances(safeId).catch(() => null), api.listStrategies(safeId)])
      .then(([s, b, strats]) => {
        if (cancelled) return;
        setSafe(s);
        setBalances(b);
        setStrategies(strats);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeId]);

  if (!address) {
    return (
      <div className="rounded-xl border border-dashed border-cream-100/15 p-8 text-center">
        <p className="text-pretty text-cream-300">Connect your wallet to see your dashboard.</p>
      </div>
    );
  }

  if (safeId === undefined) return <DashboardSkeleton />;

  async function startDemo() {
    setStartingDemo(true);
    try {
      await enterDemoMode();
    } catch {
      // enterDemoMode already recorded this in useWallet()'s error state.
    } finally {
      setStartingDemo(false);
    }
  }

  async function registerSafe() {
    setError(null);
    try {
      const created: any = await api.createSafeAccount({
        chainId: 8453,
        safeAddress: formSafeAddress,
        rolesModifierAddress: formRoles || null,
        rolesKey: formRoleKey || null,
      });
      setStoredSafeId(address!, created.id);
      setSafeId(created.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!safeId) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Connect your Safe</h1>
        <p className="text-pretty text-sm text-cream-300">Enter the Safe address you want Exit Keepa to protect.</p>
        <p className="text-pretty text-xs text-cream-400">
          Don&apos;t have a Safe yet?{" "}
          <a
            href={buildCreateSafeUrl(8453)}
            target="_blank"
            rel="noreferrer"
            className={`underline ${linkFocus}`}
          >
            Create one on Safe{"{Wallet}"} →
          </a>{" "}
          then come back here with its address.
        </p>
        {!isDemo && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cream-100/15 bg-forest-800/40 px-3 py-2">
            <p className="text-pretty text-xs text-cream-400">
              Just want to try Exit Keepa first? Skip the real Safe and setup entirely.
            </p>
            <button onClick={startDemo} disabled={startingDemo} className={`shrink-0 ${btnGhost}`}>
              {startingDemo ? "Starting demo…" : "Try demo instead →"}
            </button>
          </div>
        )}
        <div>
          <label htmlFor="safe-address" className="mb-1 block text-sm text-cream-300">
            Safe address
          </label>
          <input
            id="safe-address"
            className={inputBase}
            placeholder="0x..."
            value={formSafeAddress}
            onChange={(e) => setFormSafeAddress(e.target.value)}
          />
        </div>
        <details className="group rounded-lg border border-cream-100/10 px-3 py-2.5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-cream-300 hover:text-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400/70">
            Already set up Zodiac Roles for this Safe?
            <svg className="faq-chevron h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="roles-modifier" className="mb-1 block text-sm text-cream-300">
                Roles Modifier address
              </label>
              <input
                id="roles-modifier"
                className={inputBase}
                placeholder="0x..."
                value={formRoles}
                onChange={(e) => setFormRoles(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="role-key" className="mb-1 block text-sm text-cream-300">
                Role key, bytes32
              </label>
              <input
                id="role-key"
                className={inputBase}
                placeholder="0x..."
                value={formRoleKey}
                onChange={(e) => setFormRoleKey(e.target.value)}
              />
            </div>
          </div>
        </details>
        <p className="text-pretty text-xs text-cream-500">
          Not set up yet? No problem - save your Safe now and you&apos;ll get one button here to grant Exit Keepa its
          permission, whenever you&apos;re ready.
        </p>
        {error && <p className="text-pretty text-sm text-danger">{error}</p>}
        <button onClick={registerSafe} className={btnPrimary}>
          Save Safe
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Dashboard</h1>
        {isDemo && (
          <p className="text-pretty text-sm text-cream-400">
            Demo mode - this is your own private sandbox Safe, isolated from every other visitor and not deployed on
            any real chain. Its Roles permission reads as ready so you can walk the full flow; simulating a strategy
            here is mocked and clearly labeled as such, never a real KeeperHub or onchain call.
          </p>
        )}
      </div>

      {error && <p className="text-pretty text-sm text-danger">{error}</p>}

      {safe && (
        <div className={card}>
          <h2 className="mb-2 font-semibold text-cream-50">Your Safe</h2>
          <div className="flex items-center gap-1">
            <p className="break-all font-mono text-sm text-cream-200">{safe.safeAddress}</p>
            <CopyButton value={safe.safeAddress} label="Copy address" />
          </div>
          <p className="text-xs tabular-nums text-cream-400">Chain: Base ({safe.chainId})</p>
          {safe.isSandbox ? (
            <p className="mt-1 text-xs text-mint-300">
              ✓ Roles permission ready to execute through (pre-configured for this private demo sandbox)
            </p>
          ) : safe.rolesModifierAddress && safe.rolesKey ? (
            <p className="mt-1 text-pretty text-xs text-mint-300">
              ✓ READY - Exit Keepa is authorized to execute this exit automatically
            </p>
          ) : (
            // Two genuinely different states, and sending the first one to
            // the Roles app is the dead end people actually hit: that app
            // edits permissions on a Roles Modifier, so for a Safe with no
            // Modifier installed it opens with nothing to configure. Step 1
            // belongs in the Zodiac app instead.
            <div className="mt-2 space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-pretty text-xs text-warning">
                  {safe.rolesModifierAddress
                    ? "Step 2 of 2: grant Exit Keepa its one withdrawal permission, in Safe's own app."
                    : "Step 1 of 2: install Zodiac's Roles Modifier on this Safe, in Safe's own app."}
                </p>
                <a
                  href={
                    safe.rolesModifierAddress
                      ? buildRolesSafeAppUrl(safe.chainId, safe.safeAddress)
                      : buildZodiacModulesSafeAppUrl(safe.chainId, safe.safeAddress)
                  }
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex shrink-0 ${btnSecondarySmall}`}
                >
                  {safe.rolesModifierAddress ? "Grant permission →" : "Install the module →"}
                </a>
              </div>
              <p className="text-pretty text-xs text-cream-500">
                One-time setup. Connect the wallet that&apos;s actually an owner of this Safe when Safe&apos;s app
                asks - it rejects any other wallet. After this, Exit Keepa executes on its own.
              </p>
            </div>
          )}
          {balances && (
            <p className="mt-2 text-sm tabular-nums text-cream-200">
              Balances: ETH {(Number(balances.eth) / 1e18).toFixed(5)} · USDC {(Number(balances.usdc) / 1e6).toFixed(2)}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-cream-50">Your strategies</h2>
        <Link href="/create" className={btnPrimary}>
          + New strategy
        </Link>
      </div>

      {loading && <div className="h-16 animate-pulse rounded-xl border border-cream-100/10 bg-forest-800/40" />}
      {!loading && strategies.length === 0 && (
        <div className="rounded-xl border border-dashed border-cream-100/15 p-6 text-center">
          <p className="text-pretty mb-3 text-sm text-cream-300">No strategies yet. Create one to get started.</p>
          <Link href="/create" className={`inline-flex ${btnPrimary}`}>
            + New strategy
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {strategies.map((s) => (
          <Link
            key={s.id}
            href={`/strategy/${s.id}`}
            className={`block rounded-xl border border-cream-100/10 p-4 hover:border-mint-400/30 ${linkFocus}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium text-cream-50">{s.name}</span>
              <StatusPill status={s.status} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-cream-400">
              Exit when {s.condition.metric} {s.condition.comparator} {s.condition.thresholdBps / 100}%
            </p>
          </Link>
        ))}
      </div>

      <p className="text-xs text-cream-500">
        Explorer:{" "}
        <a
          href={`${BASESCAN}/address/${safe?.safeAddress}`}
          target="_blank"
          rel="noreferrer"
          className={`underline ${linkFocus}`}
        >
          view Safe on BaseScan
        </a>
      </p>
    </div>
  );
}
