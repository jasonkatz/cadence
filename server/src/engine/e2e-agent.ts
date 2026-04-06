import { Workflow } from "../dao/workflow-dao";
import { logger } from "../utils/logger";
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export interface E2eResult {
  e2ePass: boolean;
  evidence: string;
  exitCode: number;
  durationSecs: number;
  response: string;
}

const E2E_TIMEOUT_MS = 600_000; // 10 minutes

export async function runE2eAgent(
  workflow: Workflow,
  githubToken: string
): Promise<E2eResult> {
  const startTime = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "cadence-e2e-"));

  try {
    // Clone the repo at the working branch
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${workflow.repo}.git`;
    await execCommand("git", ["clone", "-b", workflow.branch, "--depth", "1", cloneUrl, workDir], {
      timeoutMs: 120_000,
    });

    const prompt = buildE2ePrompt(workflow);

    // Run the E2E agent with read-write tools (needs Bash for build/start/test commands)
    const result = await execCommand(
      "claude",
      ["-p", prompt, "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash"],
      {
        cwd: workDir,
        timeoutMs: E2E_TIMEOUT_MS,
      }
    );

    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const e2ePass = result.exitCode === 0;

    return {
      e2ePass,
      evidence: result.stdout,
      exitCode: result.exitCode,
      durationSecs,
      response: result.stdout,
    };
  } catch (error) {
    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("E2E agent failed", {
      workflowId: workflow.id,
      error: message,
    });

    return {
      e2ePass: false,
      evidence: "",
      exitCode: 1,
      durationSecs,
      response: message,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildE2ePrompt(workflow: Workflow): string {
  const parts = [
    `You are an end-to-end testing agent. Your job is to exercise the implementation by running real user journeys and capturing evidence. You do NOT judge pass/fail — a separate verifier will evaluate your evidence.`,
    ``,
    `**Task:** ${workflow.task}`,
    `**Repository:** ${workflow.repo}`,
    `**Branch:** ${workflow.branch}`,
    ``,
    `## Proposal`,
    ``,
    workflow.proposal || "(No proposal provided)",
    ``,
    `## Instructions`,
    ``,
    `1. Read and understand the codebase and the acceptance criteria from the proposal above.`,
    `2. Set up the local environment: install dependencies, build, and start the application.`,
    `3. Run real user journeys that exercise each acceptance criterion.`,
    `4. Use \`uvx rodney\` for browser automation if the project has a web UI.`,
    ``,
    `## Evidence Capture (required)`,
    ``,
    `You MUST use \`uvx showboat\` to build a structured evidence document. This is mandatory for every E2E run.`,
    ``,
    `1. \`uvx showboat init evidence.md "E2E Evidence: ${workflow.task}"\``,
    `2. For each acceptance criterion, use \`uvx showboat exec evidence.md <lang> '<code>'\` to run a test and capture its output.`,
    `3. Use \`uvx showboat note evidence.md '<commentary>'\` to describe what each test exercises.`,
    `4. If the project has a web UI, use \`uvx showboat image evidence.md <screenshot_path>\` to include screenshots.`,
    `5. When done, read evidence.md and output its full contents as the last thing in your response.`,
    ``,
    `The evidence document will be posted as a comment on the PR, so make it clear and readable.`,
    ``,
    `Do not assess whether criteria pass or fail. Just capture what happened. The verifier will make that judgment.`,
  ];

  return parts.join("\n");
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
