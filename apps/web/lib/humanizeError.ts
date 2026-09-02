/**
 * Execution/simulation failures can carry the exact underlying error - a
 * raw KeeperHub API response body, a decoded Solidity revert, a bare
 * custom-error name - which is exactly what someone verifying a claim
 * wants to see. It is not what a first-time visitor wants as the first
 * thing on screen. This turns that raw string into one short, human
 * sentence; the raw text is never hidden, just never the headline - every
 * caller is expected to still show it, collapsed, alongside the summary.
 *
 * Patterns are matched against real strings this app actually produces -
 * see apps/api/src/keeperhub/client.ts (KeeperHubApiError's message),
 * apps/api/src/execution/simulate.ts and statusOutcome.ts (errorMessage
 * sources) - not guessed shapes.
 */
export function humanizeError(raw: string): { summary: string; showRaw: boolean } {
  if (!raw) return { summary: "Failed.", showRaw: false };

  const patterns: Array<[RegExp, string]> = [
    [
      /ConditionViolation/i,
      "The Roles permission rejected one of this transaction's parameters (asset, amount, or recipient didn't match what's allowed).",
    ],
    [/ModuleTransactionFailed/i, "The Safe rejected this transaction when it was executed as a module call."],
    [/idempotency_conflict/i, "KeeperHub reported a conflicting request for this execution."],
    [/idempotency_in_progress/i, "KeeperHub is still processing this exact request."],
    [/insufficient funds|insufficient balance|ERC20InsufficientBalance/i, "The Safe doesn't hold enough funds for this transaction."],
    [/could not be confirmed/i, raw], // already an intentionally human, precise message
    [/timed out|check your connection/i, raw], // already human, from lib/api.ts's own request() helper
  ];
  for (const [pattern, summary] of patterns) {
    if (pattern.test(raw)) return { summary, showRaw: summary !== raw };
  }

  // A raw JSON/API-error blob or a bare Solidity revert - never show that
  // as the headline, but it's still worth surfacing on request.
  const looksRaw = raw.length > 140 || /^\s*\{/.test(raw) || /KeeperHub API error|execution reverted/i.test(raw);
  if (looksRaw) {
    return { summary: "This didn't go through. See the exact reason below.", showRaw: true };
  }

  return { summary: raw, showRaw: false };
}
