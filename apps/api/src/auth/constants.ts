/**
 * The fixed demo identity. Has no known private key (the zero address),
 * so it can only ever be reached through the explicit /api/auth/demo-session
 * path, never through a real signature via /api/auth/verify. Migration
 * 0002_foamy_argent.sql backfills every pre-existing safe_accounts row
 * (in practice, just the live demo Safe) to this exact literal - keep them
 * in sync if this ever changes.
 */
export const DEMO_OWNER_ADDRESS = "0x0000000000000000000000000000000000000000";
