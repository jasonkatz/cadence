import http from "http";
import path from "path";
import os from "os";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import express from "express";
import { createApp } from "./app";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/error-handler";
import { createEngine } from "./engine/workflow-engine";
import { setEngineFunctions } from "./services/workflow-service";
import { closeDatabase } from "./db";
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

  // Create engine (async because the WDK Local World is initialized here).
  const engine = await createEngine();
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
      activeWorkflows: engine.activeCount(),
    }),
    enableTcp: (port: number) => enableTcp(app, port),
    shutdown: () => gracefulShutdown(engine, socketServer),
  });
  app.use("/v1", daemonRouter);

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

    // The engine start sequence: reap any orphan claude subprocesses from the
    // previous lifecycle, then let the WDK runtime re-enqueue active runs so
    // they resume from the last completed step.
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
  engine: Awaited<ReturnType<typeof createEngine>>,
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
      if (engine.activeCount() === 0) {
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
