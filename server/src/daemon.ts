import http from "http";
import path from "path";
import os from "os";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, statSync } from "fs";
import express from "express";
import { createApp } from "./app";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/error-handler";
import { createEngine } from "./engine/workflow-engine";
import { setEngineFunctions } from "./services/workflow-service";
import { closeDatabase } from "./db";
import { recoverInterruptedWorkflows } from "./recovery";
import { createDaemonRoutes } from "./routes/daemon";

// Handle --version flag before anything else
if (process.argv.includes("--version")) {
  const pkgPath = path.join(import.meta.dir, "..", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    console.log(`tmpod ${pkg.version}`);
  } catch {
    console.log("tmpod (unknown version)");
  }
  process.exit(0);
}

const TMPO_DIR = path.join(os.homedir(), ".tmpo");
const SOCKET_PATH = path.join(TMPO_DIR, "tmpod.sock");
const PID_PATH = path.join(TMPO_DIR, "tmpod.pid");
const PUBLIC_DIR = path.join(import.meta.dir, "..", "public");

// --- PID file management ---

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupStaleFiles(): void {
  if (existsSync(PID_PATH)) {
    try {
      const pidStr = readFileSync(PID_PATH, "utf-8").trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && isProcessAlive(pid)) {
        logger.error(`Daemon already running with PID ${pid}`);
        process.exit(1);
      }
      logger.info(`Cleaning up stale PID file (PID ${pidStr} is dead)`);
    } catch {
      logger.info("Cleaning up unreadable PID file");
    }
    try { unlinkSync(PID_PATH); } catch { /* best-effort cleanup */ }
  }
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch { /* best-effort cleanup */ }
  }
}

function writePidFile(): void {
  writeFileSync(PID_PATH, String(process.pid), "utf-8");
}

function removePidFile(): void {
  try { unlinkSync(PID_PATH); } catch { /* best-effort cleanup */ }
}

function removeSocket(): void {
  try { unlinkSync(SOCKET_PATH); } catch { /* best-effort cleanup */ }
}

// --- Daemon state ---

interface DaemonState {
  startedAt: Date;
  tcpServer: http.Server | null;
  tcpPort: number | null;
}

const state: DaemonState = {
  startedAt: new Date(),
  tcpServer: null,
  tcpPort: null,
};

// --- Main ---

async function main(): Promise<void> {
  mkdirSync(TMPO_DIR, { recursive: true });
  cleanupStaleFiles();

  const app = createApp();

  // Create engine
  const engine = createEngine();
  setEngineFunctions({
    enqueueWorkflow: engine.enqueueWorkflow.bind(engine),
    cancelWorkflowJobs: engine.cancelWorkflowJobs.bind(engine),
  });

  // Daemon control routes
  const daemonRouter = createDaemonRoutes({
    getState: () => ({
      pid: process.pid,
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
      socketPath: SOCKET_PATH,
      tcpPort: state.tcpPort,
      activeWorkflows: engine.jobQueue.activeCount(),
    }),
    enableTcp: (port: number) => enableTcp(app, port),
    shutdown: () => gracefulShutdown(engine, socketServer),
  });
  app.use("/v1", daemonRouter);

  // Static web UI serving (for TCP listener)
  await mountWebUi(app);

  // 404 for unmatched routes
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(errorHandler);

  // --- Unix socket listener (always on) ---
  const socketServer = http.createServer(app);
  socketServer.listen(SOCKET_PATH, async () => {
    writePidFile();
    logger.info(`Daemon listening on ${SOCKET_PATH} (PID ${process.pid})`);

    // Recover interrupted workflows then start engine
    await recoverInterruptedWorkflows(engine.deps);
    await engine.start();
  });

  // --- Graceful shutdown ---
  const handleSignal = (signal: string) => {
    logger.info(`Received ${signal}`);
    gracefulShutdown(engine, socketServer);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

async function mountWebUi(app: express.Express): Promise<void> {
  // Try the embedded manifest first (compiled binary). The dynamic import is
  // wrapped in try/catch so dev mode works without running the generator.
  let embedded: Record<string, string> = {};
  try {
    const mod = await import("./generated/embedded-public");
    embedded = mod.embeddedFiles ?? {};
  } catch {
    // No embedded module — dev mode will use the filesystem fallback below.
  }

  const hasEmbedded = Object.keys(embedded).length > 0;
  const hasFilesystem = !hasEmbedded && existsSync(PUBLIC_DIR);

  if (!hasEmbedded && !hasFilesystem) {
    logger.warn("No web UI assets available; tmpo ui will 404");
    return;
  }

  // Build a URL → on-disk-path map for either source.
  const fileMap = new Map<string, string>();
  if (hasEmbedded) {
    for (const [url, p] of Object.entries(embedded)) fileMap.set(url, p);
  } else {
    const walk = (dir: string, base: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) walk(full, base);
        else if (s.isFile()) {
          const url = "/" + path.relative(base, full).split(path.sep).join("/");
          fileMap.set(url, full);
        }
      }
    };
    walk(PUBLIC_DIR, PUBLIC_DIR);
  }

  const indexPath = fileMap.get("/index.html");

  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/v1/") || req.path.startsWith("/health") || req.path.startsWith("/docs")) {
      return next();
    }

    const key = req.path === "/" ? "/index.html" : req.path;
    const direct = fileMap.get(key);

    if (direct) {
      res.type(path.extname(key) || ".html");
      res.send(Buffer.from(await Bun.file(direct).arrayBuffer()));
      return;
    }

    // SPA fallback: extensionless paths get index.html so client-side routing works.
    if (!path.extname(req.path) && indexPath) {
      res.type("html");
      res.send(Buffer.from(await Bun.file(indexPath).arrayBuffer()));
      return;
    }

    next();
  });

  logger.info(`Web UI mounted (${hasEmbedded ? "embedded" : "filesystem"}, ${fileMap.size} files)`);
}

function enableTcp(app: express.Express, port: number): { success: boolean; error?: string } {
  if (state.tcpServer) {
    if (state.tcpPort === port) {
      return { success: true };
    }
    return { success: false, error: `TCP already active on port ${state.tcpPort}` };
  }

  const tcpServer = http.createServer(app);
  tcpServer.listen(port, "127.0.0.1", () => {
    logger.info(`TCP listener active on http://127.0.0.1:${port}`);
  });

  tcpServer.on("error", (err) => {
    logger.error(`TCP listener error: ${err.message}`);
  });

  state.tcpServer = tcpServer;
  state.tcpPort = port;

  return { success: true };
}

let isShuttingDown = false;

async function gracefulShutdown(
  engine: ReturnType<typeof createEngine>,
  socketServer: http.Server
): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Graceful shutdown initiated");

  // Stop accepting new jobs, wait for active ones (with timeout)
  await engine.stop();

  const SHUTDOWN_TIMEOUT = 30_000;
  const waitForActive = new Promise<void>((resolve) => {
    const check = () => {
      if (engine.jobQueue.activeCount() === 0) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn("Shutdown timeout reached (30s), some jobs may still be running");
      resolve();
    }, SHUTDOWN_TIMEOUT);
  });

  await Promise.race([waitForActive, timeout]);

  // Close TCP listener if active
  if (state.tcpServer) {
    await new Promise<void>((resolve) => {
      state.tcpServer!.close(() => resolve());
    });
    logger.info("TCP listener closed");
  }

  // Close Unix socket listener
  await new Promise<void>((resolve) => {
    socketServer.close(() => resolve());
  });
  logger.info("Unix socket listener closed");

  // Cleanup files
  removeSocket();
  removePidFile();

  // Close database
  closeDatabase();

  logger.info("Daemon stopped cleanly");
  process.exit(0);
}

main().catch((err) => {
  logger.error("Daemon startup failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
