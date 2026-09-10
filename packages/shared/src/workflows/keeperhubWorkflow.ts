import { z } from "zod";
import { AAVE_V3_BASE, AAVE_V3_WITHDRAW_SELECTOR } from "../protocols/aaveV3Base";
import { rateConditionSchema } from "../schemas";

/**
 * Schema for Exit Keepa's *agent-authored workflow artifact* - the
 * declarative description of the KeeperHub workflow an agent would author
 * for a protective Aave v3 USDC exit.
 *
 * Why this exists as an artifact and not as a second live write:
 * Exit Keepa's real, landed execution (see ../liveProof.ts) went through
 * KeeperHub's **Direct Execution REST** surface - simulate, then broadcast
 * with an Idempotency-Key, then poll for the receipt. That path is proven
 * and it is the one the product runs. This file describes the same
 * operation as a workflow definition so the agent-facing surface is
 * inspectable and reviewable *before* anything is registered or run,
 * rather than adding a second, unproven way to move funds.
 *
 * Nothing in this repo calls KeeperHub's `POST /workflows` or
 * `POST /workflows/{id}/execute` with this document. It is validated
 * (see validateKeeperhubWorkflow) and read - never executed.
 *
 * The invariants below are the point of the schema. A workflow document
 * that would let a broadcast run without an explicit, out-of-band env flag,
 * or that would broadcast something other than the one permitted call, is
 * rejected here rather than reviewed by eye.
 */

/** The single environment flag that gates every broadcast code path in this repo. */
export const BROADCAST_ENV_FLAG = "EXIT_KEEPA_ALLOW_BROADCAST";
/** The flag's one enabling value. Anything else - unset, "true", "0", "1 " - means "no". */
export const BROADCAST_ENV_ENABLED_VALUE = "1";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte hex address");

/**
 * A step that reads a rate and decides whether the exit should fire at all.
 * Reuses the same rate-condition shape the stored strategies use, so a
 * workflow can never describe a trigger the product itself can't evaluate.
 */
const rateConditionStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("rate-condition"),
  description: z.string().min(1),
  condition: rateConditionSchema,
  /** Where the rate is read from. Recorded so the trigger isn't a black box. */
  source: z.object({
    contract: addressSchema,
    functionName: z.string().min(1),
    field: z.string().min(1),
  }),
});

/**
 * The deterministic policy gate. Named here so the workflow artifact and
 * the running code describe the same checks (agent/policy.ts's keys).
 */
const policyCheckStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("policy-check"),
  description: z.string().min(1),
  checks: z.array(z.string().min(1)).min(1),
  onFailure: z.literal("refuse"),
});

const broadcastGateSchema = z.object({
  envVar: z.literal(BROADCAST_ENV_FLAG),
  equals: z.literal(BROADCAST_ENV_ENABLED_VALUE),
});

/**
 * A KeeperHub contract-call step. `simulate: true` is the dry run;
 * `simulate: false` is a real broadcast and is therefore forced to carry
 * both `enabled: false` and the env gate - the schema will not accept a
 * workflow document that describes an ungated broadcast.
 */
const contractCallStepSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("contract-call"),
    description: z.string().min(1),
    /** Always the Safe's Roles Modifier - the only contract KeeperHub is ever asked to call. */
    contract: z.literal("roles-modifier"),
    functionName: z.literal("execTransactionWithRole"),
    simulate: z.boolean(),
    /** Required, and required to be false, on any simulate: false step. */
    enabled: z.boolean().optional(),
    gatedBy: broadcastGateSchema.optional(),
    /** The call the Roles Modifier is asked to forward, spelled out. */
    innerCall: z.object({
      target: addressSchema.refine((value) => value.toLowerCase() === AAVE_V3_BASE.pool.toLowerCase(), {
        message: `inner call target must be the Aave v3 Base Pool (${AAVE_V3_BASE.pool})`,
      }),
      selector: z
        .string()
        .refine((value) => value.toLowerCase() === AAVE_V3_WITHDRAW_SELECTOR.toLowerCase(), {
          message: `inner call selector must be Aave v3 withdraw (${AAVE_V3_WITHDRAW_SELECTOR})`,
        }),
      signature: z.string().min(1),
      asset: addressSchema.refine((value) => value.toLowerCase() === AAVE_V3_BASE.usdc.toLowerCase(), {
        message: `inner call asset must be Base USDC (${AAVE_V3_BASE.usdc})`,
      }),
      amount: z.union([z.literal("max"), z.string().regex(/^[1-9][0-9]*$/)]),
      /** The literal string "safe" - funds may only ever return to the Safe itself. */
      recipient: z.literal("safe"),
      operation: z.literal(0),
    }),
  })
  .superRefine((step, ctx) => {
    if (step.simulate) {
      if (step.gatedBy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gatedBy"],
          message: "a simulate: true step is a dry run and must not carry a broadcast gate",
        });
      }
      return;
    }

    if (step.enabled !== false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enabled"],
        message: "a simulate: false (broadcast) step must be explicitly disabled with enabled: false",
      });
    }
    if (!step.gatedBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gatedBy"],
        message: `a simulate: false (broadcast) step must be gated by ${BROADCAST_ENV_FLAG}=${BROADCAST_ENV_ENABLED_VALUE}`,
      });
    }
  });

const workflowStepSchema = z.union([rateConditionStepSchema, policyCheckStepSchema, contractCallStepSchema]);

export const keeperhubWorkflowSchema = z
  .object({
    /** Points at this module - the schema this document is validated against. */
    $schema: z.literal("https://github.com/levithefirst/exit-keepa/packages/shared/src/workflows/keeperhubWorkflow.ts"),
    name: z.string().min(1),
    version: z.number().int().positive(),
    chainId: z.literal(AAVE_V3_BASE.chainId),
    description: z.string().min(1),
    /**
     * Which KeeperHub surface this document describes, and which one
     * actually produced the live proof. Both are required so the artifact
     * can never quietly imply the workflow surface is what landed on-chain.
     */
    surface: z.literal("keeperhub-workflow"),
    liveProofSurface: z.literal("keeperhub-direct-execution-rest"),
    authoredBy: z.literal("exit-keepa-agent"),
    /** Whether anything in this repo registers or runs this document. It does not. */
    registeredWithKeeperhub: z.literal(false),
    broadcast: z.object({
      enabled: z.literal(false),
      gatedBy: broadcastGateSchema,
      note: z.string().min(1),
    }),
    steps: z.array(workflowStepSchema).min(1),
    notes: z.array(z.string().min(1)).min(1),
  })
  .superRefine((workflow, ctx) => {
    const contractCalls = workflow.steps.filter(
      (step): step is z.infer<typeof contractCallStepSchema> => step.kind === "contract-call",
    );

    const firstSimulateIndex = workflow.steps.findIndex((s) => s.kind === "contract-call" && s.simulate === true);
    const firstBroadcastIndex = workflow.steps.findIndex((s) => s.kind === "contract-call" && s.simulate === false);

    if (firstSimulateIndex === -1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "workflow must contain a simulate: true contract-call step",
      });
    }
    if (firstBroadcastIndex !== -1 && (firstSimulateIndex === -1 || firstBroadcastIndex < firstSimulateIndex)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "a broadcast step must come after the simulate step it depends on",
      });
    }
    if (contractCalls.filter((s) => !s.simulate).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "workflow describes more than one broadcast - Exit Keepa has exactly one",
      });
    }
    if (workflow.steps.findIndex((s) => s.kind === "policy-check") === -1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "workflow must contain the deterministic policy-check step",
      });
    }
  });

export type KeeperhubWorkflowDocument = z.infer<typeof keeperhubWorkflowSchema>;

export interface WorkflowValidationResult {
  valid: boolean;
  workflow: KeeperhubWorkflowDocument | null;
  /** One human-readable line per problem, `path: message`. Empty when valid. */
  errors: string[];
}

/**
 * Validates a workflow document. Never throws - a caller (a test, a CI
 * step, an agent about to hand this to a human) gets every problem at once
 * rather than the first one.
 */
export function validateKeeperhubWorkflow(input: unknown): WorkflowValidationResult {
  const parsed = keeperhubWorkflowSchema.safeParse(input);
  if (parsed.success) {
    return { valid: true, workflow: parsed.data, errors: [] };
  }
  return {
    valid: false,
    workflow: null,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
  };
}

/**
 * True only when the environment explicitly, exactly enables broadcasting.
 * Unset, empty, "true", "yes", "0", or "1 " all mean no - there is one
 * enabling value and it is the string "1".
 */
export function isBroadcastAllowed(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[BROADCAST_ENV_FLAG] === BROADCAST_ENV_ENABLED_VALUE;
}
