const KEY_PREFIX = "exit-keepa:safe-id:";

export function getStoredSafeId(walletAddress: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + walletAddress.toLowerCase());
  } catch {
    return null;
  }
}

export function setStoredSafeId(walletAddress: string, safeId: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + walletAddress.toLowerCase(), safeId);
  } catch {
    // Storage unavailable (private mode, etc.) - non-fatal, the user just
    // has to re-enter their Safe on next visit.
  }
}

/**
 * Defense-in-depth for the one label demo mode itself never keys the cache
 * under ("demo-mode" - see resolveSafeId.ts, which already skips this cache
 * entirely for a demo session). Called on every demo entry so that even if
 * something - a hostile actor's planted localStorage, or a future bug that
 * reintroduces a demo-mode cache read - ever wrote under this exact key,
 * that value is gone before a fresh demo session can pick it up.
 */
export function clearStoredSafeId(walletAddress: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + walletAddress.toLowerCase());
  } catch {
    // Storage unavailable - nothing to clear.
  }
}
