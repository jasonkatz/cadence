import { query } from "../db";

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

export const stepDao = {
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
    const result = await query<Step>(
      `SELECT * FROM steps WHERE ${where} ORDER BY iteration ASC, type ASC`,
      values
    );
    return result.rows;
  },

  async findLatestIterationByWorkflowId(
    workflowId: string
  ): Promise<Step[]> {
    const result = await query<Step>(
      `SELECT * FROM steps WHERE workflow_id = $1
       AND iteration = (SELECT MAX(iteration) FROM steps WHERE workflow_id = $1)
       ORDER BY type ASC`,
      [workflowId]
    );
    return result.rows;
  },
};
