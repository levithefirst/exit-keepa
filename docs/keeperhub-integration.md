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
Railway MCP's `redeploy` action reuses a previously *built* deployment
and does not re-run `preDeployCommand` at all (no log output from it on
a `redeploy`, even after changing the command via `update-service`
first). Only a genuine new build+deploy (a git push through the
connected GitHub source) reliably runs `preDeployCommand` against the
service's current setting. Concretely: `update-service` changes are
picked up by a build already in the `BUILDING` phase when it later
reaches the pre-deploy stage - so calling `update-service` right after
pushing, before the build finishes, works - but `redeploy` on an
already-finished deployment does not.

## Live-verified (2026-08-30): `POST /execute/contract-call`

Same technique as above (Railway `preDeployCommand` + Railway MCP log
read, real key never leaving Railway's dashboard). Rather than guess the
request schema, each round sent an intentionally incomplete body and
read back KeeperHub's own validation error, which names exactly one
missing/invalid field per response - five real HTTP round trips total,
each to the real API:

| # | Request body sent | Response |
|---|---|---|
| 1 | `{}` | `400` `{"error":"Missing required field","field":"contractAddress","details":"contractAddress is required and must be a non-empty string"}` |
| 2 | `{contractAddress}` | `400` `{"error":"Missing required field","field":"chainId","details":"chainId is required (network is accepted as a deprecated alias). Pass a numeric chain ID or a known chain name."}` |
| 3 | `{contractAddress, chainId}` | `400` `{"error":"Missing required field","field":"functionName","details":"functionName is required and must be a non-empty string"}` |
| 4 | `{contractAddress, chainId, functionName}` | **`200`** `{"result":"18"}` |
| 5 | same as #4 plus `simulate: true` | **`200`** `{"result":"18"}` - byte-identical to #4 |

The harmless call used throughout: `contractAddress:
"0x4200000000000000000000000000000000000006"` (Base's canonical WETH9
predeploy, per Base's own docs), `chainId: 8453`, `functionName:
"decimals"` - a pure/view getter that cannot move funds, mutate state,
approve, transfer, or touch any Safe/Zodiac contract. `18` is the
correct real answer, confirming the call actually reached the chain (or
an accurate simulation of it) rather than returning a stub.

**What this confirms:**

- **Endpoint and auth**: `POST https://app.keeperhub.com/api/execute/contract-call`,
  `Authorization: Bearer kh_...`, `Content-Type: application/json` - all
  correct.
- **Minimal required request fields**: `contractAddress` (string),
  `chainId` (number - `network` is accepted as a "deprecated alias",
  itself a useful fact: an older, presumably string-based `network`
  field once existed), `functionName` (string). No ABI needs to be
  supplied for this well-known function - KeeperHub resolves it itself
  (plausibly via the block explorer API each chain's `/chains` entry
  already exposes as `explorerApiUrl`/`explorerApiType`, e.g. Etherscan-
  style source verification - plausible, not confirmed).
- **Response shape for this case**: flat and synchronous -
  `{"result": "18"}`. No execution ID, no status field, no envelope. No
  polling was needed or possible to observe, because none was returned.
- **`simulate: true` had zero observable effect** on this call. Same
  status, same body, byte-for-byte.
- **Rate limiting**: real headers appeared on the `200` responses (they
  were absent on `/chains`, so this is endpoint-specific or just
  hadn't been observed before): both `ratelimit-limit` /
  `ratelimit-remaining` / `ratelimit-reset` (reset in seconds, e.g. `61`)
  and a duplicate `x-ratelimit-limit` / `x-ratelimit-remaining` /
  `x-ratelimit-reset` (reset as a Unix timestamp) convention. Limit
  observed: `60`. A `429` itself was never triggered, so its exact body
  shape and whether it includes a `retry-after` header remain
  unverified.
- **No idempotency-key header was sent or required** for this call to
  succeed - but this was a read-only, non-state-changing call, so this
  says nothing about whether a real execute call requires or supports
  one.

**What this does NOT confirm - do not assume these:**

- How to pass **arguments** to a function that takes any -
  **now confirmed for a plain `address` argument, see the next section**.
  Still unconfirmed for any other argument type (in particular `bytes`).
- Whether **`value`** (sending native currency) uses that field name -
  never sent, never required, because `decimals()` isn't payable.
- Whether or how a **state-changing call** differs: request shape,
  whether `simulate: true` actually prevents broadcast for one, response
  shape (execution ID? a status field?), and whether a **separate
  polling/status endpoint** exists at all. Nothing in the five requests
  above touched a state-changing call, deliberately, per the safety
  constraints for this round.
- The exact **`429` response body/headers**.
- Whether an **idempotency-key** header is supported/required for a
  write call.

`apps/api/src/keeperhub/client.ts` now has `callContractFunction()`,
live-verified for both the zero-argument and single-argument read-only
cases, with its doc comment and `ContractCallRequest`'s doc comment (in
`apps/api/src/keeperhub/types.ts`) both stating this scope explicitly.
Real unit tests in `apps/api/src/keeperhub/client.test.ts` are built
from this exact captured request/response data, including the three
validation-error shapes.

## Live-verified (2026-08-30): passing function arguments (`functionArgs`)

Same technique again: intentionally incomplete/wrong bodies, real
responses read back, nothing guessed. Target: `balanceOf(address)` on
the same Base WETH9 contract (`0x4200...0006`, already proven valid),
queried against the zero address (`0x0000...0000`) - still a pure/view
read, no funds/state/approvals/transfers/Safe/Zodiac involved regardless
of argument encoding or `simulate` behavior. (An initial attempt used a
from-memory Base USDC address, which KeeperHub rejected outright as
`"Invalid contract address"` - likely a checksum transcription error on
my part - so the already-proven WETH9 address was used instead rather
than guess-correcting the USDC one.)

| # | Request body sent (relevant fields) | Response |
|---|---|---|
| 1 | `functionName: "balanceOf"`, no argument field at all | `400` `{"error":"Contract call failed: RPC failed on both endpoints. Primary: no matching fragment (operation=\"fragment\", info={ \"args\": [ ], \"key\": \"balanceOf\" }, code=UNSUPPORTED_OPERATION). Fallback: ..."}` |
| 2 | `args: ["0x000...000"]` (native array, natural-seeming field name) | Same error, `args` silently ignored - `info.args` in the error is still `[ ]` |
| 3 | `functionArgs: ["0x000...000"]` (native array) | `400` `{"error":"Invalid field type","field":"functionArgs","details":"functionArgs must be a JSON string when provided"}` |
| 4 | `functionArgs: JSON.stringify(["0x000...000"])` (JSON-**stringified**) | **`200`** `{"result":"3328703018194595557"}` |
| 5 | `functionArgs: JSON.stringify(["0x000...000", "0x000...000"])` (2 args for a 1-arg function) | `400` - same `"no matching fragment"` shape as round 1, now showing both args in `info.args`, confirming they were correctly parsed from the JSON string this time |

**What this confirms:**

- **The real field name is `functionArgs`, and it is a JSON-*stringified*
  array**, not a native JSON array nested in the request body. This is
  genuinely counterintuitive - `args` (a very reasonable first guess) is
  silently accepted and silently ignored rather than rejected, which
  would have produced a confusing false negative if round 1's error
  hadn't been read carefully (`info.args: []` in the error, even though
  `args` had a value in the request).
- **KeeperHub uses ethers.js internally**, with primary + fallback RPC
  endpoints per call - the literal error text (`no matching fragment`,
  `operation="fragment"`, `code=UNSUPPORTED_OPERATION`) is ethers.js
  v6's own `Interface` fragment-lookup error format, not a KeeperHub
  wrapper message.
- **Two distinct error shapes exist**: a pre-flight
  `{error, field, details}` validation shape (missing/wrong-typed
  top-level fields - rounds prior to this table, and round 3 above), and
  a downstream `{error: "Contract call failed: ..."}` execution-error
  shape (ABI/fragment mismatch, rounds 1, 2, 5 above) - both at HTTP
  `400`.
- **A single `address`-typed argument works** and returns the real
  on-chain value (`3328703018194595557` wei of WETH at the zero address
  - a genuine value, not a stub).
- **The malformed-argument case (wrong count) is safely observable**
  and produces the fragment-mismatch error, not a crash or a silent
  wrong answer.

**What this does NOT confirm:**

- Encoding for any other argument type - **especially `bytes`** (a
  variable-length hex string), which is exactly what a nested call's
  calldata would need to be for the Zodiac question below. Only a
  20-byte `address` value inside the JSON-stringified array has been
  verified.
- Whether multiple arguments of mixed types serialize correctly (only
  two identical `address` values were tested, deliberately, to isolate
  the count-mismatch error rather than a type-mismatch error).
- Anything about `value`, execution IDs, polling, real `429` bodies, or
  idempotency - unchanged from the previous section.

### Answering the "can KeeperHub call an arbitrary target" question

**Still: plausible, not yet confirmed - but the remaining blocker is now
precisely identified, not a vague "haven't tried it."**

KeeperHub's contract-call primitive is **not** a raw `to`/`data`
executor - confirmed twice over now. It takes `contractAddress` +
`functionName` + `functionArgs` (a JSON-stringified array), resolving
the ABI/fragment itself via what is now confirmed to be an ethers.js
`Interface` under the hood.

Calling the Zodiac Roles Modifier's `execTransactionWithRole(address to,
uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool
shouldRevert)` through this endpoint would mean: `contractAddress` = the
Roles Modifier's address, `functionName: "execTransactionWithRole"`,
`functionArgs: JSON.stringify([to, value, data, operation, roleKey,
shouldRevert])`. Two things stand between "plausible" and "confirmed":

1. **KeeperHub must be able to resolve the Roles Modifier's ABI/fragment
   for `execTransactionWithRole`.** Every function tested so far
   (`decimals`, `balanceOf`) is a universally-known ERC-20/standard
   signature - it's still unconfirmed whether KeeperHub's ethers
   `Interface` is built from a hardcoded set of common signatures, from
   on-chain source verification (plausible given the `explorerApiUrl`/
   `explorerApiType` fields on every `/chains` entry), or something
   else. A custom, less-common function like `execTransactionWithRole`
   is a materially different test than any of the well-known ERC-20
   getters tried so far.
2. **Whether a `bytes` argument (the nested call's calldata) serializes
   correctly inside the JSON-stringified `functionArgs` array.** Not
   tested. A hex string is the natural encoding and would likely work
   given ethers.js's own conventions, but "likely" is exactly the kind
   of assumption this project's rules forbid presenting as confirmed.

**The exact next verification step**, still entirely with harmless
read-only calls: call a function that takes a `bytes` argument on a
**publicly known, source-verified, non-trivial contract** (not a
universally-hardcoded ERC-20 getter) to test both open questions at
once - for example calling `isValidSignature(bytes32,bytes)` on a
deployed Safe (a `view` function, cannot mutate anything) with a
throwaway hash and empty/garbage signature bytes, which would fail
gracefully (a revert or a `false`-equivalent - Safe's own view function,
not a write) while proving whether (a) KeeperHub resolves a
less-common/custom function's ABI at all, and (b) how a `bytes` argument
serializes. This is still not `execTransactionWithRole` and still not
state-changing, so it stays within the constraints already given for
this round.

## Still not verified — do not build on these yet

1. `GET /api/keys` (or `/api/api-keys`) — not yet called live. Not
   required to confirm credential validity (the 200 on `/chains` already
   proves the key is valid), but its exact response shape (used for
   identifying the org/key) is unconfirmed.
2. `POST /api/execute/contract-call` — endpoint, base auth, minimal
   request shape, and single-`address`-argument passing (`functionArgs`
   as a JSON-stringified array) ARE now live-verified (see the two
   "Live-verified (2026-08-30)" sections above). Still unverified: a
   `bytes`-typed argument (the load-bearing unknown for the Zodiac
   question), whether KeeperHub resolves a custom/uncommon contract's
   ABI (vs. only well-known ERC-20-style signatures), the `value` field,
   whether/how `simulate: true` affects a **state-changing** call
   (observed to do nothing on either read-only call tested), the
   response shape for a state-changing call (execution ID? status
   field?), whether a separate status/polling endpoint exists at all,
   the real `429` shape, and idempotency-key behavior for a write. **Do
   not implement anything beyond the two verified read-only cases
   against assumed shapes.**
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

**Status: architecture proposed; `POST /execute/contract-call` is now
live-verified for read-only calls with zero or one `address` argument
(see above), and that verification narrowed the picture to two specific
remaining blockers.** The endpoint is ABI-aware/function-name-based, not
a raw `to`/`data` executor as originally assumed - see "Answering the
'can KeeperHub call an arbitrary target' question" above. Blocked on:
(1) whether KeeperHub can resolve the ABI of a less-common/custom
function like `execTransactionWithRole` (only universally-known ERC-20
signatures have been tested), and (2) whether a `bytes`-typed argument
(the nested calldata) serializes correctly inside `functionArgs`. Do not
treat this section as a green light to build the executor side yet.

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
- [x] Verify `POST /execute/contract-call` live for a zero-argument,
      read-only call (done 2026-08-30, see "Live-verified (2026-08-30)"
      above). Confirmed: endpoint, auth, minimal required fields
      (`contractAddress`, `chainId`, `functionName`), response shape for
      this case, and that `simulate: true` has no observable effect on a
      read-only call.
- [x] Verify how to pass **function arguments** using a harmless
      *parameterized* read-only call (done 2026-08-30, see "Live-verified
      (2026-08-30): passing function arguments" above). Confirmed:
      `functionArgs` as a JSON-*stringified* array; verified for a plain
      `address` argument only.
- [ ] Verify a `bytes`-typed argument and whether KeeperHub resolves a
      less-common/custom contract's ABI, using a harmless read-only call
      on a real, source-verified contract (e.g. a Safe's own
      `isValidSignature(bytes32,bytes)` view function with throwaway
      inputs - see "The exact next verification step" above). This is
      the last blocker for the Zodiac question.
- [ ] Verify the request/response shape for a genuinely state-changing
      call (execution ID? status/polling endpoint? does `simulate: true`
      actually gate broadcast?) - requires careful scoping to avoid any
      real fund movement even under `simulate: true`, given its
      no-observable-effect behavior on a read call.
- [ ] Verify the real `429` response shape and idempotency-key behavior.
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
