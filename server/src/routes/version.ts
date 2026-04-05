import { Router } from "express";
import type { components } from "../types/api";

type VersionResponse = components["schemas"]["VersionResponse"];

const router = Router();

router.get("/", (_req, res) => {
  const response: VersionResponse = {
    version: "0.4.0",
  };
  res.json(response);
});

export default router;
