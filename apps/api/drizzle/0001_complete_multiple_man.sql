DO $$ BEGIN
 CREATE TYPE "public"."agent_state" AS ENUM('normal', 'held');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "keeperhub_execution_status" ADD VALUE 'refused';--> statement-breakpoint
ALTER TYPE "keeperhub_execution_status" ADD VALUE 'blocked';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"execution_id" uuid,
	"source" text NOT NULL,
	"agent_state_before" "agent_state" NOT NULL,
	"agent_state_after" "agent_state" NOT NULL,
	"decision" text NOT NULL,
	"observation" jsonb NOT NULL,
	"condition_met" boolean NOT NULL,
	"policy" jsonb,
	"policy_passed" boolean,
	"refusal_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent_hash" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exit_strategies" ADD COLUMN "agent_state" "agent_state" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "exit_strategies" ADD COLUMN "agent_state_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_strategy_id_exit_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."exit_strategies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_execution_id_keeperhub_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."keeperhub_executions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
