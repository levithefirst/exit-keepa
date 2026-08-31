"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import { getStoredSafeId, setStoredSafeId } from "../../lib/storage";
import { STRATEGY_STATUS } from "../../lib/status";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button, LinkButton } from "../../components/ui/Button";
import { Field, TextInput } from "../../components/ui/Field";
import { Alert } from "../../components/ui/Alert";
import { EmptyState } from "../../components/ui/EmptyState";

const BASESCAN = "https://basescan.org";
const DEMO_SAFE = "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9";
const DEMO_ROLES_MODIFIER = "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE";
const DEMO_ROLE_KEY = "0x657869745f6b6565706100000000000000000000000000000000000000000000";

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
      <EmptyState
        title="Connect your wallet to see your dashboard"
        description="You'll be able to register a Safe and manage exit strategies once connected."
      />
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
      <div className="max-w-lg space-y-6">
        <PageHeader
          eyebrow="Step 1 of 1"
          title="Connect your Safe"
          description="Enter the Safe you want Exit Keepa to protect. If it already has a Zodiac Roles Modifier enabled, add its address and role key so strategies can be activated immediately."
        />
        <Card className="space-y-4">
          <Field label="Safe address" hint="The Gnosis Safe holding the position you want to protect.">
            <TextInput
              placeholder="0x..."
              value={formSafeAddress}
              onChange={(e) => setFormSafeAddress(e.target.value)}
            />
          </Field>
          <Field label="Roles Modifier address" hint="Optional — you can add this later from the strategy review screen.">
            <TextInput
              placeholder="0x... (optional)"
              value={formRoles}
              onChange={(e) => setFormRoles(e.target.value)}
            />
          </Field>
          <Field label="Role key" hint="bytes32 value (optional).">
            <TextInput
              placeholder="0x... (optional)"
              value={formRoleKey}
              onChange={(e) => setFormRoleKey(e.target.value)}
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex gap-3 pt-1">
            <Button onClick={registerSafe} disabled={!formSafeAddress}>
              Save Safe
            </Button>
            {isDemo && (
              <Button
                variant="secondary"
                onClick={() => {
                  setFormSafeAddress(DEMO_SAFE);
                  setFormRoles(DEMO_ROLES_MODIFIER);
                  setFormRoleKey(DEMO_ROLE_KEY);
                }}
              >
                Fill in the live demo Safe
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        description={`Connected: ${address}`}
      />

      {safe && (
        <Card>
          <CardHeader
            title="Safe"
            action={
              <a
                href={`${BASESCAN}/address/${safe.safeAddress}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gray-400 underline hover:text-white"
              >
                View on BaseScan
              </a>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-gray-500">Address</p>
              <p className="data-mono mt-0.5 break-all font-mono text-sm text-gray-200">{safe.safeAddress}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Chain</p>
              <p className="mt-0.5 text-sm text-gray-200">Base ({safe.chainId})</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Roles Modifier</p>
              <p className="mt-0.5">
                {safe.rolesModifierAddress ? (
                  <span className="data-mono break-all font-mono text-sm text-gray-200">
                    {safe.rolesModifierAddress}
                  </span>
                ) : (
                  <Badge tone="warning">Not configured</Badge>
                )}
              </p>
            </div>
            {balances && (
              <div>
                <p className="text-xs text-gray-500">Balances</p>
                <p className="data-mono mt-0.5 font-mono text-sm text-gray-200">
                  {(Number(balances.eth) / 1e18).toFixed(5)} ETH · {(Number(balances.usdc) / 1e6).toFixed(2)} USDC
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Your strategies</h2>
          <LinkButton href="/create" size="sm">
            + New Strategy
          </LinkButton>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && strategies.length === 0 && (
          <EmptyState
            title="No strategies yet"
            description="Create one to start protecting a position on a schedule you define."
            action={
              <LinkButton href="/create" size="sm">
                Create your first strategy
              </LinkButton>
            }
          />
        )}

        <div className="space-y-3">
          {strategies.map((s) => {
            const meta = STRATEGY_STATUS[s.status as keyof typeof STRATEGY_STATUS];
            return (
              <Link key={s.id} href={`/strategy/${s.id}`}>
                <Card interactive className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{s.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Exit when {s.condition.metric.replace("_", " ")} {s.condition.comparator}{" "}
                      {s.condition.thresholdBps / 100}%
                    </p>
                  </div>
                  <Badge tone={meta.tone} pending={meta.pending}>
                    {meta.label}
                  </Badge>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
