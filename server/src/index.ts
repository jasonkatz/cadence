import express from "express";
import { config } from "./config";
import { logger } from "./utils/logger";
import { corsMiddleware } from "./middleware/cors";
import { requestLogger } from "./middleware/request-logger";
import { requireAuth } from "./middleware/require-auth";
import { extractUser } from "./middleware/extract-user";
import { rateLimiter } from "./middleware/rate-limiter";
import { errorHandler } from "./middleware/error-handler";
import healthRoutes from "./routes/health";
import docsRoutes from "./routes/docs";
import authRoutes from "./routes/auth";
import settingsRoutes from "./routes/settings";
import workflowRoutes from "./routes/workflows";
import eventsRoutes from "./routes/events";
import { createEngine } from "./engine/workflow-engine";
import { setEngineFunctions } from "./services/workflow-service";

const app = express();

app.use(corsMiddleware);
app.use(express.json());
app.use(requestLogger);

// Public routes
app.use(healthRoutes);
app.use(docsRoutes);

// Authenticated routes
const authenticatedRouter = express.Router();
authenticatedRouter.use(requireAuth);
authenticatedRouter.use(extractUser);
authenticatedRouter.use(rateLimiter);
authenticatedRouter.use(authRoutes);
authenticatedRouter.use(settingsRoutes);
authenticatedRouter.use(workflowRoutes);
authenticatedRouter.use(eventsRoutes);

app.use("/v1", authenticatedRouter);

// 404 for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

const port = parseInt(config.PORT, 10);

const engine = createEngine(config.DATABASE_URL);
setEngineFunctions({
  enqueueWorkflow: engine.enqueueWorkflow.bind(engine),
  cancelWorkflowJobs: engine.cancelWorkflowJobs.bind(engine),
});

const server = app.listen(port, async () => {
  logger.info(`Server running on port ${port}`);
  await engine.start();
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  await engine.stop();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
