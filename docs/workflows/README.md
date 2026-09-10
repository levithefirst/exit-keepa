# Workflow artifacts

This directory holds Exit Keepa's **agent-authored workflow surface**: the
protective exit written down as a KeeperHub workflow definition, so the
shape of the authorized write is reviewable before anything runs.

## What is here

- [`aave-usdc-protective-exit.json`](aave-usdc-protective-exit.json) —
  rate condition → deterministic policy gate → simulated
  `execTransactionWithRole` → a broadcast step that is described but
  carries `enabled: false` and an environment gate.

## What this is not

**It is not how the live proof executed.** Exit Keepa's real, landed
execution on Base mainnet
(tx [`0xc8a00cc2…49fd8b`](https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b),
KeeperHub execution `u9zr4vzbfurjvzgwz687g`) went through KeeperHub's
**Direct Execution REST** API: `POST /execute/contract-call` with
`simulate: true`, then the identical body with an `Idempotency-Key`, then
`GET /execute/{executionId}/status` until a receipt confirmed it. See
[`../SUBMISSION.md`](../SUBMISSION.md) §3 and §6.

**It is not a second write path.** Nothing in this repository calls
`POST /workflows` or `POST /workflows/{id}/execute` with this document.
It is validated and read; it is never registered and never executed. The
document records both facts in its own `surface`, `liveProofSurface` and
`registeredWithKeeperhub` fields, so it cannot quietly come to imply
otherwise.

## Why an artifact rather than a live second write

The Direct Execution path is the one that has actually moved value, and
it is the one under test. Registering a workflow to demonstrate the
workflow surface would mean introducing an unproven second way to move
real funds for the sake of a checkbox. Writing it down instead keeps the
agent-facing surface inspectable without that trade.

## Validation

The schema lives in
[`packages/shared/src/workflows/keeperhubWorkflow.ts`](../../packages/shared/src/workflows/keeperhubWorkflow.ts)
and enforces the invariants rather than leaving them to review. It
rejects:

- a `simulate: false` step that is not both `enabled: false` and gated on
  `EXIT_KEEPA_ALLOW_BROADCAST=1`;
- a broadcast step that comes before the simulate step it depends on;
- more than one broadcast step;
- a missing simulate step, or a missing policy-check step;
- an inner call targeting anything but the Aave v3 Base Pool;
- an asset other than Base USDC;
- a recipient other than the literal `"safe"`.

Run it:

```bash
npm run test --workspace packages/shared
```

The tests validate the shipped file itself, not a fixture copy — if this
directory's JSON drifts from the invariants, that suite fails.
