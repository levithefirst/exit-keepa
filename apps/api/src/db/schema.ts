import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

export const exitStrategyStatusEnum = pgEnum("exit_strategy_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const keeperhubExecutionStatusEnum = pgEnum("keeperhub_execution_status", [
  "pending",
  "simulating",
  "simulated",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
]);

export const safeAccounts = pgTable("safe_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  chainId: integer("chain_id").notNull(),
  safeAddress: text("safe_address").notNull(),
  // Zodiac Roles Modifier enabled on this Safe, scoping exactly which calls
  // KeeperHub's executor account may make on the Safe's behalf.
  rolesModifierAddress: text("roles_modifier_address"),
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
  keeperhubWorkflowId: text("keeperhub_workflow_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const keeperhubExecutions = pgTable("keeperhub_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  exitStrategyId: uuid("exit_strategy_id")
    .notNull()
    .references(() => exitStrategies.id, { onDelete: "cascade" }),
  keeperhubWorkflowId: text("keeperhub_workflow_id").notNull(),
  keeperhubExecutionId: text("keeperhub_execution_id"),
  status: keeperhubExecutionStatusEnum("status").notNull().default("pending"),
  requestPayload: jsonb("request_payload"),
  responsePayload: jsonb("response_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
