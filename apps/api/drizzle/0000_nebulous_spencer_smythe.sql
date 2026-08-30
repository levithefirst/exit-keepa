DO $$ BEGIN
 CREATE TYPE "public"."exit_strategy_status" AS ENUM('draft', 'active', 'paused', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."keeperhub_execution_status" AS ENUM('pending', 'simulating', 'simulated', 'executing', 'succeeded', 'failed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exit_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"safe_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "exit_strategy_status" DEFAULT 'draft' NOT NULL,
	"condition" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"keeperhub_workflow_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "keeperhub_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exit_strategy_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"keeperhub_workflow_id" text,
	"keeperhub_execution_id" text,
	"status" "keeperhub_execution_status" DEFAULT 'pending' NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"tx_hash" text,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keeperhub_executions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safe_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"safe_address" text NOT NULL,
	"roles_modifier_address" text,
	"roles_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exit_strategies" ADD CONSTRAINT "exit_strategies_safe_id_safe_accounts_id_fk" FOREIGN KEY ("safe_id") REFERENCES "public"."safe_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "keeperhub_executions" ADD CONSTRAINT "keeperhub_executions_exit_strategy_id_exit_strategies_id_fk" FOREIGN KEY ("exit_strategy_id") REFERENCES "public"."exit_strategies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
