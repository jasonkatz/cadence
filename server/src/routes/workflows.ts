import { Router, Request, Response } from "express";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const router = Router();

function workflowsDir(): string {
  // Mirrors CadenceConfig::workflows_dir() in Rust:
  //   dirs::config_dir() -> ~/Library/Application Support on macOS, ~/.config on Linux
  const home = os.homedir();
  const configBase =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : path.join(home, ".config");
  return path.join(configBase, "cadence", "workflows");
}

interface WorkflowState {
  id: string;
  task: string;
  stage: string;
  iteration: number;
  max_iters: number;
  pr_number: number | null;
  branch: string;
  repo: string;
  started_at: string;
  updated_at: string;
  error: string | null;
}

async function readWorkflowFiles(): Promise<WorkflowState[]> {
  const dir = workflowsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const workflows: WorkflowState[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), "utf8");
      workflows.push(JSON.parse(content) as WorkflowState);
    } catch {
      // Skip malformed files
    }
  }
  return workflows;
}

const TERMINAL_STAGES = new Set(["complete", "failed", "cancelled"]);

// GET /v1/workflows/active — returns the most recently updated non-terminal workflow
router.get("/workflows/active", async (_req: Request, res: Response) => {
  const all = await readWorkflowFiles();
  const active = all
    .filter((w) => !TERMINAL_STAGES.has(w.stage))
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

  if (active.length === 0) {
    res.status(404).json({ error: "No active workflow" });
    return;
  }

  res.json(active[0]);
});

// GET /v1/workflows/:id — returns a specific workflow by id
router.get("/workflows/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const filePath = path.join(workflowsDir(), `${id}.json`);
  try {
    const content = await fs.readFile(filePath, "utf8");
    res.json(JSON.parse(content));
  } catch {
    res.status(404).json({ error: "Workflow not found" });
  }
});

// GET /v1/workflows/:id/events — SSE stream that emits stage updates as the
// workflow state file changes (polls every 2 seconds).
router.get("/workflows/:id/events", async (req: Request, res: Response) => {
  const { id } = req.params;
  const filePath = path.join(workflowsDir(), `${id}.json`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let lastState: string | null = null;

  const sendState = async () => {
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (content !== lastState) {
        lastState = content;
        res.write(`data: ${content}\n\n`);
      }
    } catch {
      // File not yet present — keep polling
    }
  };

  // Send initial state immediately
  await sendState();

  const interval = setInterval(sendState, 2000);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

export default router;
