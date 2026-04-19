import { describe, it, expect, beforeEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import {
  reapOrphanSubprocesses,
  createDiskPidRegistry,
  type PidRegistry,
  type PidRecord,
} from "./subprocess-reaper";

function inMemoryRegistry(initial: PidRecord[] = []): PidRegistry & { _records: Map<string, PidRecord> } {
  const records = new Map<string, PidRecord>(initial.map((r) => [r.stepId, r]));
  return {
    record(stepId, pid) {
      records.set(stepId, { stepId, pid, startedAt: new Date().toISOString() });
    },
    clear(stepId) {
      records.delete(stepId);
    },
    list() {
      return Array.from(records.values());
    },
    _records: records,
  };
}

describe("reapOrphanSubprocesses", () => {
  it("sends SIGTERM to the process group when sentinel matches", async () => {
    const registry = inMemoryRegistry([{ stepId: "step-A", pid: 1234, startedAt: "2026-01-01" }]);
    const kill = mock((_pid: number, _sig: NodeJS.Signals) => true);
    const readCmdline = mock((pid: number) =>
      pid === 1234 ? "node --tmpo-step-id=step-A --other-flag" : undefined
    );

    const count = await reapOrphanSubprocesses({ registry, readCmdline, kill });

    expect(count).toBe(1);
    expect(kill).toHaveBeenCalledTimes(1);
    // Negative pid = process group.
    expect(kill).toHaveBeenCalledWith(-1234, "SIGTERM");
    expect(registry.list()).toEqual([]);
  });

  it("skips kill when the pid no longer exists and drops the record", async () => {
    const registry = inMemoryRegistry([{ stepId: "step-B", pid: 9999, startedAt: "2026-01-01" }]);
    const kill = mock((_pid: number, _sig: NodeJS.Signals) => true);
    const readCmdline = mock(() => undefined);

    const count = await reapOrphanSubprocesses({ registry, readCmdline, kill });

    expect(count).toBe(0);
    expect(kill).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([]);
  });

  it("skips kill when pid was recycled to an unrelated process (sentinel mismatch)", async () => {
    const registry = inMemoryRegistry([{ stepId: "step-C", pid: 1234, startedAt: "2026-01-01" }]);
    const kill = mock((_pid: number, _sig: NodeJS.Signals) => true);
    // Same pid alive, but argv doesn't contain the expected sentinel.
    const readCmdline = mock(() => "sshd: jason@pts/0");

    const count = await reapOrphanSubprocesses({ registry, readCmdline, kill });

    expect(count).toBe(0);
    expect(kill).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([]);
  });

  it("matches the step-id sentinel exactly, not by prefix", async () => {
    const registry = inMemoryRegistry([{ stepId: "step-1", pid: 1, startedAt: "2026-01-01" }]);
    const kill = mock((_pid: number, _sig: NodeJS.Signals) => true);
    // argv contains --tmpo-step-id=step-10 — a different step. Must not match.
    const readCmdline = mock(() => "node --tmpo-step-id=step-10");

    const count = await reapOrphanSubprocesses({ registry, readCmdline, kill });

    expect(count).toBe(0);
    expect(kill).not.toHaveBeenCalled();
  });

  it("handles multiple records independently", async () => {
    const registry = inMemoryRegistry([
      { stepId: "a", pid: 100, startedAt: "t" },
      { stepId: "b", pid: 200, startedAt: "t" },
      { stepId: "c", pid: 300, startedAt: "t" },
    ]);
    const kill = mock((_pid: number, _sig: NodeJS.Signals) => true);
    const readCmdline = mock((pid: number) => {
      if (pid === 100) return "node --tmpo-step-id=a";
      if (pid === 200) return undefined; // dead
      if (pid === 300) return "unrelated"; // recycled
      return undefined;
    });

    const count = await reapOrphanSubprocesses({ registry, readCmdline, kill });

    expect(count).toBe(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(-100, "SIGTERM");
    expect(registry.list()).toEqual([]);
  });

  it("clears the record even if kill returns false", async () => {
    const registry = inMemoryRegistry([{ stepId: "x", pid: 42, startedAt: "t" }]);
    const kill = mock((_pid: number, _sig: NodeJS.Signals) => false);
    const readCmdline = mock(() => "--tmpo-step-id=x");

    const count = await reapOrphanSubprocesses({ registry, readCmdline, kill });

    expect(count).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it("returns 0 when there are no records", async () => {
    const registry = inMemoryRegistry([]);
    const count = await reapOrphanSubprocesses({
      registry,
      readCmdline: mock(() => undefined),
      kill: mock(() => true),
    });
    expect(count).toBe(0);
  });
});

describe("createDiskPidRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tmpo-reaper-"));
  });

  it("record persists a file and list returns it", () => {
    const registry = createDiskPidRegistry(tmpDir);
    registry.record("step-1", 123);

    const records = registry.list();
    expect(records).toHaveLength(1);
    expect(records[0].stepId).toBe("step-1");
    expect(records[0].pid).toBe(123);
    expect(typeof records[0].startedAt).toBe("string");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("clear removes the file", () => {
    const registry = createDiskPidRegistry(tmpDir);
    registry.record("step-x", 1);
    expect(registry.list()).toHaveLength(1);
    registry.clear("step-x");
    expect(registry.list()).toEqual([]);
    expect(readdirSync(tmpDir)).toEqual([]);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sanitizes step ids with path-hostile characters", () => {
    const registry = createDiskPidRegistry(tmpDir);
    registry.record("step/../evil", 7);
    const files = readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
    expect(files[0]).not.toContain("..");
    expect(existsSync(path.join(tmpDir, files[0]))).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("list tolerates and skips corrupt records", () => {
    const registry = createDiskPidRegistry(tmpDir);
    registry.record("good", 5);
    // Drop a bogus file into the registry directory.
    writeFileSync(path.join(tmpDir, "corrupt.json"), "not json", "utf-8");

    const records = registry.list();
    expect(records).toHaveLength(1);
    expect(records[0].stepId).toBe("good");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("list returns [] when directory is empty", () => {
    const registry = createDiskPidRegistry(tmpDir);
    expect(registry.list()).toEqual([]);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips via reapOrphanSubprocesses using a disk-backed registry", async () => {
    const registry = createDiskPidRegistry(tmpDir);
    registry.record("step-42", 5555);

    const count = await reapOrphanSubprocesses({
      registry,
      readCmdline: () => "node --tmpo-step-id=step-42",
      kill: () => true,
    });

    expect(count).toBe(1);
    expect(registry.list()).toEqual([]);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
