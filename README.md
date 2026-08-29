# Exit Keepa

Automated Safe exit strategies for onchain positions on **Base** —
monitored against a rate condition and executed reliably via
**KeeperHub**, through a **Zodiac Roles Modifier** on the user's Safe so
the automation never holds the Safe's keys.

> **Status: project skeleton.** Nothing is deployed yet, no wallet is
> funded, and the KeeperHub integration is deliberately limited to what
> could be verified in `docs/keeperhub-integration.md`. See that file
> before extending the KeeperHub client.

## Stack

| Concern                    | Choice                                         |
|-----------------------------|------------------------------------------------|
| Frontend                    | Next.js (App Router) + TypeScript, on Vercel   |
| Backend / API                | Node.js + TypeScript (Express), on Railway     |
| Database                    | Neon Postgres (Drizzle ORM)                    |
| Chain                       | Base                                           |
| Transaction execution        | KeeperHub                                      |
| Safe automation permissions | Zodiac Roles Modifier                          |

## Repository layout

```
exit-keepa/
├── apps/
│   ├── web/            Next.js frontend (Vercel)
│   └── api/             Express backend (Railway)
├── packages/
│   └── shared/          Shared TS types + Zod schemas
├── docs/
│   ├── architecture.md
│   └── keeperhub-integration.md   ← read this before touching KeeperHub code
├── .env.example
└── package.json          npm workspaces root
```

## Prerequisites

- Node.js >= 20
- A Neon Postgres database
- A KeeperHub account + API key (`kh_...`)

## Local setup

```bash
npm install

cp .env.example apps/api/.env
cp .env.example apps/web/.env.local   # only NEXT_PUBLIC_* vars are read
```

Fill in `apps/api/.env` with a real `DATABASE_URL`, `KEEPERHUB_API_KEY`,
and `KEEPERHUB_WEBHOOK_SECRET`. Never commit this file.

Run the migration against your Neon database:

```bash
npm run db:migrate
```

Start both apps in dev mode (in separate terminals):

```bash
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000
```

Health checks:

- API: `GET http://localhost:4000/health`
- Web: `GET http://localhost:3000/api/health`

## Environment variables

See `.env.example` for the full, documented list. All values are
validated at process startup (`apps/api/src/env.ts`,
`apps/web/lib/env.ts`) — the app refuses to boot with missing or
malformed required configuration rather than running in a degraded
state. No secret ships in the repo; secrets are supplied via Railway and
Vercel's environment variable settings at deploy time.

## Database

Schema lives in `apps/api/src/db/schema.ts` (Drizzle ORM). The initial
migration is checked in at `apps/api/drizzle/0000_init.sql`. After
changing the schema, regenerate migrations rather than hand-editing SQL:

```bash
npm run db:generate --workspace apps/api
```

Tables: `safe_accounts`, `exit_strategies`, `keeperhub_executions`, and an
append-only `audit_events` log used for every state change and every
inbound KeeperHub webhook payload.

## KeeperHub integration

`apps/api/src/keeperhub/client.ts` wraps only the KeeperHub REST
endpoints that were confirmed during research (generic workflow create /
execute / list-executions). Safe-specific simulation is **not**
implemented — it throws deliberately — because the exact endpoint
contract could not be verified from this environment (network egress to
`docs.keeperhub.com` was blocked). Read
[`docs/keeperhub-integration.md`](docs/keeperhub-integration.md) for the
full research trail, what's confirmed vs. open, and the Safe/Zodiac Roles
Modifier plan for how KeeperHub is expected to execute an exit without
holding Safe keys. Verify open items against a real KeeperHub API key /
MCP session before building further on top of it.

## Deployment (not yet performed)

- **Backend → Railway**: point a Railway service at this repo with root
  directory = repo root; `apps/api/railway.json` defines the build/start
  commands and `/health` health check. Set all `apps/api` variables from
  `.env.example` in the Railway service's environment settings.
- **Frontend → Vercel**: point a Vercel project at this repo with root
  directory = `apps/web`; `apps/web/vercel.json` builds the workspace
  from the repo root so `packages/shared` is built first. Set
  `NEXT_PUBLIC_API_URL` (and any other `NEXT_PUBLIC_*` vars) in the
  Vercel project's environment settings.
- **Database → Neon**: create a Neon project, copy the pooled connection
  string into Railway's `DATABASE_URL`, run migrations against it.

Do not deploy or fund a wallet until the open items in
`docs/keeperhub-integration.md` are resolved.
