import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "fs";
import { logger } from "../utils/logger";

/**
 * Per-step record of an in-flight `claude` subprocess. Persisted to disk so
 * the reaper can find it across daemon restarts.
 */
export interface PidRecord {
  stepId: string;
  pid: number;
  startedAt: string;
}

export interface PidRegistry {
  record(stepId: string, pid: number): void;
  clear(stepId: string): void;
  list(): PidRecord[];
}

/**
 * Disk-backed registry. Each step gets its own file under `<dir>/<stepId>.json`
 * so concurrent writes don't conflict. The pid is persisted before spawn
 * completes so a daemon crash between `spawn` and `close` still leaves a
 * record the reaper can use on next startup.
 */
export function createDiskPidRegistry(dir?: string): PidRegistry {
  const registryDir = dir ?? path.join(os.homedir(), ".tmpo", "subprocess-pids");
  mkdirSync(registryDir, { recursive: true });
  return {
    record(stepId: string, pid: number) {
      const record: PidRecord = {
        stepId,
        pid,
        startedAt: new Date().toISOString(),
      };
      writeFileSync(
        path.join(registryDir, `${sanitize(stepId)}.json`),
        JSON.stringify(record),
        "utf-8"
      );
    },
    clear(stepId: string) {
      const file = path.join(registryDir, `${sanitize(stepId)}.json`);
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch {
          // best-effort; next reaper pass will notice the process is gone.
        }
      }
    },
    list() {
      if (!existsSync(registryDir)) return [];
      const files = readdirSync(registryDir).filter((f) => f.endsWith(".json"));
      const records: PidRecord[] = [];
      for (const file of files) {
        try {
          const raw = readFileSync(path.join(registryDir, file), "utf-8");
          records.push(JSON.parse(raw) as PidRecord);
        } catch {
          // Corrupt record — skip.
        }
      }
      return records;
    },
  };
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Re-exported so streaming-claude doesn't need to know about the registry shape.
export function recordProcess(registry: PidRegistry, stepId: string, pid: number): void {
  registry.record(stepId, pid);
}

export function clearProcess(registry: PidRegistry, stepId: string): void {
  registry.clear(stepId);
}

export interface ReapDeps {
  registry: PidRegistry;
  /**
   * Reads `/proc/<pid>/cmdline` (Linux) or falls back to `ps` equivalents.
   * Returns the raw argv joined by null or space; callers scan for the
   * sentinel. Undefined means the pid doesn't exist.
   */
  readCmdline?: (pid: number) => string | undefined;
  kill?: (pid: number, signal: NodeJS.Signals) => boolean;
  now?: () => number;
}

/**
 * Send SIGTERM to any surviving subprocess recorded in the registry whose
 * argv still contains the `--tmpo-step-id=<stepId>` sentinel. Matching on
 * both pid AND sentinel avoids killing unrelated processes if the OS has
 * recycled the pid between crashes.
 *
 * Runs before the workflow engine re-enqueues runs, so the replayed step
 * can't collide with the orphan.
 */
export async function reapOrphanSubprocesses(deps: ReapDeps): Promise<number> {
  const readCmdline = deps.readCmdline ?? defaultReadCmdline;
  const kill = deps.kill ?? defaultKill;

  const records = deps.registry.list();
  let reaped = 0;

  for (const record of records) {
    const cmdline = readCmdline(record.pid);
    if (cmdline === undefined) {
      // Process no longer exists; drop the stale record.
      deps.registry.clear(record.stepId);
      continue;
    }
    // Exact token match — avoids stepId prefix collisions (e.g. "step-1"
    // matching an unrelated "--tmpo-step-id=step-10" process). argv comes
    // in NUL-separated on Linux (/proc/<pid>/cmdline) and space-separated
    // from `ps -o command=` on macOS; split on both.
    const tokens = cmdline.split(/[\s\0]+/).filter((t) => t.length > 0);
    const sentinel = `--tmpo-step-id=${record.stepId}`;
    if (!tokens.includes(sentinel)) {
      // PID was recycled to an unrelated process. Leave it alone and drop
      // the record — the replayed step will record a fresh pid.
      deps.registry.clear(record.stepId);
      continue;
    }
    // Send SIGTERM to the whole process group the child was spawned in.
    const ok = kill(-record.pid, "SIGTERM");
    if (ok) {
      reaped++;
      logger.info(`Reaped orphan subprocess pid=${record.pid} stepId=${record.stepId}`);
    }
    deps.registry.clear(record.stepId);
  }

  if (reaped > 0) {
    logger.info(`Reaped ${reaped} orphan subprocess(es)`);
  }
  return reaped;
}

function defaultReadCmdline(pid: number): string | undefined {
  // Cheap existence check first.
  try {
    process.kill(pid, 0);
  } catch {
    return undefined;
  }
  // Linux: /proc/<pid>/cmdline is argv joined by NUL.
  const proc = path.join("/proc", String(pid), "cmdline");
  if (existsSync(proc)) {
    try {
      return readFileSync(proc, "utf-8");
    } catch {
      // fall through to ps fallback
    }
  }
  // macOS / BSD fallback: ps -p <pid> -o command= prints the full argv.
  try {
    const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
    });
    if (res.status === 0 && typeof res.stdout === "string") {
      return res.stdout;
    }
  } catch {
    // ps missing — unusual, skip.
  }
  return undefined;
}

function defaultKill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
