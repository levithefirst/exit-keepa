import { Router } from "express";
import type { HealthResponse } from "@exit-keepa/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: "exit-keepa-api",
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});
