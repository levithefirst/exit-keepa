/**
 * The one canonical record of Exit Keepa's real, already-landed execution
 * on Base mainnet.
 *
 * Every surface that shows "the live proof" - the web audit timeline, the
 * MCP server's `get_live_proof` tool, the `npm run judge` script - reads
 * this module. There is exactly one place in this repo where these hashes
 * and ids are written down, so a hash can never drift between the docs,
 * the UI and the agent-facing tools.
 *
 * NOTHING HERE IS EVER GENERATED, MINTED, OR RE-DERIVED AT RUNTIME. These
 * are transcribed from artifacts that already exist and that a third party
 * can check independently:
 *
 * - the transaction hash, block number, and receipt status come from
 *   `eth_getTransactionReceipt` against Base RPC (also visible on
 *   BaseScan - see `basescanUrl`);
 * - the KeeperHub execution id, `sponsored`, and the executed-call fields
 *   come from KeeperHub's own `GET /execute/{executionId}/status` response
 *   for that same execution;
 * - the Safe, Roles Modifier, executor, Pool and USDC addresses are the
 *   ones this project has used throughout (see README.md "Live proof" and
 *   docs/SUBMISSION.md §6 for the full field-by-field trace).
 *
 * Adding a new hash here means a new transaction was actually broadcast
 * and independently verified. Do not add one otherwise.
 */

/** Base mainnet. The only chain Exit Keepa v1 executes on. */
export const LIVE_PROOF_CHAIN_ID = 8453;

export const EXIT_KEEPA_LIVE_PROOF = {
  chainId: LIVE_PROOF_CHAIN_ID,
  network: "Base mainnet",

  /** Receipt-verified on-chain transaction hash. Never a self-reported one. */
  txHash: "0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b",
  basescanUrl:
    "https://basescan.org/tx/0xc8a00cc28bf116acea722ab298d610bdbfc50a05b902aae5ab74d9da1849fd8b",

  /** KeeperHub's own id for this execution, from its Direct Execution status API. */
  keeperhubExecutionId: "u9zr4vzbfurjvzgwz687g",

  /** The Safe that owned the position throughout, and that the USDC returned to. */
  safeAddress: "0xfFd5c5e17e09E012C99550Bfb2ef88d370cd66a9",
  /** The Zodiac Roles Modifier the call was authorized through. */
  rolesModifierAddress: "0x694C3F6104741901F6AE0191Fd1afA9A274dBbBE",
  /** KeeperHub's executor identity - the role member on the Roles Modifier. */
  keeperhubExecutorAddress: "0xc68f0E22Dc6eD7e883873B36f23DdBBC1b3968Ac",
  /** Aave v3 Pool (Base) - the target of the authorized call. */
  aaveV3PoolAddress: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  /** USDC (Base) - the reserve withdrawn. */
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",

  /** From the fetched receipt, not from the write path's self-report. */
  receiptStatus: "success",
  receiptVerified: true,
  blockNumber: 50697644,

  /**
   * KeeperHub relayed this write through its own gas-sponsoring contract,
   * so BaseScan's top-level `from`/`to` are the relayer and the sponsor
   * contract - not the Safe and not the Roles Modifier. Both are recorded
   * here so a judge reading BaseScan isn't misled into thinking the
   * Roles path is missing; it is in the decoded input and the logs.
   */
  sponsored: true,
  topLevelFrom: "0x803f5380b968b23f6a1cad58e4b4178f9c7c6734",
  topLevelTo: "0x5af5194b4b0909eb978e3cf1e25333852277f07d",

  /** The semantic operation, as decoded from the transaction's own calldata. */
  functionName: "execTransactionWithRole",
  roleKey: "exit_keepa",
  innerCall: "withdraw(address asset, uint256 amount, address to)",

  /**
   * The Safe's own on-chain confirmation that it ran this as a module call
   * from the Roles Modifier. This event, in this transaction's logs, is
   * what makes the Zodiac Roles claim checkable rather than asserted.
   */
  safeModuleEvent: "ExecutionFromModuleSuccess",
} as const;

export type ExitKeepaLiveProof = typeof EXIT_KEEPA_LIVE_PROOF;

/**
 * How strongly each stage of the live-proof timeline is actually backed.
 *
 * The point of publishing this alongside the timeline is that a judge can
 * see, per stage, whether they're looking at something re-fetchable from a
 * third party or something this project is merely asserting:
 *
 * - `onchain`      - re-fetchable from Base RPC / BaseScan by anyone.
 * - `keeperhub`    - in KeeperHub's own execution record (its status API;
 *                    reading it needs the org's API key).
 * - `recomputed`   - not a stored claim at all: re-derived here and now by
 *                    running this repo's own deterministic code
 *                    (buildExitTransaction / checkPolicy) against the
 *                    live-proof Safe. Checkable by reading the code.
 * - `not-published`- this project does not hold a publishable artifact for
 *                    this stage. Said out loud rather than filled in.
 */
export type LiveProofEvidence = "onchain" | "keeperhub" | "recomputed" | "not-published";

export interface LiveProofStage {
  /** Stable id for the stage, in lifecycle order. */
  id: "condition" | "policy" | "simulate" | "execution" | "receipt";
  label: string;
  evidence: LiveProofEvidence;
  /** What is actually known at this stage. Never a value that wasn't recorded. */
  detail: string;
}

/**
 * The live-proof execution told as the five lifecycle stages the audit
 * timeline renders, in order.
 *
 * The `condition` stage is deliberately `not-published`: this broadcast
 * predates the agent-decision receipt table (apps/api/src/agent/receipt.ts),
 * so the exact APR reading that fired it was never persisted anywhere a
 * third party could check. Inventing a plausible number here would be
 * exactly the kind of fabrication the rest of this project refuses, so the
 * stage says so instead.
 *
 * The `policy` stage is `recomputed` rather than stored for a different
 * reason: the policy check is pure (agent/policy.ts - booleans and string
 * comparisons over a deterministically rebuilt transaction), so the honest
 * thing is to run it live against the live-proof Safe and show the result,
 * not to quote a saved verdict.
 */
export const EXIT_KEEPA_LIVE_PROOF_STAGES: readonly LiveProofStage[] = Object.freeze([
  {
    id: "condition",
    label: "Condition snapshot",
    evidence: "not-published",
    detail:
      "The rate reading that fired this exit was not persisted in a form anyone could re-check - this broadcast predates Exit Keepa's agent-decision receipts. No number is shown here rather than a made-up one. Every exit since is recorded with the observed APR (see the demo-sandbox rows below).",
  },
  {
    id: "policy",
    label: "Policy check",
    evidence: "recomputed",
    detail:
      "Re-run here and now against the live-proof Safe by this repo's own agent/policy.ts, over the transaction agent/../execution/buildTransaction.ts rebuilds deterministically. Not a stored verdict - a fresh evaluation you can reproduce by reading the code.",
  },
  {
    id: "simulate",
    label: "Simulated against real chain state",
    evidence: "keeperhub",
    detail:
      "execTransactionWithRole with simulate: true, against the real Roles Modifier and the real Aave v3 Pool. A broadcast is unreachable in this codebase without this gate passing first (execution/executeApproved.ts is the only broadcast path, and it only runs on a row already marked simulated).",
  },
  {
    id: "execution",
    label: "KeeperHub execution id",
    evidence: "keeperhub",
    detail: `KeeperHub recorded this write as execution ${EXIT_KEEPA_LIVE_PROOF.keeperhubExecutionId}, status completed, sponsored: true. Its status API is authenticated, so this id is not something a judge can paste into a public URL - the transaction hash below is the part anyone can verify unaided.`,
  },
  {
    id: "receipt",
    label: "Receipt confirmed on-chain",
    evidence: "onchain",
    detail: `Receipt status success in block ${EXIT_KEEPA_LIVE_PROOF.blockNumber}, verified by re-fetching the receipt from Base rather than trusting the write path. USDC left Aave v3 and landed back in the Safe; the Safe itself emitted ${EXIT_KEEPA_LIVE_PROOF.safeModuleEvent}.`,
  },
]);
