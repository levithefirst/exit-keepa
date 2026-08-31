import { createApp } from "./app";
import { env } from "./env";
import { logger } from "./logger";
import { startAgentPoller } from "./agent/poller";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "exit-keepa API listening");
  startAgentPoller();
});
