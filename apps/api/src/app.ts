import express from "express";
import "express-async-errors";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./env";
import { logger } from "./logger";
import { healthRouter } from "./routes/health";
import { exitStrategiesRouter } from "./routes/exitStrategies";
import { safeAccountsRouter } from "./routes/safeAccounts";
import { executionsRouter } from "./routes/executions";
import { webhooksRouter } from "./routes/webhooks";
import { agentRouter } from "./routes/agent";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  const allowAllOrigins = env.CORS_ORIGINS.includes("*");
  app.use(
    cors({
      origin: allowAllOrigins ? true : env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    }),
  );
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(healthRouter);
  app.use("/api", exitStrategiesRouter);
  app.use("/api", safeAccountsRouter);
  app.use("/api", executionsRouter);
  app.use("/api", webhooksRouter);
  app.use("/api", agentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
