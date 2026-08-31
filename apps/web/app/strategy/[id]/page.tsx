"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { STRATEGY_STATUS, EXECUTION_STATUS } from "../../../lib/status";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Card, CardHeader } from "../../../components/ui/Card";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Alert } from "../../../components/ui/Alert";
import { Disclosure } from "../../../components/ui/Disclosure";
import { DataRow } from "../../../components/ui/DataRow";
import { Field, TextInput } from "../../../components/ui/Field";
import { EmptyState } from "../../../components/ui/EmptyState";

const BASESCAN = "https://basescan.org";

export default function StrategyDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [strategy, setStrategy] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [executions, setExecutions] = useState<any[]>([]);
  const [currentRateBps, setCurrentRateBps] = useState("150");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [s, execs] = await Promise.all([api.getStrategy(id), api.listExecutions(id)]);
    setStrategy(s);
    setExecutions(execs);
    try {
      setPreview(await api.previewStrategy(id));
    } catch {
      setPreview(null);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !strategy) return <Alert tone="danger">{error}</Alert>;
  if (!strategy) return <p className="text-sm text-gray-500">Loading…</p>;

  async function createExecution() {
    setBusy(true);
    setError(null);
    try {
      await api.createExecution(id, Number(currentRateBps));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function simulate(executionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.simulateExecution(id, executionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function broadcast(executionId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.broadcastExecution(id, executionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const strategyMeta = STRATEGY_STATUS[strategy.status as keyof typeof STRATEGY_STATUS];

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title={strategy.name}
        action={
          <Badge tone={strategyMeta.tone} pending={strategyMeta.pending}>
            {strategyMeta.label}
          </Badge>
        }
      />

      <Card>
        <CardHeader title="Condition" />
        <p className="text-sm text-gray-300">
          {strategy.condition.market} — exit when {strategy.condition.metric.replace("_", " ")}{" "}
          {strategy.condition.comparator} {strategy.condition.thresholdBps / 100}%
        </p>
      </Card>

      {preview?.tx ? (
        <Disclosure summary="Configured transaction (technical details)">
          <div className="-mt-1">
            <DataRow label="Target">{preview.tx.to}</DataRow>
            <DataRow label="Function">{preview.tx.decodedFunction}</DataRow>
            <DataRow label="Args">{JSON.stringify(preview.tx.decodedArgs)}</DataRow>
            <DataRow label="Calldata">{preview.tx.data}</DataRow>
          </div>
        </Disclosure>
      ) : preview ? (
        <Card className="space-y-3 border-warning/30 bg-warning-soft">
          <CardHeader title={<span className="text-warning">Roles permission not yet granted</span>} description={preview.txError} />
          {preview.rolesPermission && (
            <>
              <div className="-mt-1 -mb-1">
                <DataRow label="Target">
                  {preview.rolesPermission.targetLabel} ({preview.rolesPermission.target})
                </DataRow>
                <DataRow label="Function">
                  {preview.rolesPermission.functionSignature} (selector {preview.rolesPermission.selector})
                </DataRow>
                {preview.rolesPermission.conditions.map((c: any) => (
                  <DataRow key={c.param} label={c.param}>
                    ({c.type}) {c.rule}
                  </DataRow>
                ))}
              </div>
              <a
                href={preview.rolesPermission.safeAppUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm font-medium text-accent underline"
              >
                Open Zodiac Roles app for this Safe →
              </a>
            </>
          )}
        </Card>
      ) : null}

      <Card className="space-y-3">
        <CardHeader
          title="Manual trigger (demo tool)"
          description="Exit Keepa v1 doesn't yet run a live on-chain rate oracle. Enter the current rate to check it against the condition, exactly as a real monitor would."
        />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Current supply APR (bps)">
            <TextInput
              className="w-32"
              value={currentRateBps}
              onChange={(e) => setCurrentRateBps(e.target.value)}
            />
          </Field>
          <Button onClick={createExecution} disabled={busy || strategy.status !== "active"} size="sm">
            Check &amp; create execution
          </Button>
        </div>
        {strategy.status !== "active" && (
          <p className="text-xs text-warning">Activate the strategy from Create Strategy before executing.</p>
        )}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="space-y-4">
        <div>
          <h2 className="font-semibold text-white">Execution history</h2>
          <p className="mt-1 text-xs text-gray-500">
            Simulate previews the outcome with no on-chain effect. Execute broadcasts the real transaction.
          </p>
        </div>

        {executions.length === 0 && (
          <EmptyState title="No executions yet" description="Executions appear here once the condition is checked." />
        )}

        <div className="space-y-3">
          {executions.map((e) => {
            const meta = EXECUTION_STATUS[e.status as keyof typeof EXECUTION_STATUS];
            return (
              <Card key={e.id}>
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={meta.tone} pending={meta.pending}>
                    {meta.label}
                  </Badge>
                  <span className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                {e.errorMessage && (
                  <p className="mt-2 text-sm text-danger">{e.errorMessage}</p>
                )}
                {e.txHash && (
                  <a
                    href={`${BASESCAN}/tx/${e.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="data-mono mt-2 block break-all font-mono text-xs text-accent underline"
                  >
                    {e.txHash}
                  </a>
                )}
                {(e.status === "pending" || e.status === "simulated") && (
                  <div className="mt-3 flex gap-2">
                    {e.status === "pending" && (
                      <Button variant="secondary" size="sm" onClick={() => simulate(e.id)} disabled={busy}>
                        Simulate
                      </Button>
                    )}
                    {e.status === "simulated" && (
                      <Button size="sm" onClick={() => broadcast(e.id)} disabled={busy}>
                        Execute (broadcast)
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
