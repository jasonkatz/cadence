import { query, type QueryFn } from "../db";

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

export function createRunDao(q: QueryFn) {
  return {
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
    const result = await q<Run>(
      `SELECT * FROM runs WHERE ${where} ORDER BY created_at ASC`,
      values
    );
    return result.rows;
  },

  async create(data: {
    stepId: string;
    workflowId: string;
    agentRole: string;
    iteration: number;
    prompt: string;
  }): Promise<Run> {
    const result = await q<Run>(
      `INSERT INTO runs (step_id, workflow_id, agent_role, iteration, prompt)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.stepId, data.workflowId, data.agentRole, data.iteration, data.prompt]
    );
    return result.rows[0];
  },

  async updateResult(
    runId: string,
    data: { response: string; exitCode: number; durationSecs: number }
  ): Promise<Run | null> {
    const result = await q<Run>(
      `UPDATE runs SET response = $1, exit_code = $2, duration_secs = $3
       WHERE id = $4 RETURNING *`,
      [data.response, data.exitCode, data.durationSecs, runId]
    );
    return result.rows[0] || null;
  },
  };
}

export const runDao = createRunDao(query);
