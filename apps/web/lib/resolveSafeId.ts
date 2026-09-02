import { api } from "./api";
import { getStoredSafeId, setStoredSafeId } from "./storage";

/**
 * Finds which Safe (if any) the current session should show, the same way
 * for every page that needs it (Dashboard, Create Strategy).
 *
 * Demo mode never uses the localStorage cache: every "Try demo" click logs
 * in as a brand-new, isolated identity with its own auto-provisioned
 * sandbox Safe (see apps/api/src/routes/auth.ts's POST
 * /api/auth/demo-session), but the client always displays that identity as
 * the same fixed string ("demo-mode" - see lib/wallet.tsx's DEMO_IDENTITY).
 * Caching under that shared key would hand a later demo session the
 * previous session's now-inaccessible safeId. A real wallet's address is
 * genuinely stable across visits, so it keeps the cache for a fast return
 * visit.
 */
export async function resolveSafeId(address: string, isDemo: boolean): Promise<string | null> {
  if (!isDemo) {
    const cached = getStoredSafeId(address);
    if (cached) return cached;
  }
  try {
    const mine = await api.listMySafeAccounts();
    if (mine.length === 0) return null;
    if (!isDemo) setStoredSafeId(address, mine[0].id);
    return mine[0].id;
  } catch {
    return null;
  }
}
