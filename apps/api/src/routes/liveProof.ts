import { Router } from "express";
import {
  AAVE_V3_BASE,
  canonicalRoleKey,
  EXIT_KEEPA_LIVE_PROOF,
  EXIT_KEEPA_LIVE_PROOF_STAGES,
  type ExitAction,
} from "@exit-keepa/shared";
import { checkPolicy } from "../agent/policy";
import { buildExitTransaction, type SafeForExecution } from "../execution/buildTransaction";

export const liveProofRouter = Router();

/**
 * The live-proof Safe as Exit Keepa's own execution code sees it. Not read
 * from the database on purpose: this is a published, immutable fact about
 * an execution that already happened, and it must read the same whether or
 * not that Safe still happens to have a row in whichever database this
 * process is pointed at.
 */
const LIVE_PROOF_SAFE: SafeForExecution = {
  safeAddress: EXIT_KEEPA_LIVE_PROOF.safeAddress,
  chainId: EXIT_KEEPA_LIVE_PROOF.chainId,
  rolesModifierAddress: EXIT_KEEPA_LIVE_PROOF.rolesModifierAddress,
  rolesKey: canonicalRoleKey(),
};

/** The action the live proof actually executed: withdraw the whole USDC position. */
const LIVE_PROOF_ACTION: ExitAction = {
  protocol: "aave-v3-base",
  action: "withdraw",
  asset: AAVE_V3_BASE.usdc,
  amount: "max",
};

/**
 * `GET /api/live-proof` - the audit trail for Exit Keepa's one real
 * on-chain execution, in lifecycle order.
 *
 * Deliberately public and session-free. Everything it returns is already
 * published (README.md, docs/SUBMISSION.md §6, and the transaction itself
 * on BaseScan), and requiring a judge to authenticate before they can read
 * proof would be theatre. It reads no database, holds no secret, and
 * contacts nothing.
 *
 * The one stage that isn't a transcription is `policy`: it is genuinely
 * recomputed on every request by running this codebase's own
 * `buildExitTransaction` + `checkPolicy` against the live-proof Safe. So
 * the policy row a judge sees is this server's real verdict right now, not
 * a saved claim about what it once said - which is the honest way to
 * present a check that is pure and therefore reproducible.
 *
 * The `condition` stage is reported as `not-published` because that is
 * true: the rate reading that fired this exit was never persisted
 * anywhere checkable. See packages/shared/src/liveProof.ts.
 */
liveProofRouter.get("/live-proof", async (_req, res) => {
  const transaction = buildExitTransaction(LIVE_PROOF_ACTION, LIVE_PROOF_SAFE);
  const { policy, policyPassed, refusalReasons } = checkPolicy(transaction, LIVE_PROOF_SAFE, null);

  res.status(200).json({
    proof: EXIT_KEEPA_LIVE_PROOF,
    stages: EXIT_KEEPA_LIVE_PROOF_STAGES,
    /** The transaction the live proof executed, rebuilt deterministically. */
    transaction,
    /** Recomputed now, not stored - see the doc comment above. */
    policy,
    policyPassed,
    refusalReasons,
    recomputedAt: new Date().toISOString(),
  });
});
