/**
 * The exact human-readable text a wallet signs to prove key possession.
 * Pure and deterministic so both the server (verifying) and a test (or a
 * future frontend) can reconstruct the identical string from the same
 * address+nonce - any mismatch, even whitespace, produces a different
 * EIP-191 hash and the signature won't recover to the claimed address.
 */
export function buildSignInMessage(address: string, nonce: string): string {
  return [
    "Sign in to Exit Keepa.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    "",
    "This request will not trigger a blockchain transaction or cost any gas fees.",
  ].join("\n");
}
