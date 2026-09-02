import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";

export const exitStrategyStatusEnum = pgEnum("exit_strategy_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

/**
 * `refused` — the Guardian's deterministic policy or condition check said no
 * before this attempt was ever sent to KeeperHub. Created directly in this
 * status; never passes through pending/simulating.
 * `blocked` — an execution that already passed simulation is stopped from
 * broadcasting by a check discovered at broadcast time (stale decision, the
 * strategy was edited since, or the live position no longer covers the
 * configured amount). Distinct from `failed` (a simulation revert or a
 * confirmed KeeperHub rejection) so "we never tried" (refused), "we were
 * about to but a boundary condition stopped us" (blocked), and "we tried and
 * it didn't work" (failed) are never conflated in the UI or the receipt.
 */
export const keeperhubExecutionStatusEnum = pgEnum("keeperhub_execution_status", [
  "pending",
  "simulating",
  "simulated",
  "executing",
  "succeeded",
  "failed",
  "refused",
  "blocked",
  "cancelled",
]);

/**
 * Edge-trigger state for the autonomous Guardian loop, persisted per
 * strategy so a poller that runs every N seconds attempts a trigger exactly
 * once per crossing, not once per tick while the condition stays true.
 * normal -> held happens atomically (conditional UPDATE ... WHERE
 * agent_state = 'normal') at the same moment the one allowed execution
 * attempt for this crossing is created, so two concurrent poll ticks can
 * never both win the transition and both attempt. held -> normal only once
 * the live condition stops being true again.
 */
export const agentStateEnum = pgEnum("agent_state", ["normal", "held"]);

export const safeAccounts = pgTable("safe_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  chainId: integer("chain_id").notNull(),
  safeAddress: text("safe_address").notNull(),
  // Zodiac Roles Modifier enabled on this Safe, scoping exactly which calls
  // KeeperHub's executor account may make on the Safe's behalf.
  rolesModifierAddress: text("roles_modifier_address"),
  // The bytes32 role key (within that Roles Modifier) that Exit Keepa's
  // strategies execute under. Required to build execTransactionWithRole
  // calls; null until the user has configured Roles for this Safe.
  rolesKey: text("roles_key"),
  // True only for a demo session's own private, auto-provisioned Safe (see
  // POST /api/auth/demo-session) — never a real deployed Safe on any chain.
  // Gates two things: execution/simulate.ts returns a mocked, clearly-
  // labeled simulation instead of calling KeeperHub (nothing real exists
  // on-chain to simulate against), and routes/executions.ts refuses to
  // ever broadcast one for real. Every other read/write path treats a
  // sandbox row exactly like a real one — same schema, same routes.
  isSandbox: boolean("is_sandbox").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const exitStrategies = pgTable("exit_strategies", {
  id: uuid("id").defaultRandom().primaryKey(),
  safeId: uuid("safe_id")
    .notNull()
    .references(() => safeAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: exitStrategyStatusEnum("status").notNull().default("draft"),
  condition: jsonb("condition").notNull(),
  // The exact on-chain action this strategy executes on trigger (protocol,
  // function, asset, amount) — see @exit-keepa/shared's ExitAction. Stored
  // so the transaction can be reconstructed deterministically at execution
  // time rather than trusting anything supplied at trigger time.
  action: jsonb("action").notNull(),
  keeperhubWorkflowId: text("keeperhub_workflow_id"),
  // Edge-trigger state for the autonomous poller - see agentStateEnum above.
  agentState: agentStateEnum("agent_state").notNull().default("normal"),
  agentStateUpdatedAt: timestamp("agent_state_updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const keeperhubExecutions = pgTable("keeperhub_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  exitStrategyId: uuid("exit_strategy_id")
    .notNull()
    .references(() => exitStrategies.id, { onDelete: "cascade" }),
  // Deterministic per-trigger-occurrence key (derived from strategy id +
  // trigger nonce). Unique so a retried request can never cause a second
  // broadcast of the same occurrence — see routes/execution.ts.
  idempotencyKey: text("idempotency_key").notNull().unique(),
  // Which code path created this row - "guardian" (agent/guardian.ts, one
  // row per edge-trigger crossing; several non-terminal rows for the same
  // strategy over time is normal and expected there - see
  // decisionStateMachine.ts) or "manual" (routes/executions.ts's directly-
  // called create endpoint, whose own contract is "at most one in-flight
  // execution per strategy at a time" - see the partial unique index in
  // migration 0003, scoped to this value so it never fights Guardian's
  // legitimate multi-execution-over-time model).
  createdVia: text("created_via").notNull().default("manual"),
  keeperhubWorkflowId: text("keeperhub_workflow_id"),
  keeperhubExecutionId: text("keeperhub_execution_id"),
  status: keeperhubExecutionStatusEnum("status").notNull().default("pending"),
  requestPayload: jsonb("request_payload"),
  responsePayload: jsonb("response_payload"),
  // Populated only once a real broadcast (simulate:false) has returned a
  // transaction hash. Never fabricated, never reused across executions.
  txHash: text("tx_hash"),
  broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One row per Exit Guardian evaluation tick (autonomous poll or on-demand
 * check) - the receipt backbone. Written on every tick regardless of
 * outcome, so "the agent observed X and did nothing because normal" is just
 * as inspectable as an approval or a refusal. `executionId` is only set on
 * the tick that actually created an execution row (a true edge-trigger
 * crossing); a decision recorded while `held` or `normal` has none, because
 * nothing was attempted.
 */
export const agentDecisions = pgTable("agent_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyId: uuid("strategy_id")
    .notNull()
    .references(() => exitStrategies.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").references(() => keeperhubExecutions.id, { onDelete: "set null" }),
  // "poller" (autonomous background loop) or "manual" (on-demand API call) -
  // kept distinct so the demo/UI can show which decisions were genuinely
  // unattended.
  source: text("source").notNull(),
  agentStateBefore: agentStateEnum("agent_state_before").notNull(),
  agentStateAfter: agentStateEnum("agent_state_after").notNull(),
  // "triggered" (condition met, edge crossed, an attempt was made this
  // tick - see the linked execution's own status for the outcome), "held"
  // (condition still true but already triggered - no new attempt, this is
  // exactly the failure mode edge-triggering prevents), or "normal"
  // (condition not met, nothing to do).
  decision: text("decision").notNull(),
  observation: jsonb("observation").notNull(),
  conditionMet: boolean("condition_met").notNull(),
  policy: jsonb("policy"),
  policyPassed: boolean("policy_passed"),
  refusalReasons: jsonb("refusal_reasons").notNull().default([]),
  intentHash: text("intent_hash").notNull(),
  receiptHash: text("receipt_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Who owns a Safe *record in Exit Keepa's own database* - the wallet that
 * proved (via a signed nonce, see routes/auth.ts) it controls
 * `ownerAddress` at registration time. This is deliberately not the same
 * claim as "is a signer on the Gnosis Safe itself" - verifying on-chain
 * Safe-signer status is a separate, harder problem this doesn't attempt.
 * What it does guarantee: only the wallet that registered a Safe (or, for
 * a demo session's own sandbox Safe, that session's own randomly-generated
 * owner identity - see POST /api/auth/demo-session) can read or act on it
 * through this API. Addresses are always stored lowercased; compare
 * lowercased on every read.
 */
export const safeOwners = pgTable("safe_owners", {
  safeId: uuid("safe_id")
    .primaryKey()
    .references(() => safeAccounts.id, { onDelete: "cascade" }),
  ownerAddress: text("owner_address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A one-time-use challenge issued to an address before it can prove key
 * possession. One row per address (a fresh nonce request overwrites the
 * previous one, invalidating it) - see routes/auth.ts.
 */
export const authNonces = pgTable("auth_nonces", {
  address: text("address").primaryKey(),
  nonce: text("nonce").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** An issued session: opaque bearer token -> the address it authenticates as. */
export const authSessions = pgTable("auth_sessions", {
  token: text("token").primaryKey(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Append-only audit log for every state-changing action and every inbound
 * KeeperHub webhook. This is the source of truth for "what happened and
 * when" independent of the mutable tables above.
 */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
