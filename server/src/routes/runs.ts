import { Router } from "express";
import { workflowService } from "../services/workflow-service";

const router = Router();

router.get("/runs/:id/log", async (req, res, next) => {
  try {
    const log = await workflowService.getRunLog(req.params.id);
    res.type("application/x-ndjson");
    res.send(log);
  } catch (err) {
    next(err);
  }
});

export default router;
