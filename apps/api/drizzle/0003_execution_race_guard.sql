-- P0 fix: POST /exit-strategies/:id/executions (the manual "create an
-- execution attempt" endpoint) only guarded against duplicate concurrent
-- creation with an application-level "does an in-flight row already exist"
-- check (select-then-insert), which is a TOCTOU race - two concurrent
-- requests could both pass the check and both insert a pending execution
-- for the same strategy. A DB-level constraint is the only guarantee two
-- concurrent requests can't both win.
--
-- The constraint is scoped to created_via = 'manual' only: agent/guardian.ts
-- legitimately creates a fresh execution row per edge-trigger crossing, and
-- an earlier crossing's execution can still be non-terminal (e.g.
-- 'simulated' but never broadcast) when a later crossing fires - see
-- test/agentGuardian.e2e.test.ts's "re-arms after the condition clears"
-- coverage. A blanket per-strategy constraint would incorrectly block that.
ALTER TABLE "keeperhub_executions" ADD COLUMN IF NOT EXISTS "created_via" text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
-- Backfill: every row inserted before this migration came from
-- agent/guardian.ts if and only if it has a linked agent_decisions row
-- (agent_decisions.execution_id) - the manual route never created one.
UPDATE "keeperhub_executions" AS "ke"
SET "created_via" = 'guardian'
WHERE EXISTS (
  SELECT 1 FROM "agent_decisions" AS "ad" WHERE "ad"."execution_id" = "ke"."id"
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keeperhub_executions_one_inflight_manual_per_strategy"
ON "keeperhub_executions" ("exit_strategy_id")
WHERE "created_via" = 'manual' AND "status" IN ('pending', 'simulating', 'simulated', 'executing');
