import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROADCAST_ENV_FLAG,
  isBroadcastAllowed,
  validateKeeperhubWorkflow,
  type KeeperhubWorkflowDocument,
} from "./keeperhubWorkflow";

/**
 * The shipped artifact itself is the subject under test - not a fixture
 * copy of it. If docs/workflows/aave-usdc-protective-exit.json drifts away
 * from the invariants (an ungated broadcast, a different target, a
 * recipient that isn't the Safe), this fails.
 */
const WORKFLOW_PATH = resolve(__dirname, "../../../../docs/workflows/aave-usdc-protective-exit.json");

function loadWorkflow(): unknown {
  return JSON.parse(readFileSync(WORKFLOW_PATH, "utf8"));
}

describe("docs/workflows/aave-usdc-protective-exit.json", () => {
  it("is valid against the workflow schema", () => {
    const result = validateKeeperhubWorkflow(loadWorkflow());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("describes the workflow surface while naming Direct Execution REST as what actually landed", () => {
    const { workflow } = validateKeeperhubWorkflow(loadWorkflow());
    expect(workflow?.surface).toBe("keeperhub-workflow");
    expect(workflow?.liveProofSurface).toBe("keeperhub-direct-execution-rest");
    expect(workflow?.registeredWithKeeperhub).toBe(false);
  });

  it("keeps its broadcast step disabled and gated on the env flag", () => {
    const { workflow } = validateKeeperhubWorkflow(loadWorkflow());
    expect(workflow?.broadcast.enabled).toBe(false);
    expect(workflow?.broadcast.gatedBy).toEqual({ envVar: BROADCAST_ENV_FLAG, equals: "1" });

    const broadcastSteps = (workflow?.steps ?? []).filter(
      (step) => step.kind === "contract-call" && step.simulate === false,
    );
    expect(broadcastSteps).toHaveLength(1);
    for (const step of broadcastSteps) {
      if (step.kind !== "contract-call") throw new Error("unreachable");
      expect(step.enabled).toBe(false);
      expect(step.gatedBy).toEqual({ envVar: BROADCAST_ENV_FLAG, equals: "1" });
    }
  });

  it("simulates before it ever describes broadcasting", () => {
    const { workflow } = validateKeeperhubWorkflow(loadWorkflow());
    const steps = workflow?.steps ?? [];
    const simulateIndex = steps.findIndex((s) => s.kind === "contract-call" && s.simulate === true);
    const broadcastIndex = steps.findIndex((s) => s.kind === "contract-call" && s.simulate === false);
    expect(simulateIndex).toBeGreaterThanOrEqual(0);
    expect(broadcastIndex).toBeGreaterThan(simulateIndex);
  });
});

describe("keeperhubWorkflowSchema invariants", () => {
  function mutate(fn: (workflow: any) => void): unknown {
    const workflow = loadWorkflow() as any;
    fn(workflow);
    return workflow;
  }

  it("rejects a broadcast step with no env gate", () => {
    const result = validateKeeperhubWorkflow(
      mutate((w) => {
        delete w.steps[3].gatedBy;
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(BROADCAST_ENV_FLAG);
  });

  it("rejects a broadcast step that is left enabled", () => {
    const result = validateKeeperhubWorkflow(
      mutate((w) => {
        w.steps[3].enabled = true;
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects an inner call pointed anywhere but the Aave v3 Base Pool", () => {
    const result = validateKeeperhubWorkflow(
      mutate((w) => {
        w.steps[2].innerCall.target = "0x0000000000000000000000000000000000000dEaD";
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a recipient other than the Safe itself", () => {
    const result = validateKeeperhubWorkflow(
      mutate((w) => {
        w.steps[2].innerCall.recipient = "0x0000000000000000000000000000000000000dEaD";
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a workflow with no simulate step", () => {
    const result = validateKeeperhubWorkflow(
      mutate((w: KeeperhubWorkflowDocument & { steps: any[] }) => {
        w.steps = w.steps.filter((s) => !(s.kind === "contract-call" && s.simulate === true));
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("simulate: true");
  });

  it("rejects a workflow that drops the policy gate", () => {
    const result = validateKeeperhubWorkflow(
      mutate((w: KeeperhubWorkflowDocument & { steps: any[] }) => {
        w.steps = w.steps.filter((s) => s.kind !== "policy-check");
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("policy-check");
  });

  it("collects every problem at once rather than throwing on the first", () => {
    const result = validateKeeperhubWorkflow({ name: "nope" });
    expect(result.valid).toBe(false);
    expect(result.workflow).toBeNull();
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe("isBroadcastAllowed", () => {
  it("is true only for exactly \"1\"", () => {
    expect(isBroadcastAllowed({ [BROADCAST_ENV_FLAG]: "1" })).toBe(true);
  });

  it.each([undefined, "", "0", "true", "yes", "1 ", " 1", "01"])("is false for %j", (value) => {
    const environment: NodeJS.ProcessEnv = {};
    if (value !== undefined) environment[BROADCAST_ENV_FLAG] = value;
    expect(isBroadcastAllowed(environment)).toBe(false);
  });
});
