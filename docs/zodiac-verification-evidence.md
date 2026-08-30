# Zodiac Roles / KeeperHub Verification — Final Evidence

Frozen record of the KeeperHub-Zodiac Roles verification phase for the
Ratehopper Auto-Exit investigation. This is the final evidence snapshot;
for the round-by-round research trail that produced it (including
earlier rejected hypotheses and dead ends), see
`docs/keeperhub-integration.md`.

All calls below were made from Railway's own network (this project's
`api` service, project `exit-keepa`, environment `production`), using
the service's existing `KEEPERHUB_API_KEY`. That key was never printed,
logged, or committed at any point. All calls were read-only or
simulate-only; no Safe transaction was ever broadcast, no role was
assigned, no role membership was changed, and no funds were moved or
added.

## Identifiers

| Item | Value |
|---|---|
| Chain | Base mainnet, chain ID `8453` |
| Zodiac Roles Modifier v2 mastercopy tested | `0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5` |
| Real deployed Roles instance | `0x856dD89c7925977119b5C7330186B5238aD355a0` |
| Instance's actual implementation (EIP-1167 delegate) | `0x9646fdad06d3e24444381f44362a3b0eb343d337` |
| Safe / avatar | `0x0274a328e584cb43bf40b9a34fdc03b84dd9d02d` |

The Roles instance address and the Safe/avatar address were supplied
externally (not discovered by this investigation) and were
independently verified before any KeeperHub call was trusted — see
"What this proves" below.

## 1. Mastercopy ABI resolution

`GET /chains/8453/abi?address=0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5`

- **Result: HTTP 200, `success: true`.**
- KeeperHub returned the complete real Roles Modifier v2 ABI, sourced
  from Basescan's verified code (per the response's `explorerUrl`
  field), including `owner()`, `avatar()`, `target()`, and
  `execTransactionWithRole(address,uint256,bytes,uint8,bytes32,bool)`.

## 2. Instance verification (independent, not taken on claim)

Before any KeeperHub call against the instance was trusted, it was
independently verified from Railway:

- `eth_getCode` via the configured Base RPC returned 45 bytes of real
  bytecode at `0x856dD89c7925977119b5C7330186B5238aD355a0` — a
  **deployed contract**, and an address distinct from the mastercopy
  address above.
- That bytecode is a standard EIP-1167 minimal proxy. Parsing it
  (generically, without assuming which implementation it points at)
  extracts the real delegate address: `0x9646fdad06d3e24444381f44362a3b0eb343d337`.
- Fetching *that* implementation's ABI via the same live-verified
  `/chains/8453/abi` endpoint returned the full canonical Roles v2
  function set (`allowFunction`, `assignRoles`, `scopeFunction`,
  `execTransactionWithRole`, `execTransactionWithRoleReturnData`,
  etc.) — confirming this is a genuine, complete Roles v2
  implementation, not merely a contract that happens to share the
  `avatar()`/`owner()`/`target()` getters common to all Zodiac
  modules.

## 3. Read-only getters on the instance

All three calls: `POST /execute/contract-call`,
`{"contractAddress":"0x856dD89c7925977119b5C7330186B5238aD355a0","chainId":8453,"functionName":"<name>","simulate":true}`.

| Call | HTTP status | Decoded result |
|---|---|---|
| `avatar()` | 200 | `0x0274a328e584cb43bf40b9a34fdc03b84dd9d02d` |
| `owner()` | 200 | `0x0274a328e584cb43bf40b9a34fdc03b84dd9d02d` |
| `target()` | 200 | `0x0274a328e584cb43bf40b9a34fdc03b84dd9d02d` |

All three decoded values match the expected Safe/avatar exactly.

## 4. `execTransactionWithRole` simulation

**Exact request:**

```json
POST /execute/contract-call
{
  "contractAddress": "0x856dD89c7925977119b5C7330186B5238aD355a0",
  "chainId": 8453,
  "functionName": "execTransactionWithRole",
  "functionArgs": "[\"0x0000000000000000000000000000000000000001\",\"0\",\"0x\",\"0\",\"0x0000000000000000000000000000000000000000000000000000000000000000\",true]",
  "simulate": true
}
```

**Exact result:**

- HTTP status: `400`
- `status`: `"simulated"`
- `wouldRevert`: `true`
- `revertReason`: `"NotAuthorized(0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac)"`
- `failureKind`: `"revert"`
- No `transactionHash` was present anywhere in the response.
- Full raw response body:

```json
{
  "success": false,
  "status": "simulated",
  "from": "0xc68f0e22dc6ed7e883873b36f23ddbbc1b3968ac",
  "to": "0x856dD89c7925977119b5C7330186B5238aD355a0",
  "value": "0",
  "failureKind": "revert",
  "wouldRevert": true,
  "revertReason": "NotAuthorized(0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac)",
  "error": "NotAuthorized(0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac)",
  "originalError": "execution reverted (unknown custom error) (action=\"estimateGas\", data=\"0x4a0bfec1000000000000000000000000c68f0e22dc6ed7e883873b36f23ddbbc1b3968ac\", reason=null, transaction={ \"data\": \"0xc6fe87470000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000\", \"from\": \"0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac\", \"to\": \"0x856dD89c7925977119b5C7330186B5238aD355a0\" }, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.16.0)"
}
```

**Why HTTP 400 here does not mean "function rejected."** In every
earlier round of this investigation, a KeeperHub-side rejection of an
unrecognized function name produced a distinct, previously-documented
error shape: `{"error":"Function '<name>' not found in
ABI","field":"functionName"}` (see `docs/keeperhub-integration.md`,
the Safe `isValidSignature` round). This response is a completely
different shape: it carries `status: "simulated"`, `wouldRevert: true`,
a `revertReason` naming a real, decoded Zodiac Roles custom error
(`NotAuthorized`), and the full `originalError` shows KeeperHub built
real calldata (`0xc6fe8747...`, the correct 4-byte selector for
`execTransactionWithRole`) and sent it to `estimateGas` against the
real instance address. KeeperHub resolved the function name, correctly
ABI-encoded all six arguments (including the `bytes` and `bytes32`
arguments that were previously unverified), and reached the real
contract on Base — the call simply reverted on-chain because the
`from` address KeeperHub simulated as (`0xc68f0E22...`) is not an
authorized Roles member. HTTP 400 here is KeeperHub's status code for
"the simulated call would revert," not a request-validation failure.

## What this proves

- KeeperHub can resolve the real ABI of the Zodiac Roles Modifier v2
  contract type on Base, for both the mastercopy and a live instance.
- KeeperHub's `POST /execute/contract-call` path correctly recognizes
  `execTransactionWithRole` by name and correctly ABI-encodes its full
  argument list — an `address`, two `uint256`/`uint8`-ish values, a
  `bytes` calldata argument, a `bytes32` role key, and a `bool` — none
  of which had been verified together before this test.
- The simulated call reached the real, independently-verified Roles
  instance on Base and was evaluated against its real on-chain
  authorization logic (the revert reason is a genuine Zodiac Roles
  `NotAuthorized` custom error, not a generic/malformed-call error).
- No write, broadcast, role assignment, role-membership change, Safe
  modification, or funding occurred anywhere in this investigation.

## What this does NOT prove

- That any specific account is (or can be made) an authorized member
  of a role on this Roles instance that would permit a real protective
  action to succeed. This test used an arbitrary placeholder `from`
  address (`0x...0001`) with no role membership, by design — it was
  never expected to pass authorization.
- That `simulate: true` actually prevents broadcast for a call that
  *would* succeed (i.e., one made by an authorized role member). Every
  test in this investigation that used `simulate: true` has, so far,
  either been a pure read or a call that reverted before execution;
  none has tested KeeperHub's behavior on a simulated call that the
  chain would accept.
- That KeeperHub can correctly encode a real, non-placeholder
  Ratehopper Auto-Exit action's specific calldata (the `bytes data`
  argument here was empty, `0x`) — only that the outer
  `execTransactionWithRole` argument shape encodes correctly.
- That any account controlled by this project (KeeperHub's own
  executor key, Turnkey, or otherwise) has been granted a role on this
  or any Roles instance. No role membership was requested, granted, or
  tested.
- Anything about the Roles instance's relationship to Ratehopper
  specifically. The Safe/avatar and Roles instance addresses used here
  were supplied externally for the purpose of testing KeeperHub's
  contract-call path against a real Zodiac Roles Modifier — this test
  does not establish that this Safe, or any Safe, is connected to a
  Ratehopper position.
