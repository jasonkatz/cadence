import { Workflow } from "../dao/workflow-dao";
import { logger } from "../utils/logger";
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export interface E2eVerifierResult {
  e2ePass: boolean;
  verdict: string;
  exitCode: number;
  durationSecs: number;
  response: string;
}

const E2E_VERIFY_TIMEOUT_MS = 300_000; // 5 minutes

export async function runE2eVerifier(
  workflow: Workflow,
  evidence: string,
  githubToken: string
): Promise<E2eVerifierResult> {
  const startTime = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "cadence-e2e-verify-"));

  try {
    // Clone the repo (read-only context)
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${workflow.repo}.git`;
    await execCommand("git", ["clone", "-b", workflow.branch, "--depth", "1", cloneUrl, workDir], {
      timeoutMs: 60_000,
    });

    const prompt = buildE2eVerifierPrompt(workflow, evidence);

    // Run verifier with read-only tools
    const result = await execCommand(
      "claude",
      ["-p", prompt, "--allowedTools", "Read,Glob,Grep,Bash(cat:head:tail:ls:find:wc)"],
      {
        cwd: workDir,
        timeoutMs: E2E_VERIFY_TIMEOUT_MS,
      }
    );

    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const { e2ePass, verdict } = parseE2eVerdict(result.stdout);

    return {
      e2ePass,
      verdict,
      exitCode: result.exitCode,
      durationSecs,
      response: result.stdout,
    };
  } catch (error) {
    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("E2E verifier failed", {
      workflowId: workflow.id,
      error: message,
    });

    return {
      e2ePass: false,
      verdict: JSON.stringify({ e2e_pass: false, issues: [message] }),
      exitCode: 1,
      durationSecs,
      response: message,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildE2eVerifierPrompt(workflow: Workflow, evidence: string): string {
  const parts = [
    `You are an E2E verification agent. Your job is to evaluate the E2E test evidence below against the proposal's acceptance criteria and determine whether the implementation passes end-to-end verification.`,
    ``,
    `**Task:** ${workflow.task}`,
    `**Repository:** ${workflow.repo}`,
    `**Branch:** ${workflow.branch}`,
    ``,
    `## Proposal`,
    ``,
    workflow.proposal || "(No proposal provided)",
    ``,
    `## E2E Test Evidence`,
    ``,
    evidence,
    ``,
    `## Instructions`,
    ``,
    `1. Read the acceptance criteria from the proposal carefully.`,
    `2. Evaluate each criterion against the E2E evidence provided.`,
    `3. For each criterion, determine if the evidence demonstrates it was met.`,
    `4. Identify any missing evidence — criteria that were not tested or not demonstrated.`,
    `5. You may use the read-only tools to explore the repository for additional context.`,
    ``,
    `## Output Format`,
    ``,
    `First, write a brief human-readable summary of your verification findings.`,
    ``,
    `Then, as the LAST code block in your response, output a JSON verdict in exactly this format:`,
    ``,
    '```json',
    `{"e2e_pass": true, "criteria_results": [{"criterion": "...", "pass": true, "evidence": "..."}]}`,
    '```',
    ``,
    `Or if verification fails:`,
    ``,
    '```json',
    `{"e2e_pass": false, "criteria_results": [{"criterion": "...", "pass": false, "reason": "..."}], "missing_evidence": ["..."]}`,
    '```',
  ];

  return parts.join("\n");
}

export function parseE2eVerdict(response: string): { e2ePass: boolean; verdict: string } {
  // Try to find JSON verdict — look for last JSON code block
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
        e2ePass: parsed.e2e_pass === true,
        verdict: lastMatch,
      };
    } catch {
      // Fall through to default
    }
  }

  // Try bare JSON
  const bareJsonRegex = /\{"e2e_pass"\s*:\s*(true|false)[^}]*\}/;
  const bareMatch = bareJsonRegex.exec(response);
  if (bareMatch) {
    try {
      const parsed = JSON.parse(bareMatch[0]);
      return {
        e2ePass: parsed.e2e_pass === true,
        verdict: bareMatch[0],
      };
    } catch {
      // Fall through
    }
  }

  // Default to fail
  return {
    e2ePass: false,
    verdict: JSON.stringify({ e2e_pass: false, issues: ["Could not parse E2E verdict"] }),
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
