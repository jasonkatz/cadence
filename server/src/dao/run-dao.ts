import { query } from "../db";

export interface Run {
  id: string;
  step_id: string;
  workflow_id: string;
  agent_role: string;
  iteration: number;
  prompt: string;
  response: string | null;
  exit_code: number | null;
  duration_secs: number | null;
  created_at: Date;
}

export const runDao = {
  async findByWorkflowId(
    workflowId: string,
    filters?: { agentRole?: string; iteration?: number }
  ): Promise<Run[]> {
    const conditions = ["workflow_id = $1"];
    const values: unknown[] = [workflowId];
    let paramIndex = 2;

    if (filters?.agentRole) {
      conditions.push(`agent_role = $${paramIndex++}`);
      values.push(filters.agentRole);
    }

    if (filters?.iteration !== undefined) {
      conditions.push(`iteration = $${paramIndex++}`);
      values.push(filters.iteration);
    }

    const where = conditions.join(" AND ");
    const result = await query<Run>(
      `SELECT * FROM runs WHERE ${where} ORDER BY created_at ASC`,
      values
    );
    return result.rows;
  },
};
