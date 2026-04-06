import { describe, it, expect } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "tmpo/abc123",
    requirements: null,
    proposal: null,
    pr_number: null,
    status: "pending",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_by: "user-1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// We test the exported buildPlannerPrompt utility
// Need to make it exported for testability
const { buildPlannerPrompt } = await import("./planner-agent");

describe("planner-agent", () => {
  describe("buildPlannerPrompt", () => {
    it("should include the task and repo", () => {
      const wf = makeWorkflow({ task: "implement auth", repo: "foo/bar" });
      const prompt = buildPlannerPrompt(wf);

      expect(prompt).toContain("implement auth");
      expect(prompt).toContain("foo/bar");
    });

    it("should include requirements file when provided", () => {
      const wf = makeWorkflow({ requirements: "docs/spec.md" });
      const prompt = buildPlannerPrompt(wf);

      expect(prompt).toContain("docs/spec.md");
      expect(prompt).toContain("requirements");
    });

    it("should not mention requirements when not provided", () => {
      const wf = makeWorkflow({ requirements: null });
      const prompt = buildPlannerPrompt(wf);

      expect(prompt).not.toContain("Requirements file");
    });

    it("should request Summary, Acceptance Criteria, and Technical Considerations sections", () => {
      const wf = makeWorkflow();
      const prompt = buildPlannerPrompt(wf);

      expect(prompt).toContain("Summary");
      expect(prompt).toContain("Acceptance Criteria");
      expect(prompt).toContain("Technical Considerations");
    });

    it("should instruct the agent to write the proposal to PROPOSAL.md", () => {
      const wf = makeWorkflow();
      const prompt = buildPlannerPrompt(wf);

      expect(prompt).toContain("PROPOSAL.md");
    });
  });
});
