import { createApp } from "./app";
import { env } from "./env";
import { logger } from "./logger";
import { startAgentPoller } from "./agent/poller";
import { verifyFactory } from "./safe/authorizationTransactions";

async function main() {
  await verifyFactory();
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "exit-keepa API listening");
    startAgentPoller();
  });
}

main().catch((error) => {
  logger.error({ error }, "Exit Keepa API startup verification failed");
  process.exit(1);
});
