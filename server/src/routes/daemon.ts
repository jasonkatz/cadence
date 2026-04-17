import { Router } from "express";

export interface DaemonStatus {
  pid: number;
  uptime: number;
  socketPath: string;
  tcpPort: number | null;
  activeWorkflows: number;
}

export interface DaemonRouteDeps {
  getState: () => Promise<DaemonStatus>;
  enableTcp: (port: number) => { success: boolean; error?: string };
  shutdown: () => void;
}

export function createDaemonRoutes(deps: DaemonRouteDeps): Router {
  const router = Router();

  router.get("/daemon/status", async (_req, res) => {
    const status = await deps.getState();
    res.json(status);
  });

  router.post("/daemon/stop", (_req, res) => {
    res.json({ ok: true, message: "Shutting down" });
    // Defer shutdown to after response is sent
    setImmediate(() => deps.shutdown());
  });

  router.post("/daemon/enable-tcp", (req, res) => {
    const port = req.body?.port;
    if (typeof port !== "number" || port < 1 || port > 65535) {
      res.status(400).json({ error: "Invalid port number" });
      return;
    }
    const result = deps.enableTcp(port);
    if (result.success) {
      res.json({ ok: true, port });
    } else {
      res.status(409).json({ error: result.error });
    }
  });

  return router;
}
