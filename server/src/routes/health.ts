import { Router } from "express";
import { getDatabase } from "../db";
import type { components } from "../types/api";

type HealthResponse = components["schemas"]["HealthResponse"];

const router = Router();

router.get("/health", (_req, res) => {
  try {
    const db = getDatabase();
    db.prepare("SELECT 1").get();
    const response: HealthResponse = {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
    res.json(response);
  } catch {
    const response: HealthResponse = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
    };
    res.status(503).json(response);
  }
});

export default router;
