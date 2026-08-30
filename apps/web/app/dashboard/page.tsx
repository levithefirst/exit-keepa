"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId, setStoredSafeId } from "../../lib/storage";

const BASESCAN = "https://basescan.org";

export default function DashboardPage() {
  const { address } = useWallet();
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
    return <p className="text-gray-400">Connect your wallet to see your dashboard.</p>;
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
        <h1 className="text-2xl font-bold text-white">Connect your Safe</h1>
        <p className="text-sm text-gray-400">
          Enter the Safe you want Exit Keepa to protect. If it already has a Zodiac Roles Modifier enabled, add its
          address and role key so strategies can be activated immediately.
        </p>
        <input
          className="w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm"
          placeholder="Safe address (0x...)"
          value={formSafeAddress}
          onChange={(e) => setFormSafeAddress(e.target.value)}
        />
        <input
          className="w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm"
          placeholder="Roles Modifier address (optional)"
          value={formRoles}
          onChange={(e) => setFormRoles(e.target.value)}
        />
        <input
          className="w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm"
          placeholder="Role key, bytes32 (optional)"
          value={formRoleKey}
          onChange={(e) => setFormRoleKey(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button onClick={registerSafe} className="rounded bg-accent px-4 py-2 text-sm font-medium text-black">
          Save Safe
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400">Connected: {address}</p>
      </div>

      {safe && (
        <div className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-2 font-semibold text-white">Safe</h2>
          <p className="font-mono text-sm text-gray-300">{safe.safeAddress}</p>
          <p className="text-xs text-gray-500">Chain: Base ({safe.chainId})</p>
          <p className="text-xs text-gray-500">
            Roles Modifier: {safe.rolesModifierAddress ?? <span className="text-yellow-400">not configured</span>}
          </p>
          {balances && (
            <p className="mt-2 text-sm text-gray-300">
              Balances — ETH: {(Number(balances.eth) / 1e18).toFixed(5)} · USDC: {(Number(balances.usdc) / 1e6).toFixed(2)}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Your Strategies</h2>
        <Link href="/create" className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-black">
          + New Strategy
        </Link>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {!loading && strategies.length === 0 && (
        <p className="text-sm text-gray-500">No strategies yet. Create one to get started.</p>
      )}

      <div className="space-y-3">
        {strategies.map((s) => (
          <Link
            key={s.id}
            href={`/strategy/${s.id}`}
            className="block rounded-lg border border-white/10 p-4 hover:border-accent/50"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-white">{s.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  s.status === "active" ? "bg-accent/20 text-accent" : "bg-white/10 text-gray-400"
                }`}
              >
                {s.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Exit when {s.condition.metric} {s.condition.comparator} {s.condition.thresholdBps / 100}%
            </p>
          </Link>
        ))}
      </div>

      <p className="text-xs text-gray-600">
        Explorer:{" "}
        <a href={`${BASESCAN}/address/${safe?.safeAddress}`} target="_blank" rel="noreferrer" className="underline">
          view Safe on BaseScan
        </a>
      </p>
    </div>
  );
}
