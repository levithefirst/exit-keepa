/** Base's short name in Safe{Wallet}'s own URL scheme (`chain:address` / `?chain=`).
 * Falls back to the raw numeric chain id for any chain this project doesn't otherwise
 * name explicitly - Exit Keepa only ever targets Base today, but a literal id still
 * produces a URL Safe's app can resolve rather than silently breaking. */
function safeChainShortName(chainId: number): string {
  return chainId === 8453 ? "base" : String(chainId);
}

/**
 * Deep link into the Safe's own Zodiac Roles app, opened as a Safe App so
 * the Safe's real owners sign through the Safe's real flow. This is a pure
 * URL formula (chain short name + Safe address + the Roles app's own URL,
 * all public), not anything that gates fund movement — safe to compute on
 * either side of the API boundary. Single source of truth so the backend
 * (apps/api/src/execution/rolesPermission.ts) and the frontend (surfacing
 * setup status before a strategy even exists) never drift apart.
 */
export function buildRolesSafeAppUrl(chainId: number, safeAddress: string): string {
  const rolesAppUrl = "https://roles.gnosisguild.org";
  return `https://app.safe.global/apps/open?safe=${safeChainShortName(chainId)}:${safeAddress}&appUrl=${encodeURIComponent(rolesAppUrl)}`;
}

/**
 * Deep link into Safe{Wallet}'s own "create a new Safe" flow, pre-selected
 * to this chain - for someone on the "Connect your Safe" screen who
 * doesn't have one yet. Exit Keepa never creates a Safe on anyone's
 * behalf (same reasoning as buildRolesSafeAppUrl: that's the Safe's own
 * owners' decision, made in Safe's own signing flow), this just points at
 * the right place to start.
 */
export function buildCreateSafeUrl(chainId: number): string {
  return `https://app.safe.global/new-safe/create?chain=${safeChainShortName(chainId)}`;
}
