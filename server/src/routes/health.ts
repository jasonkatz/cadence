// Health check route - Phase 4 verified
import { Router } from "express";
import { pool } from "../db";
import type { components } from "../types/api";

type HealthResponse = components["schemas"]["HealthResponse"];

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
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
