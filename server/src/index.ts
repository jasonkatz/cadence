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
import workflowRoutes from "./routes/workflows";
import achievementRoutes from "./routes/achievements";

const app = express();

app.use(corsMiddleware);
app.use(express.json());
app.use(requestLogger);

// Public routes
app.use(healthRoutes);
app.use(docsRoutes);

// EventSource cannot send custom headers, so SSE clients pass their JWT as
// ?token=<jwt>.  Promote it to the Authorization header here — before
// requireAuth runs — so the standard bearer-token validator sees it.
app.use("/v1/workflows", (req, _res, next) => {
  if (
    req.path.endsWith("/events") &&
    typeof req.query.token === "string" &&
    !req.headers.authorization
  ) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

// Authenticated routes
const authenticatedRouter = express.Router();
authenticatedRouter.use(requireAuth);
authenticatedRouter.use(extractUser);
authenticatedRouter.use(rateLimiter);
authenticatedRouter.use(authRoutes);
authenticatedRouter.use(workflowRoutes);
authenticatedRouter.use(achievementRoutes);

app.use("/v1", authenticatedRouter);

// 404 for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

const port = parseInt(config.PORT, 10);

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});

export default app;
