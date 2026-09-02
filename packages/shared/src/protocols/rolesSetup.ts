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
  const chainShortName = chainId === 8453 ? "base" : String(chainId);
  const rolesAppUrl = "https://roles.gnosisguild.org";
  return `https://app.safe.global/apps/open?safe=${chainShortName}:${safeAddress}&appUrl=${encodeURIComponent(rolesAppUrl)}`;
}
