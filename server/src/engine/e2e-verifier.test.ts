import { describe, it, expect } from "bun:test";
import type { Workflow } from "../dao/workflow-dao";
import { buildE2eVerifierPrompt, parseE2eVerdict } from "./e2e-verifier";

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    task: "add login page",
    repo: "acme/webapp",
    branch: "cadence/abc123",
    requirements: null,
    proposal:
      "## Summary\nAdd a login page with email/password form.\n\n## Acceptance Criteria\n- Login form renders\n- Form validates email",
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

describe("e2e-verifier", () => {
  describe("buildE2eVerifierPrompt", () => {
    it("should include the task description", () => {
      const wf = makeWorkflow({ task: "implement OAuth flow" });
      const prompt = buildE2eVerifierPrompt(wf, "evidence text");

      expect(prompt).toContain("implement OAuth flow");
    });

    it("should include the proposal", () => {
      const wf = makeWorkflow({ proposal: "## Summary\nDo the thing." });
      const prompt = buildE2eVerifierPrompt(wf, "evidence");

      expect(prompt).toContain("## Summary\nDo the thing.");
    });

    it("should include the E2E evidence", () => {
      const evidence = "Login form rendered successfully. Screenshot captured.";
      const wf = makeWorkflow();
      const prompt = buildE2eVerifierPrompt(wf, evidence);

      expect(prompt).toContain(evidence);
    });

    it("should instruct structured JSON verdict output", () => {
      const wf = makeWorkflow();
      const prompt = buildE2eVerifierPrompt(wf, "evidence");

      expect(prompt).toContain("e2e_pass");
      expect(prompt).toContain("JSON");
    });

    it("should reference acceptance criteria evaluation", () => {
      const wf = makeWorkflow();
      const prompt = buildE2eVerifierPrompt(wf, "evidence");

      expect(prompt).toContain("acceptance criteria");
    });

    it("should handle null proposal gracefully", () => {
      const wf = makeWorkflow({ proposal: null });
      const prompt = buildE2eVerifierPrompt(wf, "evidence");

      expect(prompt).toContain("No proposal provided");
    });

    it("should instruct verifier to identify missing evidence", () => {
      const wf = makeWorkflow();
      const prompt = buildE2eVerifierPrompt(wf, "evidence");

      expect(prompt).toContain("missing");
    });
  });

  describe("parseE2eVerdict", () => {
    it("should parse e2e_pass true from JSON code block", () => {
      const response = `All criteria verified.\n\n\`\`\`json\n{"e2e_pass": true, "criteria_results": []}\n\`\`\``;
      const result = parseE2eVerdict(response);

      expect(result.e2ePass).toBe(true);
    });

    it("should parse e2e_pass false from JSON code block", () => {
      const response = `Missing evidence.\n\n\`\`\`json\n{"e2e_pass": false, "criteria_results": [{"criterion": "Login form renders", "pass": false}], "missing_evidence": ["screenshot"]}\n\`\`\``;
      const result = parseE2eVerdict(response);

      expect(result.e2ePass).toBe(false);
    });

    it("should return verdict string from JSON block", () => {
      const response = `Review.\n\n\`\`\`json\n{"e2e_pass": true}\n\`\`\``;
      const result = parseE2eVerdict(response);

      expect(result.verdict).toContain("e2e_pass");
    });

    it("should use last JSON block when multiple exist", () => {
      const response = `Some text\n\`\`\`json\n{"e2e_pass": false}\n\`\`\`\nMore text\n\`\`\`json\n{"e2e_pass": true}\n\`\`\``;
      const result = parseE2eVerdict(response);

      expect(result.e2ePass).toBe(true);
    });

    it("should parse bare JSON when no code block found", () => {
      const response = `The result is {"e2e_pass": true}`;
      const result = parseE2eVerdict(response);

      expect(result.e2ePass).toBe(true);
    });

    it("should default to fail when no verdict found", () => {
      const response = "No structured output here.";
      const result = parseE2eVerdict(response);

      expect(result.e2ePass).toBe(false);
    });
  });
});
