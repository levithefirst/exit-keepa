# Tightening the exit_keepa Roles grant: withdraw-only -> withdraw with asset/recipient locked

**Status: step 1 (function scoping) is now live onchain; step 2
(parameter conditions) is prepared, not submitted.** This document and
the accompanying `roles-tightening/computeCalldata.js` originally
targeted moving the role from whole-target `allowTarget` clearance
straight to a fully-scoped `withdraw` grant in two calls. Since this
document was first written, **`scopeTarget` plus a function-level allow
for `withdraw` have been submitted and confirmed** — the role's
clearance on the Aave Pool is `Function`, not whole-target, and only the
`withdraw` selector (`0x69328dec`) is callable. **What remains is the
parameter-condition step below** (locking `asset == USDC` and
`to == this Safe`), which has not been submitted. Nobody but the Safe's
own signers can execute it — Exit Keepa's backend has no code path that
submits a Roles configuration change, by design (see README "How
execution is authorized"). Review this, re-run the script yourself if
you want to reproduce the numbers independently, and submit through the
Safe's normal signing flow if it matches what you expect.

## What's true right now

The live demo Safe's `exit_keepa` role currently has:

- Aave v3 Pool clearance: `Function` (not whole-target — `scopeTarget`
  has already been applied)
- `withdraw(address,uint256,address)` (selector `0x69328dec`): allowed,
  with **no parameter conditions** — the Roles Modifier will pass any
  `asset`/`amount`/`to` combination for a `withdraw` call. Every other
  function on the Pool is rejected by the Roles Modifier itself.

This is a real middle state, not the "still `allowTarget`" gap an
earlier version of this document (and of the README) described, and not
yet the fully-scoped end state either. Locking `asset == USDC` and
`to == this Safe` at the Roles layer — so misuse is rejected onchain, not
just by Exit Keepa's own `agent/policy.ts` check — is what the
transaction below still does.

## What the remaining step changes

**Only the `scopeFunction` call below is still needed** — `scopeTarget`
has already been applied onchain, so re-submitting it is redundant
(idempotent, but unnecessary) rather than required. It's kept here as
transaction 1 for anyone reproducing this from a genuinely fresh
`allowTarget` starting point (e.g. a different Safe); for *this* Safe,
only transaction 2 is outstanding.

Both calls are `onlyOwner` (the Safe itself) on the Roles Modifier:

1. **`scopeTarget(roleKey, aavePool)`** - moves the target from whole
   clearance to function-level clearance. After this call alone, *no*
   function on the Aave Pool is callable through this role - clearance
   and per-function conditions are separate storage, so scopeTarget by
   itself is strictly more restrictive than today, never less. Confirmed
   from `PermissionBuilder.sol`'s actual source: `scopeTarget` writes
   `clearance: Clearance.Function` and does not touch any previously
   scoped function. **Already applied on the live demo Safe.**
2. **`scopeFunction(roleKey, aavePool, withdrawSelector, conditions, ExecutionOptions.None)`**
   - grants exactly one function back, with per-parameter conditions:
   - `asset` (position 0): must equal USDC (`0x833589fC...02913`)
   - `amount` (position 1): unrestricted (this is intentional - it's what
     lets "withdraw my entire position" and "withdraw an exact amount"
     both keep working; the recipient and asset locks are what actually
     prevent misuse, not the amount)
   - `to` (position 2): must equal the Safe itself
     (`0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9`)
   - **This is the one call still outstanding.** The live Safe already
     has `withdraw` allowed with no conditions (an earlier, unconditioned
     function-level allow); submitting this `scopeFunction` call replaces
     that unconditioned allowance with the conditioned one shown here —
     confirm in the Zodiac Roles app that it's presented as an update to
     the existing `withdraw` permission, not a duplicate, before signing.

After this call lands: the role can call `withdraw(asset, amount, to)` on
the Aave Pool if and only if `asset` is USDC and `to` is this exact Safe.
Every other function on the Pool, and every other recipient for a USDC
withdrawal, is rejected by the Roles Modifier itself - before Exit
Keepa's own application-level checks even come into it.

**Note on the calldata below:** it was computed assuming a fresh
`allowTarget` starting point (transaction 1 + transaction 2 together).
Since transaction 1 is already live, only transaction 2's calldata is
still relevant for this Safe — re-verify it against the Zodiac Roles app
before submitting, since the app will show the diff against the Safe's
*actual* current permission (withdraw, unconditioned) rather than the
`allowTarget` baseline this document originally assumed.

## The exact calldata

Produced by `docs/roles-tightening/computeCalldata.js` using `viem`'s
real ABI encoder (`encodeFunctionData`) against the actual
`scopeTarget`/`scopeFunction` signatures from
`gnosisguild/zodiac-modifier-roles`'s `PermissionBuilder.sol` - not
hand-encoded, and not the kind of guess this project has avoided
everywhere else a value gates fund movement. The script also decodes its
own output back (`decodeFunctionData`) and confirms every field matches
what was intended, byte for byte - see the "Self-check" section of its
output.

**Transaction 1 - scopeTarget:**

| Field | Value |
|---|---|
| `to` | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` (the Roles Modifier) |
| `value` | `0` |
| `operation` | `0` (Call) |
| `data` | `0x0c6c76b8657869745f6b6565706100000000000000000000000000000000000000000000000000000000000000000000a238dd80c259a72e81d7e4664a9801593f98d1c5` |

**Transaction 2 - scopeFunction:**

| Field | Value |
|---|---|
| `to` | `0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE` (the Roles Modifier) |
| `value` | `0` |
| `operation` | `0` (Call) |
| `data` | `0x7508dd98657869745f6b6565706100000000000000000000000000000000000000000000000000000000000000000000a238dd80c259a72e81d7e4664a9801593f98d1c569328dec0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000002800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000020000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000020000000000000000000000000ffd5c5e17e09e012c99550bfb2ef88d370cd66a9` |

## How to submit it

**Recommended: the Zodiac Roles app.** README already documents a
deep link into it for this exact Safe (`preview.rolesPermission.safeAppUrl`
from the strategy preview screen, or directly:
`https://app.safe.global/apps/open?safe=base:0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9&appUrl=https%3A%2F%2Froles.gnosisguild.org`).
Configure the same permission there (target: the Aave Pool, function:
`withdraw(address,uint256,address)`, `asset == USDC`, `to == this Safe`,
`amount` unrestricted) and let the app generate and submit the
transaction through your Safe's normal signing flow. **Compare what it
produces against the calldata above** - if they match, that's strong
independent confirmation both this document and the app agree on what
the permission actually says.

**Alternative: submit the raw calldata directly**, e.g. via Safe's
Transaction Builder app, pasting in the `to`/`value`/`data` triples above
exactly as shown. Only do this if you're comfortable reading the decoded
Solidity output before signing - Safe's own UI will decode and display
the function/args from an ABI it recognizes, or you can paste the
`data` into a scratch call to `decodeFunctionData` yourself (the script
in this folder already shows exactly how).

## Re-deriving this yourself

```bash
cd docs/roles-tightening
npm install viem@2.56.1   # or use the copy already in apps/api's node_modules
node computeCalldata.js
```

The script prints both transactions' calldata and a self-check section
confirming the decoded values match every intended field. Nothing in it
makes a network call or touches a private key - it's pure ABI encoding.
