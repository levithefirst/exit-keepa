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
