"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buildCreateSafeUrl } from "@exit-keepa/shared";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { resolveSafeId } from "../../lib/resolveSafeId";
import { setStoredSafeId } from "../../lib/storage";
import { btnPrimary, btnGhost, inputBase, linkFocus, card } from "../../lib/ui";
import { StatusPill } from "../../components/StatusPill";
import { CopyButton } from "../../components/CopyButton";
import { AuthorizationPanel } from "../../components/AuthorizationPanel";

const BASESCAN = "https://basescan.org";
function DashboardSkeleton() { return <div className="mx-auto max-w-2xl animate-pulse space-y-6"><div className="h-7 w-40 rounded bg-cream-100/10" /><div className="h-24 rounded-xl border border-cream-100/10 bg-forest-800/40" /><div className="h-16 rounded-xl border border-cream-100/10 bg-forest-800/40" /></div>; }

export default function DashboardPage() {
  const { address, isDemo, enterDemoMode } = useWallet();
  const [startingDemo, setStartingDemo] = useState(false);
  const [safeId, setSafeId] = useState<string | null | undefined>(undefined);
  const [safe, setSafe] = useState<any>(null);
  const [balances, setBalances] = useState<any>(null);
  const [authorization, setAuthorization] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [formSafeAddress, setFormSafeAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setSafeId(undefined); setSafe(null); setBalances(null); setAuthorization(null); setStrategies([]); setError(null);
    resolveSafeId(address, isDemo).then((id) => { if (!cancelled) setSafeId(id); });
    return () => { cancelled = true; };
  }, [address, isDemo]);

  useEffect(() => {
    if (!safeId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getSafeAccount(safeId), api.getSafeBalances(safeId).catch(() => null), api.listStrategies(safeId), api.getSafeAuthorization(safeId).catch(() => null)])
      .then(([s, b, strats, auth]) => { if (cancelled) return; setSafe(s); setBalances(b); setStrategies(strats); setAuthorization(auth); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [safeId]);

  if (!address) return <div className="rounded-xl border border-dashed border-cream-100/15 p-8 text-center"><p className="text-pretty text-cream-300">Connect your wallet to see your dashboard.</p></div>;
  if (safeId === undefined) return <DashboardSkeleton />;

  async function startDemo() { setStartingDemo(true); try { await enterDemoMode(); } catch {} finally { setStartingDemo(false); } }
  async function refreshAuthorization() {
    if (!safeId) return;
    try { const [auth, s] = await Promise.all([api.getSafeAuthorization(safeId), api.getSafeAccount(safeId)]); setAuthorization(auth); setSafe(s); } catch (err) { setError((err as Error).message); }
  }
  async function registerSafe() {
    setError(null);
    try { const created: any = await api.createSafeAccount({ chainId: 8453, safeAddress: formSafeAddress }); setStoredSafeId(address!, created.id); setSafeId(created.id); }
    catch (err) { setError((err as Error).message); }
  }

  if (!safeId) return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-balance font-display text-2xl font-bold text-cream-50">Connect your Safe</h1>
      <p className="text-pretty text-sm text-cream-300">Enter the Safe address you want Exit Keepa to protect.</p>
      <p className="text-pretty text-xs text-cream-400">Don&apos;t have a Safe yet? <a href={buildCreateSafeUrl(8453)} target="_blank" rel="noreferrer" className={`underline ${linkFocus}`}>Create one on Safe{"{Wallet}"} →</a> then come back here with its address.</p>
      {!isDemo && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cream-100/15 bg-forest-800/40 px-3 py-2"><p className="text-pretty text-xs text-cream-400">Just want to try Exit Keepa first? Skip the real Safe and setup entirely.</p><button onClick={startDemo} disabled={startingDemo} className={`shrink-0 ${btnGhost}`}>{startingDemo ? "Starting demo…" : "Try demo instead →"}</button></div>}
      <div><label htmlFor="safe-address" className="mb-1 block text-sm text-cream-300">Safe address</label><input id="safe-address" className={inputBase} placeholder="0x..." value={formSafeAddress} onChange={(e) => setFormSafeAddress(e.target.value)} /></div>
      <p className="text-pretty text-xs text-cream-500">That&apos;s all we need. Exit Keepa reads the rest from your Safe itself.</p>
      {error && <p className="text-pretty text-sm text-danger">{error}</p>}
      <button onClick={registerSafe} className={btnPrimary}>Save Safe</button>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div><h1 className="text-balance font-display text-2xl font-bold text-cream-50">Dashboard</h1>{isDemo && <p className="text-pretty text-sm text-cream-400">Demo mode - private sandbox, isolated from real execution.</p>}</div>
      {error && <p className="text-pretty text-sm text-danger">{error}</p>}
      {safe && <div className={card}><h2 className="font-display text-lg font-semibold text-cream-50">Protect your Aave position</h2>{balances ? <p className="mt-1 text-pretty text-sm tabular-nums text-cream-200"><span className="font-mono text-base text-cream-50">{(Number(balances.usdc) / 1e6).toFixed(2)} USDC</span> in your Safe on Base{isDemo ? " (demo)" : ""}.</p> : <p className="mt-1 text-pretty text-sm text-cream-300">Your USDC position on Aave v3, Base{isDemo ? " (demo)" : ""}.</p>}
        {authorization?.state === "protected" && <p className="mt-3 text-pretty text-sm text-mint-300">Your Safe is protected.</p>}
        <div className="mt-3"><Link href="/create" className={`inline-flex ${btnPrimary}`}>Protect position →</Link></div>
        <details className="mt-3"><summary className="cursor-pointer text-xs text-cream-500">Safe details</summary><div className="mt-2 space-y-1"><div className="flex items-center gap-1"><p className="break-all font-mono text-xs text-cream-300">{safe.safeAddress}</p><CopyButton value={safe.safeAddress} label="Copy address" /></div><p className="text-xs tabular-nums text-cream-400">Chain: Base ({safe.chainId})</p></div></details>
      </div>}
      {safe && authorization && authorization.state !== "protected" && <AuthorizationPanel status={authorization} safeAddress={safe.safeAddress} chainId={safe.chainId} safeId={safeId} onRecheck={refreshAuthorization} />}
      {strategies.length > 0 && <div className="flex items-center justify-between"><h2 className="font-semibold text-cream-50">Your strategies</h2><Link href="/create" className={btnGhost}>+ New strategy</Link></div>}
      {loading && <div className="h-16 animate-pulse rounded-xl border border-cream-100/10 bg-forest-800/40" />}
      <div className="space-y-3">{strategies.map((s) => <Link key={s.id} href={`/strategy/${s.id}`} className={`block rounded-xl border border-cream-100/10 p-4 hover:border-mint-400/30 ${linkFocus}`}><div className="flex items-center justify-between gap-3"><span className="truncate font-medium text-cream-50">{s.name}</span><StatusPill status={s.status} /></div><p className="mt-1 text-xs tabular-nums text-cream-400">Exit when {s.condition.metric} {s.condition.comparator} {s.condition.thresholdBps / 100}%</p></Link>)}</div>
      <p className="text-xs text-cream-500">Explorer: <a href={`${BASESCAN}/address/${safe?.safeAddress}`} target="_blank" rel="noreferrer" className={`underline ${linkFocus}`}>view Safe on BaseScan</a></p>
    </div>
  );
}
