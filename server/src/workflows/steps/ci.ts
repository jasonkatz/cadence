import type { CiStepInput, CiStepResult } from "../types";
import { getStepDeps } from "./deps";

export async function ciStep(input: CiStepInput): Promise<CiStepResult> {
  "use step";

  const deps = getStepDeps();
  const token = deps.getDecryptedToken();

  let headSha: string;
  try {
    headSha = await deps.getHeadSha(token, input.repo, input.branch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: `Failed to fetch head SHA (${message})`,
    };
  }

  const result = await deps.pollCiStatus(input.repo, headSha, token);
  return {
    ok: result.status === "passed",
    detail: result.detail,
  };
}
