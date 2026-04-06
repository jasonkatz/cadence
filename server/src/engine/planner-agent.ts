import { Workflow } from "../dao/workflow-dao";
import { logger } from "../utils/logger";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const PROPOSAL_FILENAME = "PROPOSAL.md";

export interface PlannerResult {
  proposal: string | null;
  exitCode: number;
  durationSecs: number;
  response: string;
}

const PLANNER_TIMEOUT_MS = 300_000; // 5 minutes

export async function runPlannerAgent(
  workflow: Workflow,
  githubToken: string
): Promise<PlannerResult> {
  const startTime = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "tmpo-planner-"));

  try {
    // Clone the repo
    const cloneUrl = `https://x-access-token:${githubToken}@github.com/${workflow.repo}.git`;
    await execCommand("git", ["clone", "--depth", "1", cloneUrl, workDir], {
      timeoutMs: 60_000,
    });

    // Build the planner prompt
    const prompt = buildPlannerPrompt(workflow);

    // Run the agent using claude CLI
    const result = await execCommand(
      "claude",
      ["-p", prompt, "--allowedTools", "Read,Write,Glob,Grep,Bash(git log:git diff:git show:ls:find:wc)"],
      {
        cwd: workDir,
        timeoutMs: PLANNER_TIMEOUT_MS,
      }
    );

    // Read the proposal from the file the agent wrote
    const proposalPath = join(workDir, PROPOSAL_FILENAME);
    const proposal = await readProposalFile(proposalPath);
    const durationSecs = Math.round((Date.now() - startTime) / 1000);

    return {
      proposal,
      exitCode: result.exitCode,
      durationSecs,
      response: result.stdout,
    };
  } catch (error) {
    const durationSecs = Math.round((Date.now() - startTime) / 1000);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Planner agent failed", { workflowId: workflow.id, error: message });

    return {
      proposal: null,
      exitCode: 1,
      durationSecs,
      response: message,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildPlannerPrompt(workflow: Workflow): string {
  const parts = [
    `You are a software planning agent. Your job is to analyze the repository and create a structured proposal for the following task:`,
    ``,
    `**Task:** ${workflow.task}`,
    `**Repository:** ${workflow.repo}`,
    `**Branch:** ${workflow.branch}`,
  ];

  if (workflow.requirements) {
    parts.push(`**Requirements file:** ${workflow.requirements}`);
    parts.push(`Read the requirements file first.`);
  }

  parts.push(
    ``,
    `Explore the repository structure, understand the codebase, and produce a proposal with exactly these sections:`,
    ``,
    `## Summary`,
    `A concise description of what needs to be done and the approach.`,
    ``,
    `## Acceptance Criteria`,
    `Specific, testable criteria that define when the task is complete.`,
    ``,
    `## Technical Considerations`,
    `Architecture decisions, risks, dependencies, and implementation notes.`,
    ``,
    `Write the final proposal to a file called ${PROPOSAL_FILENAME} in the working directory. The file should contain ONLY the proposal content — no preamble, no explanation, just the proposal starting with ## Summary.`,
  );

  return parts.join("\n");
}

async function readProposalFile(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf-8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
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
