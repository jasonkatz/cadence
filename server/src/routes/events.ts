import { Request, Response, NextFunction, Router } from "express";
import { workflowDao as defaultWorkflowDao } from "../dao/workflow-dao";
import { eventBus as defaultEventBus, WorkflowEvent } from "../events/event-bus";
import { NotFoundError } from "../middleware/error-handler";

export interface EventsHandlerDeps {
  workflowDao: Pick<typeof defaultWorkflowDao, "findByIdAndUser">;
  eventBus: Pick<typeof defaultEventBus, "subscribe" | "unsubscribe">;
}

const defaultDeps: EventsHandlerDeps = {
  workflowDao: defaultWorkflowDao,
  eventBus: defaultEventBus,
};

export function createEventsHandler(deps: EventsHandlerDeps = defaultDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflow = await deps.workflowDao.findByIdAndUser(
        req.params.id,
        req.user!.id
      );
      if (!workflow) {
        throw new NotFoundError("Workflow not found");
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send initial comment to establish connection
      res.write(":ok\n\n");
      if (typeof res.flush === "function") res.flush();

      // Subscribe to workflow events
      const handler = (event: WorkflowEvent) => {
        const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
        res.write(sseData);
        if (typeof res.flush === "function") res.flush();

        // Close connection on terminal events
        if (event.type === "workflow:completed") {
          deps.eventBus.unsubscribe(workflow.id, handler);
          res.end();
        }
      };

      deps.eventBus.subscribe(workflow.id, handler);

      // Clean up on client disconnect
      req.on("close", () => {
        deps.eventBus.unsubscribe(workflow.id, handler);
      });
    } catch (err) {
      next(err);
    }
  };
}

const router = Router();
router.get("/workflows/:id/events", createEventsHandler());
export default router;
