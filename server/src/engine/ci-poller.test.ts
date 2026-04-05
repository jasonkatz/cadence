import { describe, it, expect, mock } from "bun:test";
import type { CiPollerDeps } from "./ci-poller";
import { pollCiStatus, CI_TIMEOUT_MS } from "./ci-poller";

function makeDeps(overrides?: Partial<CiPollerDeps>): CiPollerDeps {
  return {
    getCheckRuns: mock(() =>
      Promise.resolve({
        total_count: 0,
        check_runs: [] as Array<{ name: string; status: string; conclusion: string | null; output: { summary: string | null } }>,
      })
    ),
    sleep: mock(() => Promise.resolve()),
    now: mock(() => Date.now()),
    ...overrides,
  };
}

describe("ci-poller", () => {
  describe("pollCiStatus", () => {
    it("should return passed when all check runs succeed", async () => {
      const deps = makeDeps({
        getCheckRuns: mock(() =>
          Promise.resolve({
            total_count: 2,
            check_runs: [
              { name: "build", status: "completed", conclusion: "success", output: { summary: null } },
              { name: "test", status: "completed", conclusion: "success", output: { summary: null } },
            ],
          })
        ),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("passed");
      expect(result.detail).toBeNull();
    });

    it("should return failed when any check run fails", async () => {
      const deps = makeDeps({
        getCheckRuns: mock(() =>
          Promise.resolve({
            total_count: 2,
            check_runs: [
              { name: "build", status: "completed", conclusion: "success", output: { summary: null } },
              { name: "test", status: "completed", conclusion: "failure", output: { summary: "2 tests failed" } },
            ],
          })
        ),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("failed");
      expect(result.detail).toContain("test");
    });

    it("should include failure summary in detail", async () => {
      const deps = makeDeps({
        getCheckRuns: mock(() =>
          Promise.resolve({
            total_count: 1,
            check_runs: [
              { name: "lint", status: "completed", conclusion: "failure", output: { summary: "ESLint found 3 errors" } },
            ],
          })
        ),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.detail).toContain("ESLint found 3 errors");
    });

    it("should poll again when checks are in_progress", async () => {
      let callCount = 0;
      const deps = makeDeps({
        getCheckRuns: mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              total_count: 1,
              check_runs: [
                { name: "build", status: "in_progress", conclusion: null, output: { summary: null } },
              ],
            });
          }
          return Promise.resolve({
            total_count: 1,
            check_runs: [
              { name: "build", status: "completed", conclusion: "success", output: { summary: null } },
            ],
          });
        }),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("passed");
      expect(deps.sleep).toHaveBeenCalled();
    });

    it("should poll again when checks are queued", async () => {
      let callCount = 0;
      const deps = makeDeps({
        getCheckRuns: mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              total_count: 1,
              check_runs: [
                { name: "build", status: "queued", conclusion: null, output: { summary: null } },
              ],
            });
          }
          return Promise.resolve({
            total_count: 1,
            check_runs: [
              { name: "build", status: "completed", conclusion: "success", output: { summary: null } },
            ],
          });
        }),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("passed");
    });

    it("should poll again when no check runs exist yet", async () => {
      let callCount = 0;
      const deps = makeDeps({
        getCheckRuns: mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ total_count: 0, check_runs: [] });
          }
          return Promise.resolve({
            total_count: 1,
            check_runs: [
              { name: "build", status: "completed", conclusion: "success", output: { summary: null } },
            ],
          });
        }),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("passed");
    });

    it("should return failed with timeout detail when timeout exceeded", async () => {
      let time = 0;
      const deps = makeDeps({
        getCheckRuns: mock(() =>
          Promise.resolve({
            total_count: 1,
            check_runs: [
              { name: "build", status: "in_progress", conclusion: null, output: { summary: null } },
            ],
          })
        ),
        now: mock(() => {
          time += CI_TIMEOUT_MS + 1;
          return time;
        }),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("failed");
      expect(result.detail).toContain("timeout");
    });

    it("should return failed when conclusion is cancelled", async () => {
      const deps = makeDeps({
        getCheckRuns: mock(() =>
          Promise.resolve({
            total_count: 1,
            check_runs: [
              { name: "build", status: "completed", conclusion: "cancelled", output: { summary: null } },
            ],
          })
        ),
      });

      const result = await pollCiStatus("acme/webapp", "abc123", "ghp_token", deps);

      expect(result.status).toBe("failed");
      expect(result.detail).toContain("build");
    });
  });
});
