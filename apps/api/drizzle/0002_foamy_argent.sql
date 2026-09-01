CREATE TABLE IF NOT EXISTS "auth_nonces" (
	"address" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safe_owners" (
	"safe_id" uuid PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "safe_owners" ADD CONSTRAINT "safe_owners_safe_id_safe_accounts_id_fk" FOREIGN KEY ("safe_id") REFERENCES "public"."safe_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Backfill: every safe_accounts row that predates this migration (in
-- practice, just the live demo Safe) gets assigned to the fixed demo
-- identity (0x0000...0000 - the zero address, which has no private key,
-- so it can only ever be reached through the explicit, clearly-labeled
-- /api/auth/demo-session path, never through a real signature). Every
-- safe_accounts row created after this migration is inserted by
-- POST /api/safe-accounts itself, in the same request, under the
-- authenticated caller's real address - see routes/safeAccounts.ts.
INSERT INTO "safe_owners" ("safe_id", "owner_address")
SELECT "id", '0x0000000000000000000000000000000000000000'
FROM "safe_accounts"
WHERE "id" NOT IN (SELECT "safe_id" FROM "safe_owners")
ON CONFLICT ("safe_id") DO NOTHING;
