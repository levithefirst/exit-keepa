"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId, setStoredSafeId } from "../../lib/storage";
import { btnPrimary, btnSecondary, inputBase, linkFocus } from "../../lib/ui";
import { StatusPill } from "../../components/StatusPill";
import { CopyButton } from "../../components/CopyButton";

const BASESCAN = "https://basescan.org";
const DEMO_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const DEMO_ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const DEMO_ROLE_KEY = "0x657869745f6b6565706100000000000000000000000000000000000000000000";

function StrategyRowSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-white/10 p-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-40 rounded bg-white/10" />
        <div className="h-4 w-16 rounded bg-white/10" />
      </div>
      <div className="mt-2 h-3 w-56 rounded bg-white/5" />
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
    return <p className="text-pretty text-gray-400">Connect your wallet to see your dashboard.</p>;
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
        <h1 className="text-balance text-2xl font-bold text-white">Connect your Safe</h1>
        <p className="text-pretty text-sm text-gray-400">
          Enter the Safe you want Exit Keepa to protect. If it already has a Zodiac Roles Modifier enabled, add its
          address and role key so strategies can be activated immediately.
        </p>
        <div>
          <label htmlFor="safe-address" className="mb-1 block text-sm text-gray-400">
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
          <label htmlFor="roles-modifier" className="mb-1 block text-sm text-gray-400">
            Roles Modifier address <span className="text-gray-600">(optional)</span>
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
          <label htmlFor="role-key" className="mb-1 block text-sm text-gray-400">
            Role key, bytes32 <span className="text-gray-600">(optional)</span>
          </label>
          <input
            id="role-key"
            className={inputBase}
            placeholder="0x..."
            value={formRoleKey}
            onChange={(e) => setFormRoleKey(e.target.value)}
          />
        </div>
        {error && <p className="text-pretty text-sm text-red-400">{error}</p>}
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
        <h1 className="text-balance text-2xl font-bold text-white">Dashboard</h1>
        <p className="break-all text-sm text-gray-400">Connected: {address}</p>
      </div>

      {safe && (
        <div className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-2 font-semibold text-white">Safe</h2>
          <div className="flex items-center gap-1">
            <p className="break-all font-mono text-sm text-gray-300">{safe.safeAddress}</p>
            <CopyButton value={safe.safeAddress} label="Copy address" />
          </div>
          <p className="text-xs tabular-nums text-gray-500">Chain: Base ({safe.chainId})</p>
          <p className="text-xs text-gray-500">
            Roles Modifier: {safe.rolesModifierAddress ?? <span className="text-yellow-400">not configured</span>}
          </p>
          {balances && (
            <p className="mt-2 text-sm tabular-nums text-gray-300">
              Balances — ETH: {(Number(balances.eth) / 1e18).toFixed(5)} · USDC: {(Number(balances.usdc) / 1e6).toFixed(2)}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Your strategies</h2>
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
        <div className="rounded-lg border border-dashed border-white/15 p-6 text-center">
          <p className="text-pretty mb-3 text-sm text-gray-400">No strategies yet — create one to get started.</p>
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
            className={`block rounded-lg border border-white/10 p-4 hover:border-white/30 ${linkFocus}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium text-white">{s.name}</span>
              <StatusPill status={s.status} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-gray-500">
              Exit when {s.condition.metric} {s.condition.comparator} {s.condition.thresholdBps / 100}%
            </p>
          </Link>
        ))}
      </div>

      <p className="text-xs text-gray-600">
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
