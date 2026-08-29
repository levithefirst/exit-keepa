-- Initial schema for exit-keepa.
-- Generated to match apps/api/src/db/schema.ts. Regenerate with
-- `npm run db:generate --workspace apps/api` after schema changes instead
-- of hand-editing once drizzle-kit has been run against a real database.

CREATE TYPE "exit_strategy_status" AS ENUM ('draft', 'active', 'paused', 'archived');
CREATE TYPE "keeperhub_execution_status" AS ENUM ('pending', 'simulating', 'simulated', 'executing', 'succeeded', 'failed', 'cancelled');

CREATE TABLE IF NOT EXISTS "safe_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "chain_id" integer NOT NULL,
  "safe_address" text NOT NULL,
  "roles_modifier_address" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "exit_strategies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "safe_id" uuid NOT NULL REFERENCES "safe_accounts"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "status" "exit_strategy_status" NOT NULL DEFAULT 'draft',
  "condition" jsonb NOT NULL,
  "keeperhub_workflow_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "keeperhub_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exit_strategy_id" uuid NOT NULL REFERENCES "exit_strategies"("id") ON DELETE CASCADE,
  "keeperhub_workflow_id" text NOT NULL,
  "keeperhub_execution_id" text,
  "status" "keeperhub_execution_status" NOT NULL DEFAULT 'pending',
  "request_payload" jsonb,
  "response_payload" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "exit_strategies_safe_id_idx" ON "exit_strategies" ("safe_id");
CREATE INDEX IF NOT EXISTS "keeperhub_executions_exit_strategy_id_idx" ON "keeperhub_executions" ("exit_strategy_id");
