import { Router } from "express";
import type { components } from "../types/api";

type UptimeResponse = components["schemas"]["UptimeResponse"];

const router = Router();

router.get("/uptime", (_req, res) => {
  const response: UptimeResponse = {
    uptime_secs: process.uptime(),
  };
  res.json(response);
});

export default router;
