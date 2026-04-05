import { describe, it, expect } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "cadence/abc123",
    requirements: null,
    proposal: "## Summary\nAdd a login page with email/password form.",
    pr_number: null,
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

import { buildDevPrompt } from "./dev-agent";

describe("dev-agent", () => {
  describe("buildDevPrompt", () => {
    it("should include the task description", () => {
      const wf = makeWorkflow({ task: "implement OAuth flow" });
      const prompt = buildDevPrompt(wf);

      expect(prompt).toContain("implement OAuth flow");
    });

    it("should include the proposal", () => {
      const wf = makeWorkflow({ proposal: "## Summary\nDo the thing." });
      const prompt = buildDevPrompt(wf);

      expect(prompt).toContain("## Summary\nDo the thing.");
    });

    it("should include the repo and branch", () => {
      const wf = makeWorkflow({ repo: "foo/bar", branch: "cadence/xyz" });
      const prompt = buildDevPrompt(wf);

      expect(prompt).toContain("foo/bar");
      expect(prompt).toContain("cadence/xyz");
    });

    it("should instruct the agent to commit and push", () => {
      const wf = makeWorkflow();
      const prompt = buildDevPrompt(wf);

      expect(prompt).toContain("commit");
      expect(prompt).toContain("push");
    });

    it("should instruct agent to work on the correct branch", () => {
      const wf = makeWorkflow({ branch: "cadence/my-feature" });
      const prompt = buildDevPrompt(wf);

      expect(prompt).toContain("cadence/my-feature");
    });

    it("should include requirements file when provided", () => {
      const wf = makeWorkflow({ requirements: "docs/spec.md" });
      const prompt = buildDevPrompt(wf);

      expect(prompt).toContain("docs/spec.md");
    });

    it("should not mention requirements when not provided", () => {
      const wf = makeWorkflow({ requirements: null });
      const prompt = buildDevPrompt(wf);

      expect(prompt).not.toContain("Requirements file");
    });
  });
});
