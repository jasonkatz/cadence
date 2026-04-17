import { query, type QueryFn } from "../db";

export interface Run {
  id: string;
  step_id: string;
  workflow_id: string;
  agent_role: string;
  iteration: number;
  log_path: string | null;
  exit_code: number | null;
  duration_secs: number | null;
  created_at: Date;
}

export function createRunDao(q: QueryFn) {
  return {
  async findById(runId: string): Promise<Run | null> {
    const result = await q<Run>(`SELECT * FROM runs WHERE id = ?`, [runId]);
    return result.rows[0] ? parseNumericFields(result.rows[0]) : null;
  },

  async findByWorkflowId(
    workflowId: string,
    filters?: { agentRole?: string; iteration?: number }
  ): Promise<Run[]> {
    const conditions = ["workflow_id = ?"];
    const values: unknown[] = [workflowId];

    if (filters?.agentRole) {
      conditions.push("agent_role = ?");
      values.push(filters.agentRole);
    }

    if (filters?.iteration !== undefined) {
      conditions.push("iteration = ?");
      values.push(filters.iteration);
    }

    const where = conditions.join(" AND ");
    const result = await q<Run>(
      `SELECT * FROM runs WHERE ${where} ORDER BY created_at ASC`,
      values
    );
    return result.rows.map(parseNumericFields);
  },

  async create(data: {
    stepId: string;
    workflowId: string;
    agentRole: string;
    iteration: number;
    logPath: string;
  }): Promise<Run> {
    const result = await q<Run>(
      `INSERT INTO runs (step_id, workflow_id, agent_role, iteration, log_path)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
      [data.stepId, data.workflowId, data.agentRole, data.iteration, data.logPath]
    );
    return parseNumericFields(result.rows[0]);
  },

  async updateResult(
    runId: string,
    data: { exitCode: number; durationSecs: number }
  ): Promise<Run | null> {
    const result = await q<Run>(
      `UPDATE runs SET exit_code = ?, duration_secs = ?
       WHERE id = ? RETURNING *`,
      [data.exitCode, data.durationSecs, runId]
    );
    return result.rows[0] ? parseNumericFields(result.rows[0]) : null;
  },
  };
}

function parseNumericFields(run: Run): Run {
  return {
    ...run,
    duration_secs: run.duration_secs != null ? Number(run.duration_secs) : null,
  };
}

export const runDao = createRunDao(query);
