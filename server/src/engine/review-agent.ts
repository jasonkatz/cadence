import { Workflow } from "../dao/workflow-dao";
import { logger } from "../utils/logger";
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { RunLogger } from "../utils/run-logger";
import { runStreamingClaude } from "./streaming-claude";

export interface ReviewResult {
  reviewPass: boolean;
  verdict: string;
  exitCode: number;
  durationSecs: number;
  response: string;
}

const REVIEW_TIMEOUT_MS = 1_800_000; // 30 minutes

export async function runReviewAgent(
  workflow: Workflow,
  diff: string,
  githubToken: string,
  runLogger?: RunLogger
): Promise<ReviewResult> {
  const startTime = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "tmpo-review-"));

  try {
    // Clone the repo (read-only)
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${workflow.repo}.git`;
    await execCommand("git", ["clone", "--depth", "1", cloneUrl, workDir], {
      timeoutMs: 60_000,
    });

    const prompt = buildReviewPrompt(workflow, diff);

    const result = await runStreamingClaude({
      prompt,
      allowedTools: "Read,Glob,Grep,Bash(git log:git diff:git show:ls:find:wc:cat:head:tail)",
      cwd: workDir,
      timeoutMs: REVIEW_TIMEOUT_MS,
      runLogger,
    });

    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const { reviewPass, verdict } = parseVerdict(result.resultText);

    return {
      reviewPass,
      verdict,
      exitCode: result.exitCode,
      durationSecs,
      response: result.resultText,
    };
  } catch (error) {
    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Review agent failed", {
      workflowId: workflow.id,
      error: message,
    });

    return {
      reviewPass: false,
      verdict: JSON.stringify({ review_pass: false, issues: [message] }),
      exitCode: 1,
      durationSecs,
      response: message,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildReviewPrompt(workflow: Workflow, diff: string): string {
  const parts = [
    `You are a code review agent. Your job is to review the PR diff below against the proposal's acceptance criteria and determine if it passes review.`,
    ``,
    `**Task:** ${workflow.task}`,
    `**Repository:** ${workflow.repo}`,
    `**Branch:** ${workflow.branch}`,
    ``,
    `## Proposal`,
    ``,
    workflow.proposal || "(No proposal provided)",
    ``,
    `## PR Diff`,
    ``,
    "```diff",
    diff,
    "```",
    ``,
    `## Instructions`,
    ``,
    `1. Read the diff carefully.`,
    `2. Evaluate whether the changes satisfy the acceptance criteria from the proposal.`,
    `3. Check for bugs, security issues, and code quality problems.`,
    `4. You may use the read-only tools to explore the repository for additional context.`,
    ``,
    `## Output Format`,
    ``,
    `First, write a brief human-readable review summary (2-4 sentences). Cover what you checked, whether the acceptance criteria are met, and any notable observations about code quality. This summary will be posted as a comment on the PR, so write it for a human audience.`,
    ``,
    `Then, as the LAST code block in your response, output a JSON verdict in exactly this format:`,
    ``,
    '```json',
    `{"review_pass": true}`,
    '```',
    ``,
    `Or if the review fails:`,
    ``,
    '```json',
    `{"review_pass": false, "blocking_issues": ["issue 1", "issue 2"], "unmet_criteria": ["criterion 1"]}`,
    '```',
  ];

  return parts.join("\n");
}

function parseVerdict(response: string): { reviewPass: boolean; verdict: string } {
  // Try to find JSON verdict in the response — look for last JSON code block
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g;
  let lastMatch: string | null = null;

  let match;
  while ((match = jsonBlockRegex.exec(response)) !== null) {
    lastMatch = match[1].trim();
  }

  if (lastMatch) {
    try {
      const parsed = JSON.parse(lastMatch);
      return {
        reviewPass: parsed.review_pass === true,
        verdict: lastMatch,
      };
    } catch {
      // Fall through to default
    }
  }

  // Try to find bare JSON in the response
  const bareJsonRegex = /\{"review_pass"\s*:\s*(true|false)[^}]*\}/;
  const bareMatch = bareJsonRegex.exec(response);
  if (bareMatch) {
    try {
      const parsed = JSON.parse(bareMatch[0]);
      return {
        reviewPass: parsed.review_pass === true,
        verdict: bareMatch[0],
      };
    } catch {
      // Fall through
    }
  }

  // Default to fail if no verdict found
  return {
    reviewPass: false,
    verdict: JSON.stringify({ review_pass: false, issues: ["Could not parse reviewer verdict"] }),
  };
}

function execCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let _stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      _stderr += data.toString();
    });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error(`Command timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
