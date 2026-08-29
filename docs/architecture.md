# Architecture

## Components

- **apps/web** — Next.js + TypeScript frontend, deployed to Vercel.
- **apps/api** — Node.js + TypeScript (Express) backend/API, deployed to
  Railway.
- **packages/shared** — TypeScript types and Zod schemas shared by both
  apps (domain model, API request/response contracts).
- **Neon Postgres** — primary database, accessed from `apps/api` via
  Drizzle ORM over the Neon HTTP driver (`@neondatabase/serverless`).
- **KeeperHub** — execution/reliability layer that runs the automated
  exit workflow once a rate condition is met. See
  `docs/keeperhub-integration.md` for exactly what is and isn't verified.
- **Base** — the chain Safes and exit strategies target.
- **Safe + Zodiac Roles Modifier** — holds the user's position; grants
  KeeperHub's execution account narrowly scoped, revocable rights to
  unwind the position, without exposing the Safe's own keys.

## Request flow (current skeleton)

```
Browser (apps/web)
   │  HTTPS
   ▼
apps/api  ──►  Neon Postgres (safe_accounts, exit_strategies,
   │               keeperhub_executions, audit_events)
   │
   ├──►  KeeperHub REST API (workflows / executions — confirmed subset only)
   │
   ◄──  KeeperHub webhook (execution status → audit_events)
```

## Data model

| Table                 | Purpose                                                            |
|-----------------------|---------------------------------------------------------------------|
| `safe_accounts`       | A user's Safe + its Zodiac Roles Modifier address, per chain.       |
| `exit_strategies`     | A rate condition attached to a Safe, plus the KeeperHub workflow id. |
| `keeperhub_executions`| One row per KeeperHub execution attempt for a strategy.             |
| `audit_events`        | Append-only log of every state change and inbound webhook payload.  |

`audit_events` is intentionally schema-loose (`jsonb payload`) so nothing
is lost while the KeeperHub webhook contract is still being verified
(see `docs/keeperhub-integration.md`).

## Environment & secrets

All configuration is read from environment variables and validated at
boot with Zod (`apps/api/src/env.ts`, `apps/web/lib/env.ts`) — missing or
malformed required values fail startup immediately rather than degrading
silently. See `.env.example` for the full list. No secret is committed to
the repository; Railway and Vercel project settings are the source of
truth for deployed environments.

## Deployment targets (not yet deployed)

- **Railway**: root directory = repo root, uses `apps/api/railway.json`
  (build: `npm install && npm run build:api`, start:
  `npm run start --workspace apps/api`, health check: `/health`).
- **Vercel**: root directory = `apps/web`, uses `apps/web/vercel.json`
  (build steps back up to the repo root to install workspace deps and
  build `packages/shared` before `next build`).
- **Neon**: one project/branch per environment; `DATABASE_URL` supplied
  to Railway only (the frontend never talks to Postgres directly).
