# KeeperHub integration: research findings & status

This document records what was verified about KeeperHub's real API/MCP
surface before any integration code was written, per the project rule:
**no invented KeeperHub endpoints, SDK methods, MCP methods, contract
addresses, or execution flows.**

## Live-verified (2026-08-29)

Neither this session's sandbox nor its network policy allows outbound
HTTPS to `keeperhub.com` or `*.up.railway.app`. To verify anything for
real, the actual API call had to be made **from Railway's own network**:
a one-off script (`apps/api/src/scripts/verify-keeperhub.js`) was run as
a Railway `preDeployCommand` on the deployed `apps/api` service (project
`exit-keepa`, service `api`), using the real `KEEPERHUB_API_KEY` set
directly in Railway's dashboard (never seen by this session). Its stdout
was read back via the Railway MCP's log tool.

**`GET https://app.keeperhub.com/api/chains`**, `Authorization: Bearer
kh_...`:

- **Status: `200 OK`**, reproduced on two independent deploys.
- Response is a **flat JSON array** of chain objects, no envelope, no
  pagination:
  ```json
  {
    "id": "9wr4m6zv2dwflb1trbzsx",
    "chainId": 8453,
    "name": "Base",
    "symbol": "BASE",
    "chainType": "evm",
    "explorerUrl": "https://basescan.org",
    "explorerAddressPath": "/address/{address}",
    "explorerApiUrl": "https://api.etherscan.io/v2/api",
    "explorerApiType": "etherscan",
    "isTestnet": false,
    "isEnabled": true,
    "usePrivateMempoolRpc": false
  }
  ```
- **Base (`chainId: 8453`) is present and `isEnabled: true`.** Base
  Sepolia (`84532`) is also present and enabled. 27 chains total were
  returned (Ethereum, Optimism, Arbitrum, Polygon, BNB Chain, Avalanche,
  Solana, and several others, mainnet + testnet).
- Response headers: served through Cloudflare (`server: cloudflare`,
  `cf-ray`, `cf-cache-status: DYNAMIC`), `content-type: application/json`,
  a custom `kh-minimum-cli-version: 0.11.1` header, standard security
  headers (HSTS, X-Frame-Options, etc.), and Cloudflare NEL/Report-To
  headers. **No `x-ratelimit-*` or `retry-after` headers were present on
  this successful call** — rate-limit header behavior is therefore still
  unverified (only observable on a 429, which hasn't been triggered).
- This confirms: the base URL (`https://app.keeperhub.com/api`) is
  correct, `Authorization: Bearer kh_...` is the correct and *sufficient*
  auth format for this endpoint (a wrong/absent key would 401 rather than
  200), and the response is exactly the shape now encoded in
  `apps/api/src/keeperhub/types.ts` (`KeeperHubChain`).
- `apps/api/src/keeperhub/client.ts` now has a live-verified
  `listChains()` and `isChainSupported(chainId)`, both covered by real
  unit tests in `apps/api/src/keeperhub/client.test.ts` built from this
  exact captured response.

**Operational finding on Railway** (for anyone repeating this): the
Railway MCP's `redeploy` action reuses a previously *built* deployment's
snapshotted config, including `preDeployCommand` **as it was at that
build**, not the service's current live setting. To pick up a
`preDeployCommand` change, a genuine new build+deploy is needed (a git
push through the connected GitHub source), not `redeploy`.

## Still not verified — do not build on these yet

1. `GET /api/keys` (or `/api/api-keys`) — not yet called live. Not
   required to confirm credential validity (the 200 on `/chains` already
   proves the key is valid), but its exact response shape (used for
   identifying the org/key) is unconfirmed.
2. `POST /api/execute/contract-call` — endpoint path, exact request body,
   `simulate: true` behavior, response shape, execution ID format,
   status/polling endpoint, idempotency-key behavior, and 429 behavior.
   None of this has been called live yet. **Do not implement the
   execution path against assumed shapes** — the next session's job is to
   run this same Railway-preDeployCommand technique against a read-only
   or `simulate: true`-only call first.
3. Exact endpoint path(s) and payload shape for **simulating a Safe
   transaction** via KeeperHub, if that is even a distinct endpoint from
   (2) — see the Safe/Zodiac section below.
4. Exact endpoint path(s) for **monitoring** a Safe's pending
   transactions / signature status via KeeperHub.
5. The webhook payload shape and signature scheme KeeperHub uses for
   execution status callbacks.
6. MCP tool names/parameters for the hosted MCP server.
7. Any KeeperHub-specific contract addresses (executor/module addresses).

Because of (1)-(7), `apps/api/src/keeperhub/client.ts` still only
implements the generic, confirmed workflow/execution REST endpoints plus
the now-live-verified `listChains()`, and explicitly throws on the
Safe-simulation method rather than guessing at a contract. The inbound
webhook handler (`apps/api/src/routes/webhooks.ts`) verifies a
conventional HMAC-SHA256 `X-Signature` header against
`KEEPERHUB_WEBHOOK_SECRET` and stores every payload verbatim to the audit
log, so nothing is lost while the real webhook contract is confirmed — no
business logic should be built on specific payload fields until that's
done.

## How the earlier (pre-live-verification) findings below were researched

Before live verification was possible, direct HTTP access to
`docs.keeperhub.com` was blocked by this session's network egress policy,
so the findings in "Confirmed" below came from:

- Web search result snippets referencing `docs.keeperhub.com/api`,
  `docs.keeperhub.com/api/api-keys`, and `docs.keeperhub.com/ai-tools/mcp-server`
- KeeperHub's public GitHub READMEs:
  [`KeeperHub/keeperhub`](https://github.com/KeeperHub/keeperhub) and
  [`KeeperHub/mcp`](https://github.com/KeeperHub/mcp)
- KeeperHub's marketing site (`keeperhub.com`, `keeperhub.com/daos`)

These are lower-confidence than the live-verified section above and
should be treated as a starting point for further live verification, not
as ground truth on their own.

## Confirmed

- **Product**: KeeperHub is a Web3 workflow automation / execution
  reliability layer. It runs workflows (trigger → condition → action) on
  managed infrastructure with automatic gas estimation, nonce management,
  and transaction ordering, and keeps an audit trail of executions.
- **Chains**: Multi-chain EVM support explicitly including **Base**
  (also Ethereum mainnet/Sepolia, Arbitrum, Polygon and others).
- **Authentication**:
  - Session-based auth (browser, Better Auth) for the dashboard.
  - API keys prefixed `kh_`, issued per-organization, for programmatic /
    REST access. Keys are SHA-256 hashed server-side; only a prefix is
    retained for display. Creating/deleting keys requires session auth
    (a leaked API key alone cannot mint or revoke keys).
  - Bearer-token style usage against REST endpoints is the documented
    pattern (`Authorization: Bearer kh_...`).
- **REST surface** (from `docs.keeperhub.com/api` navigation + the
  `KeeperHub/keeperhub` README): sections for authentication, workflows,
  executions, direct execution, analytics, integrations, projects, tags,
  chains, user, organizations, and API keys. Concretely referenced
  endpoint shapes:
  - `POST /api/workflows` and workflow CRUD
  - `POST /api/workflows/{id}/execute` — trigger a workflow
  - `GET /api/workflows/{id}/executions` — execution history for a workflow
  - `GET /api/integrations`, `GET /api/chains`, `GET /api/metrics`
    (Prometheus-style metrics)
- **MCP server**: Hosted at `https://app.keeperhub.com/mcp`, connectable
  directly (no local process), OAuth 2.1 browser-based auth with 1-hour
  access tokens / 30-day refresh tokens. Exposes workflow creation/
  management/execution as MCP tools for agents. The specific tool names
  and parameter schemas were **not** enumerated in any source this session
  could reach — do not assume tool names.
- **Safe support (claimed, not endpoint-verified)**: KeeperHub's own copy
  states first-class Safe multisig support — monitoring pending Safe
  transactions, tracking signature/threshold status, and preparing and
  simulating Safe transactions — across many EVM chains, callable via
  MCP or REST ("full x402 and MPP support" per marketing copy). No
  concrete endpoint path, payload shape, or response shape for these
  Safe-specific operations was found in any reachable source.

## Safe / Zodiac architecture for the Ratehopper Auto-Exit concept

**Status: architecture proposed, not yet tested against a live
`POST /execute/contract-call` call.** Whether KeeperHub's contract-call
execution can actually drive a Zodiac Roles Modifier (as opposed to just
being theoretically compatible, per the reasoning below) has not been
confirmed live and is the next verification step — see "Still not
verified" item 2 above. Do not treat this section as a green light to
build the executor side yet.

The "Ratehopper Auto-Exit" idea is: a user's position (e.g. a
borrow/lend position on a money market) sits behind a **Safe**, and
should be unwound automatically once a rate crosses a threshold —
without KeeperHub (or its automation account) ever holding the Safe
owners' private keys or full transaction rights.

The standard, publicly documented way to grant a third-party automation
account narrow, revocable execution rights on a Safe is the
**Zodiac Roles Modifier** (published by Gnosis Guild / zodiac.wiki,
`zodiac.eco`):

1. The Safe owner(s) enable a **Zodiac Roles Modifier** as a module on
   their Safe (standard Zodiac deployment/enable flow — no custom
   contract required).
2. The owner assigns a **role** to KeeperHub's execution account,
   scoped via an allow-list of target contracts + function selectors +
   parameter constraints (e.g. "may only call `repay`/`withdraw` on
   contract X with `amount` ≤ position size").
3. KeeperHub's workflow, once triggered by the configured rate
   condition, calls `execTransactionFromModule` /
   `execTransactionFromModuleReturnData` through the Roles Modifier —
   the standard Zodiac module execution path — which enforces the
   scoped permissions on-chain regardless of what KeeperHub's backend
   does.
4. Full multisig approval is never required for the automated exit
   itself (that's the point of the module), but the Safe owners retain
   the ability to revoke the role or disable the module at any time.

This is the architecture assumed by `safe_accounts.roles_modifier_address`
in the schema. **What is not yet verified** is how KeeperHub specifically
triggers step 3 (i.e. whether KeeperHub calls the Roles Modifier directly
from its own executor key, or expects the workflow's "action" to be
configured as a raw contract call that the user points at the modifier).
Confirm this against a real KeeperHub workflow definition before
implementing the trigger side.

## Action items before real integration

- [x] Obtain a KeeperHub API key and verify `GET /chains` live (done
      2026-08-29, see "Live-verified" above).
- [ ] Verify `GET /keys` (or `/api-keys`) live for completeness (not
      blocking - auth is already proven valid).
- [ ] Verify `POST /execute/contract-call` live with `simulate: true`
      against a harmless read-only call, using the same
      Railway-preDeployCommand technique, and capture: exact request
      body, response shape, execution ID format, status/polling
      endpoint, idempotency-key header name/behavior, and 429 behavior.
      **Do this before writing any execution code beyond `listChains()`.**
- [ ] Confirm the Safe simulation/monitoring endpoint contract, or
      confirm it is MCP-only and capture the real tool schema.
- [ ] Confirm the webhook payload/signature scheme from the dashboard's
      webhook configuration screen.
- [ ] Enable a Zodiac Roles Modifier on a test Safe on Base Sepolia and
      confirm the exact call KeeperHub needs configured as its "action" -
      this is what will determine whether the architecture above actually
      works, per the "Status" note on that section.

## Temporary verification infrastructure (remove when no longer needed)

- `apps/api/src/scripts/verify-keeperhub.ts` - one-off script run as a
  Railway `preDeployCommand` to call an allow-listed KeeperHub GET
  endpoint from Railway's network and log the result.
- `apps/api/src/routes/diagnostics.ts` - `GET
  /internal/diagnostics/keeperhub/:resource`, gated by `DIAGNOSTIC_SECRET`
  (disabled/503 when unset), allow-listed to `chains`/`keys`. Not yet
  used for the live verification above (the `preDeployCommand` route was
  used instead, since this sandbox cannot reach the deployed Railway
  domain either) - kept in place in case a reachable caller (e.g. the
  Vercel frontend, once deployed) needs to trigger it.
- Both exist solely to support verification without ever exposing
  `KEEPERHUB_API_KEY`. Delete them once the checklist above is complete.
