import { Router } from "express";
import { workflowService } from "../services/workflow-service";

const router = Router();

router.post("/workflows", async (req, res, next) => {
  try {
    const workflow = await workflowService.create(req.body);
    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
});

router.get("/workflows", async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const result = await workflowService.list({
      status,
      limit,
      offset,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/workflows/:id", async (req, res, next) => {
  try {
    const workflow = await workflowService.getById(req.params.id);
    res.json(workflow);
  } catch (err) {
    next(err);
  }
});

router.get("/workflows/:id/steps", async (req, res, next) => {
  try {
    const iteration = req.query.iteration
      ? parseInt(req.query.iteration as string, 10)
      : undefined;

    const steps = await workflowService.getSteps(
      req.params.id,
      { iteration }
    );
    res.json(steps);
  } catch (err) {
    next(err);
  }
});

router.get("/workflows/:id/runs", async (req, res, next) => {
  try {
    const agentRole = req.query.agent_role as string | undefined;
    const iteration = req.query.iteration
      ? parseInt(req.query.iteration as string, 10)
      : undefined;

    const runs = await workflowService.getRuns(
      req.params.id,
      { agentRole, iteration }
    );
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

router.post("/workflows/:id/cancel", async (req, res, next) => {
  try {
    const workflow = await workflowService.cancel(req.params.id);
    res.json(workflow);
  } catch (err) {
    next(err);
  }
});

export default router;
