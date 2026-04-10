import express from "express";
import { corsMiddleware } from "./middleware/cors";
import { requestLogger } from "./middleware/request-logger";
import { rateLimiter } from "./middleware/rate-limiter";
import healthRoutes from "./routes/health";
import docsRoutes from "./routes/docs";
import settingsRoutes from "./routes/settings";
import workflowRoutes from "./routes/workflows";
import eventsRoutes from "./routes/events";

export function createApp(): express.Express {
  const app = express();

  app.use(corsMiddleware);
  app.use(express.json());
  app.use(requestLogger);

  // Public routes
  app.use(healthRoutes);
  app.use(docsRoutes);

  // API routes
  const apiRouter = express.Router();
  apiRouter.use(rateLimiter);
  apiRouter.use(settingsRoutes);
  apiRouter.use(workflowRoutes);
  apiRouter.use(eventsRoutes);

  app.use("/v1", apiRouter);

  return app;
}
