"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId, setStoredSafeId } from "../../lib/storage";
import { btnPrimary, btnSecondary, inputBase, linkFocus, card } from "../../lib/ui";
import { StatusPill } from "../../components/StatusPill";
import { CopyButton } from "../../components/CopyButton";
import { AnalyticsChart } from "../../components/AnalyticsChart";

const BASESCAN = "https://basescan.org";
const DEMO_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const DEMO_ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const DEMO_ROLE_KEY = "0x657869745f6b6565706100000000000000000000000000000000000000000000";

function StrategyRowSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-cream-100/10 p-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-40 rounded bg-cream-100/10" />
        <div className="h-4 w-16 rounded bg-cream-100/10" />
      </div>
      <div className="mt-2 h-3 w-56 rounded bg-cream-100/5" />
    </div>
  );
}

export default function DashboardPage() {
  const { address, isDemo } = useWallet();
  const [safeId, setSafeId] = useState<string | null>(null);
  const [safe, setSafe] = useState<any>(null);
  const [balances, setBalances] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [formSafeAddress, setFormSafeAddress] = useState("");
  const [formRoles, setFormRoles] = useState("");
  const [formRoleKey, setFormRoleKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (address) setSafeId(getStoredSafeId(address));
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
      <div className="max-w-md space-y-4">
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Connect your Safe</h1>
        <p className="text-pretty text-sm text-cream-300">
          Enter the Safe you want Exit Keepa to protect. If it already has a Zodiac Roles Modifier set up, add its
          address and role key below so your strategies can go live right away.
        </p>
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
        {error && <p className="text-pretty text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button onClick={registerSafe} className={btnPrimary}>
            Save Safe
          </button>
          {isDemo && (
            <button
              onClick={() => {
                setFormSafeAddress(DEMO_SAFE);
                setFormRoles(DEMO_ROLES_MODIFIER);
                setFormRoleKey(DEMO_ROLE_KEY);
              }}
              className={btnSecondary}
            >
              Fill in the live demo Safe
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Dashboard</h1>
        <p className="break-all text-sm text-cream-400">Connected: {address}</p>
      </div>

      {safe && (
        <div className={card}>
          <h2 className="mb-2 font-semibold text-cream-50">Safe</h2>
          <div className="flex items-center gap-1">
            <p className="break-all font-mono text-sm text-cream-200">{safe.safeAddress}</p>
            <CopyButton value={safe.safeAddress} label="Copy address" />
          </div>
          <p className="text-xs tabular-nums text-cream-400">Chain: Base ({safe.chainId})</p>
          <p className="text-xs text-cream-400">
            Roles Modifier: {safe.rolesModifierAddress ?? <span className="text-warning">not configured</span>}
          </p>
          {balances && (
            <p className="mt-2 text-sm tabular-nums text-cream-200">
              Balances: ETH {(Number(balances.eth) / 1e18).toFixed(5)} · USDC {(Number(balances.usdc) / 1e6).toFixed(2)}
            </p>
          )}
        </div>
      )}

      <AnalyticsChart />

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-cream-50">Your strategies</h2>
        <Link href="/create" className={btnPrimary}>
          + New strategy
        </Link>
      </div>

      {loading && (
        <div className="space-y-3">
          <StrategyRowSkeleton />
          <StrategyRowSkeleton />
        </div>
      )}
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
