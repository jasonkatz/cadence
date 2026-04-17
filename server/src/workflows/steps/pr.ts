import type { CreatePrStepInput, CreatePrStepResult } from "../types";
import { getStepDeps } from "./deps";

export async function createPrStep(
  input: CreatePrStepInput
): Promise<CreatePrStepResult> {
  "use step";

  const deps = getStepDeps();
  const token = deps.getDecryptedToken();

  const { title, body } = await deps.generatePrDescription(input.task, input.proposal);
  const pr = await deps.createPullRequest({
    token,
    repo: input.repo,
    head: input.branch,
    title,
    body,
  });
  return { number: pr.number, url: pr.url };
}

export interface PostCommentInput {
  repo: string;
  prNumber: number;
  body: string;
}

export async function postCommentStep(input: PostCommentInput): Promise<void> {
  "use step";

  const deps = getStepDeps();
  const token = deps.getDecryptedToken();
  try {
    await deps.postPrComment({
      token,
      repo: input.repo,
      prNumber: input.prNumber,
      body: input.body,
    });
  } catch {
    // PR comment posting is advisory — don't fail the workflow on a 403 etc.
  }
}
