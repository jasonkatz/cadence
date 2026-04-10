import { describe, it, expect } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import { buildE2ePrompt } from "./e2e-agent";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "tmpo/abc123",
    requirements: null,
    proposal:
      "## Summary\nAdd a login page with email/password form.\n\n## Acceptance Criteria\n- Login form renders\n- Form validates email",
    pr_number: 42,
    status: "running",
    iteration: 0,
    max_iters: 8,
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("e2e-agent", () => {
  describe("buildE2ePrompt", () => {
    it("should include the task description", () => {
      const wf = makeWorkflow({ task: "implement OAuth flow" });
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("implement OAuth flow");
    });

    it("should include the proposal", () => {
      const wf = makeWorkflow({ proposal: "## Summary\nDo the thing." });
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("## Summary\nDo the thing.");
    });

    it("should include the repo and branch", () => {
      const wf = makeWorkflow({ repo: "foo/bar", branch: "tmpo/xyz" });
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("foo/bar");
      expect(prompt).toContain("tmpo/xyz");
    });

    it("should instruct the agent to run user journeys without judging pass/fail", () => {
      const wf = makeWorkflow();
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("user journey");
      expect(prompt).toContain("do NOT judge pass/fail");
    });

    it("should require showboat for evidence capture", () => {
      const wf = makeWorkflow();
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("uvx showboat");
      expect(prompt).toContain("MUST");
      expect(prompt).toContain("showboat init");
      expect(prompt).toContain("showboat exec");
    });

    it("should reference rodney for browser automation", () => {
      const wf = makeWorkflow();
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("rodney");
    });

    it("should instruct outputting evidence.md contents", () => {
      const wf = makeWorkflow();
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("evidence.md");
      expect(prompt).toContain("posted as a comment");
    });

    it("should handle null proposal gracefully", () => {
      const wf = makeWorkflow({ proposal: null });
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("No proposal provided");
    });

    it("should include acceptance criteria context", () => {
      const wf = makeWorkflow();
      const prompt = buildE2ePrompt(wf);

      expect(prompt).toContain("acceptance criteria");
    });
  });
});
