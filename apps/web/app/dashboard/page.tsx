"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildRolesSafeAppUrl } from "@exit-keepa/shared";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId, setStoredSafeId } from "../../lib/storage";
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

  // Resolve which Safe (if any) this address already has, without ever
  // asking a returning wallet - or the demo identity, which already owns
  // the pre-registered live-proof Safe - to type an address in again.
  // Checks local cache first, then falls back to the account's own list
  // of registered Safes.
  useEffect(() => {
    if (!address) return;
    setSafeId(undefined);
    const cached = getStoredSafeId(address);
    if (cached) {
      setSafeId(cached);
      return;
    }
    api
      .listMySafeAccounts()
      .then((mine) => {
        if (mine.length > 0) {
          setStoredSafeId(address, mine[0].id);
          setSafeId(mine[0].id);
        } else {
          setSafeId(null);
        }
      })
      .catch(() => setSafeId(null));
  }, [address]);

  useEffect(() => {
    if (!safeId) return;
    setLoading(true);
    Promise.all([api.getSafeAccount(safeId), api.getSafeBalances(safeId).catch(() => null), api.listStrategies(safeId)])
      .then(([s, b, strats]) => {
        setSafe(s);
        setBalances(b);
        setStrategies(strats);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
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
        <p className="text-pretty text-sm text-cream-300">
          Enter the Safe you want Exit Keepa to protect. If it already has a Zodiac Roles Modifier set up, add its
          address and role key below so your strategies can go live right away.
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
        <div>
          <label htmlFor="roles-modifier" className="mb-1 block text-sm text-cream-300">
            Roles Modifier address <span className="text-cream-500">(optional)</span>
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
            Role key, bytes32 <span className="text-cream-500">(optional)</span>
          </label>
          <input
            id="role-key"
            className={inputBase}
            placeholder="0x..."
            value={formRoleKey}
            onChange={(e) => setFormRoleKey(e.target.value)}
          />
        </div>
        <p className="text-pretty text-xs text-cream-500">
          Don&apos;t have these yet? Leave them blank - you&apos;ll get a guided, step-by-step link to set up Roles
          for this exact Safe right here on the dashboard once it&apos;s saved.
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
        {isDemo && <p className="text-sm text-cream-400">Demo mode - showing the verified live-proof Safe.</p>}
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
          {safe.rolesModifierAddress ? (
            <p className="mt-1 text-xs text-mint-300">✓ Roles permission ready to execute through</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              <p className="text-pretty text-xs text-warning">
                One-time setup needed before this Safe can execute a strategy: enable Zodiac&apos;s Roles Modifier and
                grant the withdraw permission.
              </p>
              <a
                href={buildRolesSafeAppUrl(safe.chainId, safe.safeAddress)}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex shrink-0 ${btnSecondarySmall}`}
              >
                Set up in Zodiac Roles app →
              </a>
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
