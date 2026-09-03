CREATE TABLE IF NOT EXISTS "local_accounts" (
	"username" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
