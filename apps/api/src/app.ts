import express from "express";
// Patches express.Router so a rejected promise from an async handler (e.g.
// `throw new HttpError(...)` inside an `async (req, res) => {...}` route)
// reaches errorHandler instead of hanging the request forever - Express 4
// does not do this on its own. Must be imported before any router is
// defined.
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
import { authRouter } from "./routes/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  // "*" in CORS_ORIGINS means "allow any browser origin". Auth here is a
  // Bearer token a caller must read from its own storage and attach
  // explicitly - not a cookie the browser sends automatically - so an
  // allow-all origin policy doesn't let a third-party page ride a victim's
  // session the way cookie-based auth would (classic CSRF). Must be passed
  // to the `cors` package as `origin: true` (reflect the request's own
  // Origin), not as the literal array ["*"] - the package only treats "*"
  // specially when `origin` itself is the bare string "*", not an entry
  // inside an array, so ["*"] would silently allow nothing.
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
  app.use("/api", authRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
