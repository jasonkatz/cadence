import { describe, it, expect } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import { buildReviewPrompt } from "./review-agent";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "tmpo/abc123",
    requirements: null,
    proposal: "## Summary\nAdd a login page with email/password form.\n\n## Acceptance Criteria\n- Login form renders\n- Form validates email",
    pr_number: 42,
    status: "running",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_by: "user-1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("review-agent", () => {
  describe("buildReviewPrompt", () => {
    it("should include the task description", () => {
      const wf = makeWorkflow({ task: "implement OAuth flow" });
      const prompt = buildReviewPrompt(wf, "diff content here");

      expect(prompt).toContain("implement OAuth flow");
    });

    it("should include the proposal", () => {
      const wf = makeWorkflow({ proposal: "## Summary\nDo the thing." });
      const prompt = buildReviewPrompt(wf, "diff content");

      expect(prompt).toContain("## Summary\nDo the thing.");
    });

    it("should include the PR diff", () => {
      const diff = "+function login() {\n+  return true;\n+}";
      const wf = makeWorkflow();
      const prompt = buildReviewPrompt(wf, diff);

      expect(prompt).toContain(diff);
    });

    it("should instruct the agent to output structured JSON verdict", () => {
      const wf = makeWorkflow();
      const prompt = buildReviewPrompt(wf, "diff");

      expect(prompt).toContain("review_pass");
      expect(prompt).toContain("JSON");
    });

    it("should include acceptance criteria context", () => {
      const wf = makeWorkflow();
      const prompt = buildReviewPrompt(wf, "diff");

      expect(prompt).toContain("acceptance criteria");
    });

    it("should include the repo name", () => {
      const wf = makeWorkflow({ repo: "foo/bar" });
      const prompt = buildReviewPrompt(wf, "diff");

      expect(prompt).toContain("foo/bar");
    });

    it("should handle null proposal gracefully", () => {
      const wf = makeWorkflow({ proposal: null });
      const prompt = buildReviewPrompt(wf, "diff");

      expect(prompt).toContain("No proposal provided");
    });
  });
});
