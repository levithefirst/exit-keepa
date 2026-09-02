# Deploying apps/web to Vercel

**Status: resolved.** `https://exit-keepa-web.vercel.app` is live in
production today. This document is kept as the historical record of the
one-time dashboard fix (Root Directory) that got it there — read it as
"what was wrong and how it was fixed," not as a description of the
current state.

## Root cause of the `DEPLOYMENT_NOT_FOUND` / 404 at exit-keepa-web.vercel.app

The Vercel project `exit-keepa-web` (`prj_XQ4CPPcWdLlWMCJV4wNdK2rMb3vh`, team
`levithefirst-1227s-projects`) exists and is linked to this GitHub repo, but
**every one of its 17 deployments has failed** with the same build error:

```
Error: No Next.js version detected. Make sure your package.json has "next"
in either "dependencies" or "devDependencies". Also check your Root
Directory setting matches the directory of your package.json file.
```

That happens when Vercel builds from the **repo root** instead of
`apps/web` — i.e. the project's **Root Directory** setting is unset/wrong.
Because there has never been a single successful production deployment,
Vercel never activates the short `exit-keepa-web.vercel.app` alias for the
project, so it returns `DEPLOYMENT_NOT_FOUND`. This is a pure Vercel
project-settings problem, not a code problem: `npm run build:web` was
verified to build cleanly in this environment (Next 14.2.35, 7/7 static
pages generated, 0 errors) once run from the correct directory.

An earlier deploy attempt in this project's history hit `403`/`409` trying
to reach this same project through the Vercel API/MCP integration; that is
no longer the blocker — the project and its full deployment history are now
readable. The current MCP tools available in this environment can read
projects/deployments/logs but have **no call that updates an existing
project's Root Directory or environment variables**, so that one setting
has to be changed by a human in the dashboard.

## Repo fixes already made

- `apps/web/next.config.mjs`: `NEXT_PUBLIC_API_URL` now falls back to the
  live Railway API (`https://api-production-2e11.up.railway.app`) at build
  time if the env var isn't set, so a missing dashboard env var can never
  crash the build (`apps/web/lib/env.ts` does a strict `z.string().url()`
  parse on it). This does not touch product/Safe/Roles logic — it's a
  build-time default only.
- `apps/web/vercel.json` (already correct, unchanged): sets
  `buildCommand: "cd ../.. && npm install && npm run build:web"`, which
  builds `packages/shared` before `apps/web`. This only works correctly
  once Root Directory is `apps/web` (the `cd ../..` assumes that).

## Exact steps (one-time, dashboard only)

1. Open the [Vercel dashboard](https://vercel.com/dashboard) →
   `levithefirst-1227's projects` → **exit-keepa-web** → **Settings** →
   **General**.
2. **Root Directory:** set to `apps/web`. Also enable **"Include source
   files outside of the Root Directory in the Build Step"** — required
   because `apps/web/vercel.json`'s build command does `cd ../..` to reach
   the monorepo root (`package.json`, `package-lock.json`,
   `packages/shared`).
3. **Framework Preset:** Next.js (auto-detected once Root Directory is
   correct).
4. **Build & Install Commands:** leave as default — `apps/web/vercel.json`
   already sets the correct monorepo build command.
5. **Settings → Environment Variables** (Production):
   - `NEXT_PUBLIC_API_URL` = `https://api-production-2e11.up.railway.app`
   - (Now optional thanks to the fallback above, but still recommended so
     the dashboard reflects the real production config explicitly.)
6. **Deployments** tab → open the latest deployment → **Redeploy**. Wait
   until it reads **Ready**.
   - If you want the `next.config.mjs` fallback included, redeploy from
     branch `claude/exit-keepa-vercel-deploy-ubrc0w` (or merge it into
     `claude/exit-keepa-init-v5lzuy`, which is this repo's current
     production branch) instead of redeploying the old commit.
7. Once Ready, verify from a browser (not just that Vercel says Ready):
   - `https://exit-keepa-web.vercel.app/` loads and shows the "Live proof"
     panel.
   - Dashboard → "Try demo" → the auto-provisioned sandbox Safe and its
     (empty) strategies list load (confirms the frontend can reach the
     Railway API and isn't blocked by CORS).
   - Create Strategy → Preview shows a real target/calldata/Roles
     permission block.

## If the build logs show anything else

Paste the output of the failing deployment's build log (Vercel dashboard →
that deployment → "Build Logs", or `errorsOnly` view) — most likely
candidates if it's *not* the Root Directory error above:

- `Module not found: @exit-keepa/shared` → "Include source files outside
  of the Root Directory" is off.
- A `zod`/`NEXT_PUBLIC_API_URL` parse error → the `next.config.mjs`
  fallback isn't in the deployed commit (redeploy from a commit that
  includes it, or set the env var directly).

## After it's live

Update the **Frontend** line in `README.md` and `docs/SUBMISSION.md` with
the real Vercel URL.
