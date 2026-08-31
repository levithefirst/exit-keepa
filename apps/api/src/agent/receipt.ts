import type { agentDecisions, keeperhubExecutions } from "../db/schema";

type DecisionRow = typeof agentDecisions.$inferSelect;
type ExecutionRow = typeof keeperhubExecutions.$inferSelect;

/**
 * The one structured object a judge can open to verify every claim the demo
 * makes: what was intended, what was observed, what the policy check found,
 * what simulation said, what KeeperHub returned, and what actually landed
 * onchain - each independently checkable (the tx hash against BaseScan, the
 * policy fields against the strategy/Safe, the receipt hash against its own
 * inputs). Built fresh from the current execution row (not a frozen
 * snapshot), so a receipt fetched after a later broadcast reflects the real
 * final state, not what was true the instant the decision was made.
 */
export interface AgentReceipt {
  decisionId: string;
  strategyId: string;
  executionId: string | null;
  source: string;
  createdAt: string;
  agentStateBefore: string;
  agentStateAfter: string;
  decision: string;
  intent: {
    target: string | null;
    calldata: string | null;
  };
  observation: unknown;
  conditionMet: boolean;
  policyCheck: {
    policy: unknown;
    policyPassed: boolean | null;
    refusalReasons: string[];
  };
  simulationResult: {
    status: string;
    wouldSucceed: boolean | null;
    errorMessage: string | null;
  } | null;
  keeperhubExecutionResult: {
    keeperhubExecutionId: string | null;
    keeperhubWorkflowId: string | null;
    responsePayload: unknown;
  } | null;
  finalOnchainResult: {
    status: string;
    txHash: string | null;
    broadcastAt: string | null;
    confirmedAt: string | null;
  } | null;
  intentHash: string;
  receiptHash: string;
}

export function buildReceipt(decision: DecisionRow, execution: ExecutionRow | null): AgentReceipt {
  const requestPayload = (execution?.requestPayload ?? null) as { tx?: { to?: string; data?: string } } | null;

  return {
    decisionId: decision.id,
    strategyId: decision.strategyId,
    executionId: decision.executionId,
    source: decision.source,
    createdAt: decision.createdAt.toISOString(),
    agentStateBefore: decision.agentStateBefore,
    agentStateAfter: decision.agentStateAfter,
    decision: decision.decision,
    intent: {
      target: requestPayload?.tx?.to ?? null,
      calldata: requestPayload?.tx?.data ?? null,
    },
    observation: decision.observation,
    conditionMet: decision.conditionMet,
    policyCheck: {
      policy: decision.policy,
      policyPassed: decision.policyPassed,
      refusalReasons: (decision.refusalReasons as string[] | null) ?? [],
    },
    simulationResult: execution
      ? {
          status: execution.status,
          wouldSucceed: execution.status === "simulated" ? true : execution.status === "failed" ? false : null,
          errorMessage: execution.errorMessage,
        }
      : null,
    keeperhubExecutionResult: execution
      ? {
          keeperhubExecutionId: execution.keeperhubExecutionId,
          keeperhubWorkflowId: execution.keeperhubWorkflowId,
          responsePayload: execution.responsePayload,
        }
      : null,
    finalOnchainResult: execution
      ? {
          status: execution.status,
          txHash: execution.txHash,
          broadcastAt: execution.broadcastAt ? execution.broadcastAt.toISOString() : null,
          confirmedAt: execution.confirmedAt ? execution.confirmedAt.toISOString() : null,
        }
      : null,
    intentHash: decision.intentHash,
    receiptHash: decision.receiptHash,
  };
}
