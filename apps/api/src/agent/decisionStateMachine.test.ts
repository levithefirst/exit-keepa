import { describe, expect, it } from "vitest";
import { nextAgentDecision, type AgentState } from "./decisionStateMachine";

describe("edge-trigger decision state machine", () => {
  it("stays normal and attempts nothing while the condition is false", () => {
    const result = nextAgentDecision("normal", false);
    expect(result).toEqual({ decision: "normal", nextState: "normal", shouldAttempt: false });
  });

  it("crosses normal -> held and attempts exactly once the instant the condition becomes true", () => {
    const result = nextAgentDecision("normal", true);
    expect(result).toEqual({ decision: "triggered", nextState: "held", shouldAttempt: true });
  });

  it("stays held with no new attempt while the condition remains true - the failure mode a naive poller would hit", () => {
    const result = nextAgentDecision("held", true);
    expect(result).toEqual({ decision: "held", nextState: "held", shouldAttempt: false });
  });

  it("returns to normal, with no attempt, the instant the condition clears", () => {
    const result = nextAgentDecision("held", false);
    expect(result).toEqual({ decision: "normal", nextState: "normal", shouldAttempt: false });
  });

  it("never attempts more than once across a long run where the condition stays true the whole time", () => {
    let state: AgentState = "normal";
    let attempts = 0;
    // Simulate 50 consecutive poll ticks, condition true throughout.
    for (let tick = 0; tick < 50; tick++) {
      const result = nextAgentDecision(state, true);
      if (result.shouldAttempt) attempts++;
      state = result.nextState;
    }
    expect(attempts).toBe(1);
    expect(state).toBe("held");
  });

  it("re-arms after the condition clears, so a second real crossing later attempts again exactly once", () => {
    let state: AgentState = "normal";

    const firstCross = nextAgentDecision(state, true);
    state = firstCross.nextState;
    expect(firstCross.shouldAttempt).toBe(true);

    // Condition stays true for a while - no further attempts.
    for (let i = 0; i < 5; i++) {
      const held = nextAgentDecision(state, true);
      expect(held.shouldAttempt).toBe(false);
      state = held.nextState;
    }

    // Condition clears.
    const cleared = nextAgentDecision(state, false);
    expect(cleared).toEqual({ decision: "normal", nextState: "normal", shouldAttempt: false });
    state = cleared.nextState;

    // Condition stays false for a while - still nothing to do.
    for (let i = 0; i < 5; i++) {
      const stillNormal = nextAgentDecision(state, false);
      expect(stillNormal.shouldAttempt).toBe(false);
      state = stillNormal.nextState;
    }

    // A second real crossing attempts exactly once again.
    const secondCross = nextAgentDecision(state, true);
    expect(secondCross).toEqual({ decision: "triggered", nextState: "held", shouldAttempt: true });
  });
});
