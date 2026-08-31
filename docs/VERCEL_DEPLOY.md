# Deploying apps/web to Vercel

`apps/web` builds and typechecks cleanly against the live API
(`https://api-production-2e11.up.railway.app`) — this has been verified
repeatedly in this project's history. The only remaining step is a
manual Vercel deployment: a project named `exit-keepa-web` already
exists, but automated deploy attempts from this environment's connected
Vercel integration return `409 Conflict` (project already exists) on
create and `403 Forbidden` on every read/list against it — almost
certainly because the project was created directly in the Vercel
dashboard, which this integration only gets automatic access to for
projects it creates itself.

## Exact steps

1. Open the [Vercel dashboard](https://vercel.com/dashboard) and find
   the existing `exit-keepa-web` project (or, if none exists in your
   account: **New Project** → import `levithefirst/exit-keepa`).
2. **Root Directory:** `apps/web`
3. **Framework Preset:** Next.js (auto-detected)
4. **Build Command:** leave as default — `apps/web/vercel.json` already
   sets the correct monorepo build command
   (`cd ../.. && npm install && npm run build:web`), which builds
   `packages/shared` before `next build`.
5. **Environment Variable:**
   - `NEXT_PUBLIC_API_URL` = `https://api-production-2e11.up.railway.app`
6. **Deploy.** If the project already existed with a stale/failed
   deployment, trigger **Redeploy** after confirming the environment
   variable above is set, and wait until the deployment status reads
   **Ready**.
7. Once live, verify from a browser (not just that Vercel says Ready):
   - Home page loads and shows the "Live proof" panel.
   - Dashboard → "Try demo mode" → register a Safe → strategies list
     loads (confirms the frontend can reach the Railway API and isn't
     blocked by CORS — the API already sends
     `Access-Control-Allow-Origin` for any origin).
   - Create Strategy → Preview shows a real target/calldata/Roles
     permission block.

## After it's live

Update the **Frontend** line in `README.md` and `docs/SUBMISSION.md`
with the real Vercel URL.
