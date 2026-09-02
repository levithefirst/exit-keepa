-- Note: this drizzle-kit generate run also detected keeperhub_executions.
-- created_via as "new" because migration 0003 added that column by hand
-- (ALTER TABLE ... ADD COLUMN IF NOT EXISTS) rather than through
-- drizzle-kit generate, so it was never recorded in the meta snapshot
-- history. That line has been removed from this file - the column already
-- exists in every real database. The regenerated meta/0004_snapshot.json
-- does capture created_via correctly, which fixes the drift for future
-- `db:generate` runs; only the SQL text needed manual correction here.
ALTER TABLE "safe_accounts" ADD COLUMN "is_sandbox" boolean DEFAULT false NOT NULL;
