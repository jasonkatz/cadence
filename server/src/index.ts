import { createApp } from "./app";
import { config } from "./config";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/error-handler";
import { createEngine } from "./engine/workflow-engine";
import { setEngineFunctions } from "./services/workflow-service";
import { closeDatabase } from "./db";

const app = createApp();

// 404 for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

const port = parseInt(config.PORT, 10);

const engine = await createEngine();
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
    closeDatabase();
    logger.info("Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
