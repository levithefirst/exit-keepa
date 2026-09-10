import { encodeAaveV3WithdrawCalldata, resolveWithdrawAmount, type ExitAction } from "@exit-keepa/shared";
import { checkPolicy } from "../agent/policy";
import { buildExitTransaction, type BuiltTransaction, type SafeForExecution } from "./buildTransaction";

/**
 * The deliberately-wrong recipient used to demonstrate a refusal.
 *
 * Chosen to be unmistakably not anybody's Safe: the standard burn-ish
 * `0x...dEaD` address. The point of the demo is that Exit Keepa refuses to
 * send a user's funds anywhere except back to the Safe that owns them, so
 * the address needs to read as obviously hostile at a glance.
 */
export const BLOCKED_CALL_DEMO_RECIPIENT = "0x000000000000000000000000000000000000dEaD";

export interface BlockedCallDemoResult {
  /** Always true. This call is constructed so it cannot pass. */
  blocked: true;
  /** Always false, and asserted below - the demo never reaches KeeperHub. */
  keeperhubContacted: false;
  /** Always false. Nothing here has a path to a broadcast. */
  broadcast: false;
  /** The permitted transaction, for side-by-side comparison. */
  permitted: {
    to: string;
    data: string;
    recipient: string;
  };
  /** The transaction that was attempted and refused. */
  attempted: {
    to: string;
    data: string;
    recipient: string;
  };
  policy: Record<string, boolean>;
  policyPassed: false;
  refusalReasons: string[];
  /** The single check that failed, named plainly for the UI. */
  failedChecks: string[];
  /** What would have stopped this even if Exit Keepa's own check hadn't. */
  independentDefences: string[];
}

/**
 * Builds a withdraw that sends the Safe's funds somewhere other than the
 * Safe, runs Exit Keepa's real policy check over it, and reports the
 * refusal.
 *
 * Why this exists: "the executor can only ever return funds to your own
 * Safe" is the load-bearing claim of the whole permission model, and a
 * claim a judge should be able to *test*, not just read. One click builds
 * the violating call and shows it being turned away.
 *
 * Three things make this honest rather than theatre:
 *
 * - The calldata is encoded by the same `encodeAaveV3WithdrawCalldata`
 *   every real exit uses. Only the recipient differs from what
 *   `buildExitTransaction` would produce - which is exactly the point,
 *   since `buildExitTransaction` has no input that lets a caller name a
 *   recipient at all. The violating transaction has to be constructed here
 *   precisely because the production path cannot express it.
 * - The verdict comes from `agent/policy.ts` - the same function the
 *   autonomous agent runs before every real exit. No demo-specific rule.
 * - Nothing is called, sent, simulated or stored. The function is pure: it
 *   takes a Safe, returns a refusal, and touches no network and no
 *   database. `keeperhubContacted` and `broadcast` are constants because
 *   there is no code here that could make them anything else.
 */
export function buildBlockedCallDemo(action: ExitAction, safe: SafeForExecution): BlockedCallDemoResult {
  // The transaction Exit Keepa would really run, for comparison. Throws
  // for a Safe with no Roles Modifier or on the wrong chain, same as
  // everywhere else - a refusal demo on an unusable Safe would be
  // meaningless.
  const permitted: BuiltTransaction = buildExitTransaction(action, safe);

  const divertedData = encodeAaveV3WithdrawCalldata({
    asset: action.asset,
    amount: resolveWithdrawAmount(action.amount),
    to: BLOCKED_CALL_DEMO_RECIPIENT,
  });

  const attempted: BuiltTransaction = {
    ...permitted,
    data: divertedData,
    decodedArgs: { ...permitted.decodedArgs, to: BLOCKED_CALL_DEMO_RECIPIENT },
  };

  const { policy, policyPassed, refusalReasons } = checkPolicy(attempted, safe, null);

  // Not a defensive nicety - if a future change ever made a diverted
  // recipient pass the policy check, silently rendering "blocked" would be
  // the worst possible outcome. Fail loudly instead.
  if (policyPassed) {
    throw new Error(
      "Blocked-call demo built a transaction that PASSED the policy check. The recipient bound is not being enforced - this is a real bug, not a demo failure.",
    );
  }

  return {
    blocked: true,
    keeperhubContacted: false,
    broadcast: false,
    permitted: { to: permitted.to, data: permitted.data, recipient: permitted.decodedArgs.to },
    attempted: { to: attempted.to, data: attempted.data, recipient: BLOCKED_CALL_DEMO_RECIPIENT },
    policy,
    policyPassed: false,
    refusalReasons,
    failedChecks: Object.entries(policy)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    independentDefences: [
      "Exit Keepa's policy check refused it here, before anything was sent - which is why KeeperHub was never contacted.",
      `The Zodiac Roles Modifier would refuse it independently: the role's scopeFunction condition fixes withdraw's \`to\` parameter to ${safe.safeAddress}, so the call reverts with a ConditionViolation at the permission layer even if it somehow got that far.`,
      "buildExitTransaction, the only path a real exit takes, has no input for a recipient at all - it always uses the Safe's own address. This transaction had to be hand-built for the demo because the production path cannot express it.",
    ],
  };
}
