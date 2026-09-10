import { EXIT_KEEPA_LIVE_PROOF, type LiveProofStage } from "@exit-keepa/shared";
import type { AuditRow } from "../components/AuditTimeline";

/**
 * Turns Exit Keepa's own records into the five ordered audit rows the
 * timeline renders: condition snapshot → policy → simulate → execution id
 * → receipt.
 *
 * Kept out of the page component so the mapping is readable on its own,
 * and so the one rule that matters is easy to check: a row never claims
 * more than the record behind it. A sandbox execution's rows are marked
 * `sandbox` and carry no transaction hash, because there is no
 * transaction; a step the lifecycle never reached is `pending`, not
 * "failed".
 */

const COMPARATOR_WORDS: Record<string, string> = {
  lt: "below",
  lte: "at or below",
  gt: "above",
  gte: "at or above",
};

function percent(bps: number | null | undefined): string {
  return typeof bps === "number" ? `${(bps / 100).toFixed(2)}%` : "unknown";
}

/**
 * The live-proof timeline. `policy` is filled in from the API's freshly
 * recomputed verdict when it answered; without it the row still renders,
 * saying plainly that it could not be recomputed rather than asserting a
 * pass.
 */
export function liveProofRows(
  stages: readonly LiveProofStage[],
  recomputed: { policy?: Record<string, boolean>; policyPassed?: boolean; transaction?: any } | null,
): AuditRow[] {
  const proof = EXIT_KEEPA_LIVE_PROOF;

  return stages.map((stage): AuditRow => {
    switch (stage.id) {
      case "condition":
        return { id: stage.id, label: stage.label, evidence: stage.evidence, detail: stage.detail };

      case "policy": {
        if (!recomputed?.policy) {
          return {
            id: stage.id,
            label: stage.label,
            evidence: "pending",
            detail:
              "Could not reach the Exit Keepa API to recompute this check just now. It is a pure function over public values - nothing is being withheld, and no stored verdict is being substituted for it.",
          };
        }
        const failed = Object.entries(recomputed.policy).filter(([, passed]) => !passed);
        return {
          id: stage.id,
          label: `${stage.label}: ${failed.length === 0 ? "all checks pass" : `${failed.length} failed`}`,
          evidence: stage.evidence,
          detail: stage.detail,
          refused: failed.length > 0,
          facts: [
            {
              label: "Checks",
              value: Object.entries(recomputed.policy)
                .map(([name, passed]) => `${name}=${passed ? "pass" : "FAIL"}`)
                .join("  "),
              mono: true,
            },
            ...(recomputed.transaction
              ? [
                  { label: "Target", value: recomputed.transaction.to as string, mono: true },
                  { label: "Recipient", value: recomputed.transaction.decodedArgs.to as string, mono: true },
                  { label: "Calldata", value: recomputed.transaction.data as string, mono: true, copy: true },
                ]
              : []),
          ],
        };
      }

      case "simulate":
        return {
          id: stage.id,
          label: stage.label,
          evidence: stage.evidence,
          detail: stage.detail,
          facts: [
            { label: "Roles Modifier", value: proof.rolesModifierAddress, mono: true, copy: true },
            { label: "Function", value: proof.functionName, mono: true },
            { label: "Role key", value: proof.roleKey, mono: true },
          ],
        };

      case "execution":
        return {
          id: stage.id,
          label: stage.label,
          evidence: stage.evidence,
          detail: stage.detail,
          facts: [
            { label: "Execution id", value: proof.keeperhubExecutionId, mono: true, copy: true },
            { label: "Sponsored", value: String(proof.sponsored), mono: false },
          ],
        };

      case "receipt":
        return {
          id: stage.id,
          label: stage.label,
          evidence: stage.evidence,
          detail: stage.detail,
          txHash: proof.txHash,
          facts: [
            { label: "Receipt status", value: proof.receiptStatus },
            { label: "Block", value: String(proof.blockNumber) },
            { label: "Safe", value: proof.safeAddress, mono: true, copy: true },
          ],
        };
    }
  });
}

/**
 * The timeline for one demo-sandbox strategy, built from its newest agent
 * decision and the execution that decision opened (if any).
 *
 * A sandbox execution never produces a transaction hash, and this mapping
 * never invents one - the receipt row says there is nothing to look up and
 * why.
 */
export function sandboxRows(strategy: any, decision: any | null, execution: any | null): AuditRow[] {
  const condition = strategy?.condition ?? {};
  const observedBps: number | null = decision?.observation?.rateBps ?? null;
  const thresholdWords = `${COMPARATOR_WORDS[condition.comparator] ?? condition.comparator} ${percent(condition.thresholdBps)}`;

  const conditionRow: AuditRow = decision
    ? {
        id: "condition",
        label: decision.conditionMet ? "Condition met" : "Condition not met - nothing attempted",
        evidence: "recorded",
        detail: `Exit Keepa read the live Aave v3 Base ${condition.metric ?? "rate"} and compared it against the strategy's threshold. The rate itself is a real Base RPC read even in the sandbox - it is market data, not Safe state.`,
        facts: [
          { label: "Observed", value: percent(observedBps) },
          { label: "Threshold", value: `${thresholdWords}` },
          { label: "Checked at", value: new Date(decision.createdAt).toLocaleString() },
          { label: "Source", value: decision.source === "poller" ? "autonomous poller" : "on-demand check" },
        ],
      }
    : {
        id: "condition",
        label: "No check recorded yet",
        evidence: "pending",
        detail: `Nothing has been evaluated for this strategy. Activate it and press "Check now" on the strategy page, or wait for the poller's next tick.`,
      };

  const policyRow: AuditRow = decision?.policy
    ? {
        id: "policy",
        label: decision.policyPassed ? "Policy check: all checks pass" : "Policy check refused this exit",
        evidence: "recorded",
        refused: decision.policyPassed === false,
        detail: decision.policyPassed
          ? "Every deterministic check passed - right chain, right contract, right function, right asset, funds returning only to this Safe, permission configured. No model is involved in any of these."
          : "At least one deterministic check failed, so nothing was sent. A refusal is a completed decision, not an error.",
        facts: [
          {
            label: "Checks",
            value: Object.entries(decision.policy as Record<string, boolean>)
              .map(([name, passed]) => `${name}=${passed ? "pass" : "FAIL"}`)
              .join("  "),
            mono: true,
          },
          ...((decision.refusalReasons as string[] | undefined)?.length
            ? [{ label: "Refused because", value: (decision.refusalReasons as string[]).join("; ") }]
            : []),
        ],
      }
    : {
        id: "policy",
        label: "Policy check not reached",
        evidence: "pending",
        detail: "The condition did not fire, so there was nothing to check. Exit Keepa records the no-op ticks too.",
      };

  const status: string | undefined = execution?.status;
  const simulated = Boolean(execution) && !["pending", "simulating", "refused"].includes(status ?? "");
  const simulationFailed = status === "failed" && !execution?.keeperhubExecutionId && !execution?.txHash;

  const simulateRow: AuditRow = !execution
    ? {
        id: "simulate",
        label: "Nothing simulated",
        evidence: "pending",
        detail: "No execution was opened, so no dry run happened.",
      }
    : simulationFailed
      ? {
          id: "simulate",
          label: "Dry run said this would revert - stopped here",
          evidence: "sandbox",
          refused: true,
          detail: execution.errorMessage ?? "The simulation reported the transaction would fail. Nothing was broadcast.",
        }
      : {
          id: "simulate",
          label: simulated ? "Simulated" : "Simulation pending",
          evidence: simulated ? "sandbox" : "pending",
          detail:
            "In the sandbox this step is deliberately not a real KeeperHub call: a synthetic Safe exists on no chain, so simulating against it would test nothing. It is labelled sandbox in the stored payload rather than dressed up as a chain-verified result. On a real Safe this is execTransactionWithRole with simulate: true against the live Roles Modifier.",
          facts: [{ label: "Execution status", value: status ?? "unknown", mono: true }],
        };

  const executionRow: AuditRow = execution?.keeperhubExecutionId
    ? {
        id: "execution",
        label: "KeeperHub execution id",
        evidence: "keeperhub",
        detail: "KeeperHub accepted the write and returned its own execution id.",
        facts: [{ label: "Execution id", value: execution.keeperhubExecutionId, mono: true, copy: true }],
      }
    : {
        id: "execution",
        label: "No KeeperHub execution id - nothing was sent",
        evidence: execution ? "sandbox" : "pending",
        detail: execution
          ? "There is no id because there was no write. A sandbox lifecycle completes as demo_completed, which is its own status precisely so it can never be read as a real execution."
          : "The lifecycle never got this far.",
      };

  const receiptRow: AuditRow = execution?.txHash
    ? {
        id: "receipt",
        label: "Receipt confirmed",
        evidence: "onchain",
        detail: "A receipt was verified on-chain for this execution.",
        txHash: execution.txHash,
      }
    : {
        id: "receipt",
        label: "No transaction to verify",
        evidence: execution ? "sandbox" : "pending",
        detail: execution
          ? "There is no transaction hash because there is no transaction. Exit Keepa does not show a hash it cannot back - for a real one, see the live-proof trail above."
          : "The lifecycle never got this far.",
      };

  return [conditionRow, policyRow, simulateRow, executionRow, receiptRow];
}

/**
 * The refusal demo, as its own short trail. Deliberately stops at the
 * policy row: there is no simulate row because KeeperHub was never
 * contacted, and inventing greyed-out rows for steps that were never even
 * approached would overstate what happened.
 */
export function blockedCallRows(result: any): AuditRow[] {
  return [
    {
      id: "attempted",
      label: "A withdraw pointed away from the Safe was built",
      evidence: "recomputed",
      detail:
        "Same contract, same function, same asset as a real exit - only the recipient is wrong. This transaction had to be hand-built for the demo, because the production path has no input that names a recipient at all: it always uses the Safe's own address.",
      facts: [
        { label: "Recipient asked for", value: result.attempted.recipient, mono: true },
        { label: "Only valid recipient", value: result.permitted.recipient, mono: true },
        { label: "Calldata", value: result.attempted.data, mono: true, copy: true },
      ],
    },
    {
      id: "refused",
      label: `Refused - funds may only return to the Safe (failed: ${(result.failedChecks as string[]).join(", ")})`,
      evidence: "recomputed",
      refused: true,
      detail:
        "Exit Keepa's own policy check - the same function the autonomous agent runs before every real exit - turned it away before anything left the process. KeeperHub was never contacted, so nothing was simulated and nothing could be broadcast.",
      facts: [
        {
          label: "Checks",
          value: Object.entries(result.policy as Record<string, boolean>)
            .map(([name, passed]) => `${name}=${passed ? "pass" : "FAIL"}`)
            .join("  "),
          mono: true,
        },
        { label: "KeeperHub contacted", value: String(result.keeperhubContacted) },
        { label: "Broadcast", value: String(result.broadcast) },
      ],
    },
  ];
}
