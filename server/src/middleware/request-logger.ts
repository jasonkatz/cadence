import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const skipLogging = ["/health", "/api-docs", "/schema.yaml", "/v1/uptime"];
  if (skipLogging.includes(req.path)) {
    return next();
  }

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode}`, {
      requestId,
      duration: `${duration}ms`,
      userId: req.user?.id,
    });
  });

  next();
}
