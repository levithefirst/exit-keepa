// Must come first - see apiEnv.ts. Every apps/api import below depends on
// it having already run.
import { hasKeeperHubCredentials, MissingKeeperHubCredentialsError } from "./apiEnv";

import { z } from "zod";
import {
  AAVE_V3_BASE,
  canonicalRoleKey,
  EXIT_KEEPA_LIVE_PROOF,
  EXIT_KEEPA_LIVE_PROOF_STAGES,
  exitActionSchema,
  rateConditionSchema,
  type ExitAction,
  type RateCondition,
} from "@exit-keepa/shared";

import { buildExitTransaction, type SafeForExecution } from "../../../apps/api/src/execution/buildTransaction";
import { checkPolicy } from "../../../apps/api/src/agent/policy";
import { evaluateRateCondition } from "../../../apps/api/src/execution/evaluateCondition";
import { simulateExitTransaction } from "../../../apps/api/src/execution/executor";
import { deriveExecutionOutcomeFromStatus } from "../../../apps/api/src/execution/statusOutcome";
import { keeperHubClient } from "../../../apps/api/src/keeperhub/client";
import { readAaveUsdcRate } from "../../../apps/api/src/agent/aaveRateOracle";
import { refuseBroadcast } from "./broadcast";

/**
 * The five Exit Keepa MCP tools, as plain async functions.
 *
 * Every one of them is a thin adapter over code the API already runs -
 * buildExitTransaction, checkPolicy, evaluateRateCondition,
 * simulateExitTransaction, the KeeperHub client. Nothing here re-encodes
 * calldata, re-implements a policy rule, or opens its own path to the
 * chain. That is the point: an agent driving Exit Keepa through MCP gets
 * the identical decisions the product itself makes, not a parallel
 * approximation of them.
 *
 * None of them can broadcast. `simulate_exit` only ever sends
 * `simulate: true`, and asking it to broadcast throws
 * BroadcastNotPermittedError (see broadcast.ts).
 *
 * server.ts wraps these for the MCP protocol; they are exported plainly so
 * they can be tested without standing up a transport.
 */

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte hex address");

/** Base is the only chain Exit Keepa v1 executes on; the input says so out loud. */
const chainIdSchema = z
  .literal(AAVE_V3_BASE.chainId)
  .default(AAVE_V3_BASE.chainId)
  .describe(`Base mainnet (${AAVE_V3_BASE.chainId}). Exit Keepa v1 supports no other chain.`);

// ---------------------------------------------------------------------------
// evaluate_exit_condition
// ---------------------------------------------------------------------------

export const evaluateExitConditionInputShape = {
  condition: rateConditionSchema.describe(
    "The rate condition to evaluate, in the same shape a stored Exit Keepa strategy uses.",
  ),
  currentRateBps: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Rate to compare against, in basis points. Omit to read the live Aave v3 Base rate from a Base RPC node instead.",
    ),
};

const evaluateExitConditionInput = z.object(evaluateExitConditionInputShape);
export type EvaluateExitConditionInput = z.input<typeof evaluateExitConditionInput>;

export interface EvaluateExitConditionResult {
  conditionMet: boolean;
  condition: RateCondition;
  observedRateBps: number;
  observedRatePercent: string;
  thresholdPercent: string;
  /** Where the compared number came from - never left ambiguous. */
  rateSource: "caller-supplied" | "base-rpc";
  observation: unknown;
  note: string;
}

/**
 * Answers "would this condition fire right now?" using the exact
 * comparator the running agent uses (execution/evaluateCondition.ts).
 *
 * With `currentRateBps` this is pure arithmetic and needs no network. With
 * it omitted, the rate is read live from Base via the same oracle the
 * autonomous poller reads (agent/aaveRateOracle.ts) - a real
 * `getReserveData` call, not a cached or canned number.
 */
export async function evaluateExitCondition(rawInput: unknown): Promise<EvaluateExitConditionResult> {
  const input = evaluateExitConditionInput.parse(rawInput);
  const condition = input.condition as RateCondition;

  let observedRateBps: number;
  let observation: unknown;
  let rateSource: EvaluateExitConditionResult["rateSource"];

  if (input.currentRateBps !== undefined) {
    observedRateBps = input.currentRateBps;
    rateSource = "caller-supplied";
    observation = { rateBps: input.currentRateBps, source: "caller-supplied" };
  } else {
    if (condition.metric !== "supply_apr" && condition.metric !== "borrow_apr") {
      throw new Error(
        `Live rate reads cover Aave v3 Base supply_apr and borrow_apr only - pass currentRateBps explicitly to evaluate a ${condition.metric} condition.`,
      );
    }
    const snapshot = await readAaveUsdcRate(condition.metric);
    observedRateBps = snapshot.rateBps;
    rateSource = "base-rpc";
    observation = snapshot;
  }

  return {
    conditionMet: evaluateRateCondition(condition, observedRateBps),
    condition,
    observedRateBps,
    observedRatePercent: `${(observedRateBps / 100).toFixed(2)}%`,
    thresholdPercent: `${(condition.thresholdBps / 100).toFixed(2)}%`,
    rateSource,
    observation,
    note: "Evaluating a condition never creates an execution and never contacts KeeperHub. A true result means the condition holds, not that anything was done about it.",
  };
}

// ---------------------------------------------------------------------------
// build_exit_calldata
// ---------------------------------------------------------------------------

export const buildExitCalldataInputShape = {
  safeAddress: addressSchema.describe("The Safe that holds the Aave position. Funds can only ever return here."),
  rolesModifierAddress: addressSchema.describe("The Zodiac Roles Modifier enabled on that Safe."),
  chainId: chainIdSchema,
  amount: z
    .union([z.literal("max"), z.string().regex(/^[1-9][0-9]*$/)])
    .default("max")
    .describe('"max" withdraws the whole position; otherwise a positive smallest-unit amount as a string.'),
};

const buildExitCalldataInput = z.object(buildExitCalldataInputShape);
export type BuildExitCalldataInput = z.input<typeof buildExitCalldataInput>;

export interface BuildExitCalldataResult {
  transaction: ReturnType<typeof buildExitTransaction>;
  policy: Record<string, boolean>;
  policyPassed: boolean;
  refusalReasons: string[];
  note: string;
}

/** Turns MCP input into the SafeForExecution shape the API's own helpers take. */
function toSafeForExecution(input: { safeAddress: string; chainId: number; rolesModifierAddress: string }): SafeForExecution {
  return {
    safeAddress: input.safeAddress,
    chainId: input.chainId,
    rolesModifierAddress: input.rolesModifierAddress,
    // The role key is canonical and never caller-supplied - same rule the
    // API enforces (packages/shared/src/protocols/exitKeepaRole.ts).
    rolesKey: canonicalRoleKey(),
  };
}

function buildAction(amount: "max" | string): ExitAction {
  return exitActionSchema.parse({
    protocol: "aave-v3-base",
    action: "withdraw",
    asset: AAVE_V3_BASE.usdc,
    amount,
  }) as ExitAction;
}

/**
 * Builds the exact transaction Exit Keepa would ask KeeperHub to execute,
 * and runs the deterministic policy check over it.
 *
 * The caller supplies a Safe and an amount - never a target, a selector, or
 * calldata. Those come from buildExitTransaction, the single place in this
 * codebase that turns a strategy into a transaction, so an MCP client
 * cannot point Exit Keepa at a different contract or a different recipient
 * any more than the web UI can.
 */
export async function buildExitCalldata(rawInput: unknown): Promise<BuildExitCalldataResult> {
  const input = buildExitCalldataInput.parse(rawInput);
  const safe = toSafeForExecution(input);
  const transaction = buildExitTransaction(buildAction(input.amount), safe);
  const { policy, policyPassed, refusalReasons } = checkPolicy(transaction, safe, null);

  return {
    transaction,
    policy,
    policyPassed,
    refusalReasons,
    note: "Built locally. Nothing was sent anywhere - not to KeeperHub, not to a chain.",
  };
}

// ---------------------------------------------------------------------------
// simulate_exit
// ---------------------------------------------------------------------------

export const simulateExitInputShape = {
  ...buildExitCalldataInputShape,
  broadcast: z
    .boolean()
    .optional()
    .describe(
      "Rejected. Present only so an agent that asks to broadcast gets a specific, typed refusal naming EXIT_KEEPA_ALLOW_BROADCAST rather than a silent simulation it might mistake for a send.",
    ),
};

const simulateExitInput = z.object(simulateExitInputShape);
export type SimulateExitInput = z.input<typeof simulateExitInput>;

export interface SimulateExitResult {
  simulated: true;
  broadcast: false;
  policyPassed: boolean;
  policy: Record<string, boolean>;
  refusalReasons: string[];
  transaction: ReturnType<typeof buildExitTransaction>;
  /** Null when the policy check refused - KeeperHub is never contacted in that case. */
  keeperhubRequest: Record<string, unknown> | null;
  keeperhubResponse: unknown;
  wouldRevert: boolean | null;
  revertReason: string | null;
  note: string;
}

/**
 * Simulates the exit through KeeperHub - `execTransactionWithRole` with
 * `simulate: true`, against the real Roles Modifier and the real Aave Pool.
 *
 * Two things this can never do:
 *
 * 1. Broadcast. It calls simulateExitTransaction, the API helper whose only
 *    job is the dry run, and asserts the outgoing request carries
 *    `simulate: true` before returning. Asking for a broadcast throws
 *    (see refuseBroadcast).
 * 2. Contact KeeperHub for a transaction the policy check refuses. A
 *    refusal short-circuits here exactly as it does in the running agent -
 *    a call that Exit Keepa wouldn't make is not made.
 */
export async function simulateExit(rawInput: unknown): Promise<SimulateExitResult> {
  const input = simulateExitInput.parse(rawInput);
  if (input.broadcast) {
    refuseBroadcast("simulate_exit");
  }

  const safe = toSafeForExecution(input);
  const transaction = buildExitTransaction(buildAction(input.amount), safe);
  const { policy, policyPassed, refusalReasons } = checkPolicy(transaction, safe, null);

  if (!policyPassed) {
    return {
      simulated: true,
      broadcast: false,
      policyPassed,
      policy,
      refusalReasons,
      transaction,
      keeperhubRequest: null,
      keeperhubResponse: null,
      wouldRevert: null,
      revertReason: null,
      note: "Refused by Exit Keepa's own policy check before KeeperHub was contacted at all. Nothing was simulated and nothing was sent.",
    };
  }

  if (!hasKeeperHubCredentials()) throw new MissingKeeperHubCredentialsError("simulate_exit");

  const result = await simulateExitTransaction(transaction, input.chainId);

  // Belt and braces. simulateExitTransaction hard-codes simulate: true, but
  // this is the one tool that talks to the write endpoint at all, so the
  // outgoing request is checked rather than assumed. If this ever fires,
  // something upstream changed and the right answer is to fail loudly.
  if (result.request.simulate !== true) {
    throw new Error(
      "simulate_exit refused to return: the outgoing KeeperHub request did not carry simulate: true. This is a bug, not a condition to retry.",
    );
  }

  const parsed = result.parsed;
  return {
    simulated: true,
    broadcast: false,
    policyPassed,
    policy,
    refusalReasons,
    transaction,
    keeperhubRequest: result.request,
    keeperhubResponse: result.raw,
    wouldRevert: parsed ? parsed.wouldRevert : null,
    revertReason: parsed?.revertReason ?? null,
    note:
      parsed?.wouldRevert === false
        ? "Simulated clean against real chain state. Nothing was broadcast - this MCP server has no path that can."
        : "KeeperHub answered the dry run. A wouldRevert of true is a real answer, not a failure to reach it; nothing was broadcast either way.",
  };
}

// ---------------------------------------------------------------------------
// get_execution_status
// ---------------------------------------------------------------------------

export const getExecutionStatusInputShape = {
  executionId: z
    .string()
    .min(1)
    .default(EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId)
    .describe(
      `KeeperHub execution id. Defaults to Exit Keepa's canonical live proof (${EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId}).`,
    ),
};

const getExecutionStatusInput = z.object(getExecutionStatusInputShape);
export type GetExecutionStatusInput = z.input<typeof getExecutionStatusInput>;

export interface GetExecutionStatusResult {
  executionId: string;
  isCanonicalLiveProof: boolean;
  keeperhubStatus: string;
  terminal: boolean;
  pollIntervalHintSeconds: number | null;
  /** Derived by the API's own receipts-are-authoritative logic, not by reading `status`. */
  outcome: ReturnType<typeof deriveExecutionOutcomeFromStatus>;
  receipts: unknown;
  sponsored: boolean | null;
  raw: unknown;
}

/**
 * Reads `GET /execute/{executionId}/status` once and interprets it with
 * the API's own deriveExecutionOutcomeFromStatus - so an MCP client gets
 * the same answer the product would record, including its refusal to call
 * anything succeeded on a self-reported hash with no verified receipt
 * behind it.
 *
 * A single read, not a poll loop: an agent that wants to wait can call
 * again, and `terminal` says whether that's worth doing.
 */
export async function getExecutionStatus(rawInput: unknown): Promise<GetExecutionStatusResult> {
  const input = getExecutionStatusInput.parse(rawInput ?? {});
  if (!hasKeeperHubCredentials()) throw new MissingKeeperHubCredentialsError("get_execution_status");

  const { status, pollIntervalHintSeconds } = await keeperHubClient.getDirectExecutionStatus(input.executionId);

  return {
    executionId: input.executionId,
    isCanonicalLiveProof: input.executionId === EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId,
    keeperhubStatus: status.status,
    terminal: pollIntervalHintSeconds === 0,
    pollIntervalHintSeconds,
    outcome: deriveExecutionOutcomeFromStatus(status, null),
    receipts: status.receipts ?? [],
    sponsored: status.sponsored ?? null,
    raw: status,
  };
}

// ---------------------------------------------------------------------------
// get_live_proof
// ---------------------------------------------------------------------------

export interface GetLiveProofResult {
  proof: typeof EXIT_KEEPA_LIVE_PROOF;
  stages: typeof EXIT_KEEPA_LIVE_PROOF_STAGES;
  note: string;
}

/**
 * Returns Exit Keepa's one real, already-landed execution, transcribed
 * from packages/shared/src/liveProof.ts.
 *
 * This tool is a constant. It performs no network call, mints nothing, and
 * cannot return a hash that isn't the one below - which is exactly what
 * makes it useful to a judge: there is no way for an agent to be handed a
 * freshly-generated "proof".
 */
export async function getLiveProof(): Promise<GetLiveProofResult> {
  return {
    proof: EXIT_KEEPA_LIVE_PROOF,
    stages: EXIT_KEEPA_LIVE_PROOF_STAGES,
    note:
      "Transcribed from an execution that already happened - never generated, never re-derived. The transaction hash is independently checkable on BaseScan without this project's cooperation; the KeeperHub execution id needs the org's API key (see get_execution_status).",
  };
}
