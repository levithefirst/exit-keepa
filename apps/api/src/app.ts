import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./env";
import { logger } from "./logger";
import { healthRouter } from "./routes/health";
import { exitStrategiesRouter } from "./routes/exitStrategies";
import { webhooksRouter } from "./routes/webhooks";
import { diagnosticsRouter } from "./routes/diagnostics";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    }),
  );
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(healthRouter);
  app.use("/api", exitStrategiesRouter);
  app.use("/api", webhooksRouter);
  app.use(diagnosticsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
