import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", issues: err.issues });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: "request_error", message: err.message });
    return;
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
}
