/**
 * Edge-trigger state machine for the autonomous Guardian loop.
 *
 * Without this, a poller that re-evaluates a strategy every N seconds would
 * attempt a fresh execution on every single tick for as long as the trigger
 * condition stays true - e.g. a rate that stays below the threshold for an
 * hour would try to withdraw the same position dozens of times. Persisting
 * an edge state per strategy (see exit_strategies.agent_state) turns that
 * into "attempt exactly once per crossing":
 *
 *   normal --(condition becomes true)--> held, one attempt made this tick
 *   held   --(condition still true)-----> held, no new attempt
 *   held   --(condition becomes false)--> normal
 *   normal --(condition still false)----> normal
 *
 * `held` covers both "TRIGGERED" (the tick that made the one attempt) and
 * "HELD" (every tick after, while the condition stays true) from the spec:
 * they're the same persisted state, distinguished only by whether this
 * particular tick is the one where the state changed into it.
 */

export type AgentState = "normal" | "held";

/**
 * "triggered" - this tick is a normal->held edge crossing; exactly one
 * execution attempt should be made.
 * "held" - condition is still true but was already held; no new attempt.
 * This is the specific case that prevents the double/triple/quadruple-
 * execute failure mode a naive poller would have.
 * "normal" - condition is not met; nothing to do.
 */
export type AgentDecisionKind = "triggered" | "held" | "normal";

export interface AgentTransition {
  decision: AgentDecisionKind;
  nextState: AgentState;
  /** True only for "triggered" - the single tick allowed to attempt an execution. */
  shouldAttempt: boolean;
}

export function nextAgentDecision(currentState: AgentState, conditionMet: boolean): AgentTransition {
  if (currentState === "normal") {
    return conditionMet
      ? { decision: "triggered", nextState: "held", shouldAttempt: true }
      : { decision: "normal", nextState: "normal", shouldAttempt: false };
  }
  // currentState === "held"
  return conditionMet
    ? { decision: "held", nextState: "held", shouldAttempt: false }
    : { decision: "normal", nextState: "normal", shouldAttempt: false };
}
