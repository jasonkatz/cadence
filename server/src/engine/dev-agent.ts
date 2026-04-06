import { Workflow } from "../dao/workflow-dao";
import { logger } from "../utils/logger";
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export interface DevResult {
  exitCode: number;
  durationSecs: number;
  response: string;
}

const DEV_TIMEOUT_MS = 600_000; // 10 minutes

export async function runDevAgent(
  workflow: Workflow,
  githubToken: string
): Promise<DevResult> {
  const startTime = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "cadence-dev-"));

  try {
    // Clone the repo
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${workflow.repo}.git`;
    await execCommand("git", ["clone", cloneUrl, workDir], {
      timeoutMs: 120_000,
    });

    // Create and checkout the working branch
    await execCommand("git", ["checkout", "-b", workflow.branch], {
      cwd: workDir,
      timeoutMs: 10_000,
    });

    // Configure git for commits
    await execCommand("git", ["config", "user.email", "cadence@bot.dev"], {
      cwd: workDir,
      timeoutMs: 5_000,
    });
    await execCommand("git", ["config", "user.name", "Cadence Bot"], {
      cwd: workDir,
      timeoutMs: 5_000,
    });

    // Build the dev prompt
    const prompt = buildDevPrompt(workflow);

    // Run the agent using claude CLI
    const result = await execCommand(
      "claude",
      ["-p", prompt, "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash"],
      {
        cwd: workDir,
        timeoutMs: DEV_TIMEOUT_MS,
      }
    );

    // Stage all changes, commit, and push
    await execCommand("git", ["add", "-A"], {
      cwd: workDir,
      timeoutMs: 10_000,
    });

    const commitResult = await execCommand(
      "git",
      ["commit", "-m", `cadence: ${workflow.task.substring(0, 60)}`],
      {
        cwd: workDir,
        timeoutMs: 10_000,
      }
    );
    if (commitResult.exitCode !== 0) {
      throw new Error(`git commit failed (exit ${commitResult.exitCode}): ${commitResult.stderr || commitResult.stdout}`);
    }

    // Set up push URL with token and push
    const pushUrl = `https://x-access-token:${githubToken}@github.com/${workflow.repo}.git`;
    const pushResult = await execCommand("git", ["push", pushUrl, workflow.branch], {
      cwd: workDir,
      timeoutMs: 60_000,
    });
    if (pushResult.exitCode !== 0) {
      throw new Error(`git push failed (exit ${pushResult.exitCode}): ${pushResult.stderr || pushResult.stdout}`);
    }

    const durationSecs = Math.round((Date.now() - startTime) / 1000);

    return {
      exitCode: result.exitCode,
      durationSecs,
      response: result.stdout,
    };
  } catch (error) {
    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Dev agent failed", {
      workflowId: workflow.id,
      error: message,
    });

    return {
      exitCode: 1,
      durationSecs,
      response: message,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildDevPrompt(workflow: Workflow): string {
  const parts = [
    `You are a software development agent. Your job is to implement the following task according to the proposal below.`,
    ``,
    `**Task:** ${workflow.task}`,
    `**Repository:** ${workflow.repo}`,
    `**Branch:** ${workflow.branch}`,
  ];

  if (workflow.requirements) {
    parts.push(`**Requirements file:** ${workflow.requirements}`);
    parts.push(`Read the requirements file first for detailed specifications.`);
  }

  parts.push(
    ``,
    `## Proposal`,
    ``,
    workflow.proposal || "(No proposal provided)",
    ``,
    `## Instructions`,
    ``,
    `1. Read and understand the codebase structure.`,
    `2. Implement the changes described in the proposal above.`,
    `3. Write clean, well-structured code that follows the existing patterns in the repository.`,
    `4. Ensure all changes are saved to disk.`,
    ``,
    `After you are done, the system will automatically commit your changes and push them to the branch \`${workflow.branch}\`. Do not run git commands yourself.`
  );

  return parts.join("\n");
}

function execCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error(`Command timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
