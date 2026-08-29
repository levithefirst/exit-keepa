import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { env } from "../env";
import { logger } from "../logger";

async function main() {
  const sql = neon(env.DATABASE_URL);
  const db = drizzle(sql);
  logger.info("Running database migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("Migrations complete.");
}

main().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
