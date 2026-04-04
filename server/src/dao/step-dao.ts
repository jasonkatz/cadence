import { query, type QueryFn } from "../db";

export interface Step {
  id: string;
  workflow_id: string;
  iteration: number;
  type: string;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  detail: string | null;
}

export function createStepDao(q: QueryFn) {
  return {
  async findByWorkflowId(
    workflowId: string,
    filters?: { iteration?: number }
  ): Promise<Step[]> {
    const conditions = ["workflow_id = $1"];
    const values: unknown[] = [workflowId];
    let paramIndex = 2;

    if (filters?.iteration !== undefined) {
      conditions.push(`iteration = $${paramIndex++}`);
      values.push(filters.iteration);
    }

    const where = conditions.join(" AND ");
    const result = await q<Step>(
      `SELECT * FROM steps WHERE ${where} ORDER BY iteration ASC, type ASC`,
      values
    );
    return result.rows;
  },

  async findLatestIterationByWorkflowId(
    workflowId: string
  ): Promise<Step[]> {
    const result = await q<Step>(
      `SELECT * FROM steps WHERE workflow_id = $1
       AND iteration = (SELECT MAX(iteration) FROM steps WHERE workflow_id = $1)
       ORDER BY type ASC`,
      [workflowId]
    );
    return result.rows;
  },

  async createIterationSteps(
    workflowId: string,
    iteration: number
  ): Promise<Step[]> {
    const types = ["plan", "dev", "ci", "review", "e2e", "e2e_verify", "signoff"];
    const values = types
      .map(
        (_, i) =>
          `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
      )
      .join(", ");
    const params = types.flatMap((type) => [workflowId, iteration, type]);

    const result = await q<Step>(
      `INSERT INTO steps (workflow_id, iteration, type)
       VALUES ${values}
       RETURNING *`,
      params
    );
    return result.rows;
  },

  async updateStatus(
    stepId: string,
    status: string,
    detail?: string
  ): Promise<Step | null> {
    const setClauses = ["status = $1"];
    const params: unknown[] = [status];
    let idx = 2;

    if (status === "running") {
      setClauses.push(`started_at = now()`);
    }
    if (status === "passed" || status === "failed") {
      setClauses.push(`finished_at = now()`);
    }
    if (detail !== undefined) {
      setClauses.push(`detail = $${idx++}`);
      params.push(detail);
    }

    params.push(stepId);
    const result = await q<Step>(
      `UPDATE steps SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );
    return result.rows[0] || null;
  },
  };
}

export const stepDao = createStepDao(query);
