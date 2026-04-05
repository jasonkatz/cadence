import { Router } from "express";
import type { components } from "../types/api";

type PingResponse = components["schemas"]["PingResponse"];

const router = Router();

router.get("/v1/ping", (_req, res) => {
  const response: PingResponse = { pong: true };
  res.json(response);
});

export default router;
