import { query } from "../db";

export interface Workflow {
  id: string;
  task: string;
  repo: string;
  branch: string;
  requirements: string | null;
  proposal: string | null;
  pr_number: number | null;
  status: string;
  iteration: number;
  max_iters: number;
  error: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowListParams {
  userId: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const workflowDao = {
  async create(data: {
    task: string;
    repo: string;
    branch: string;
    requirements?: string;
    maxIters?: number;
    createdBy: string;
  }): Promise<Workflow> {
    const result = await query<Workflow>(
      `INSERT INTO workflows (task, repo, branch, requirements, max_iters, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.task,
        data.repo,
        data.branch,
        data.requirements || null,
        data.maxIters ?? 8,
        data.createdBy,
      ]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<Workflow | null> {
    const result = await query<Workflow>(
      "SELECT * FROM workflows WHERE id = $1",
      [id]
    );
    return result.rows[0] || null;
  },

  async findByIdAndUser(
    id: string,
    userId: string
  ): Promise<Workflow | null> {
    const result = await query<Workflow>(
      "SELECT * FROM workflows WHERE id = $1 AND created_by = $2",
      [id, userId]
    );
    return result.rows[0] || null;
  },

  async list(params: WorkflowListParams): Promise<{ workflows: Workflow[]; total: number }> {
    const conditions = ["created_by = $1"];
    const values: unknown[] = [params.userId];
    let paramIndex = 2;

    if (params.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }

    const where = conditions.join(" AND ");

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) FROM workflows WHERE ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const limit = params.limit || 50;
    const offset = params.offset || 0;

    const result = await query<Workflow>(
      `SELECT * FROM workflows WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...values, limit, offset]
    );

    return { workflows: result.rows, total };
  },

  async updateStatus(
    id: string,
    status: string
  ): Promise<Workflow | null> {
    const result = await query<Workflow>(
      `UPDATE workflows SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  },

  async findPending(): Promise<Workflow | null> {
    const result = await query<Workflow>(
      `SELECT * FROM workflows WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
    );
    return result.rows[0] || null;
  },

  async updateProposal(
    id: string,
    proposal: string
  ): Promise<Workflow | null> {
    const result = await query<Workflow>(
      `UPDATE workflows SET proposal = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [proposal, id]
    );
    return result.rows[0] || null;
  },

  async updateError(
    id: string,
    error: string
  ): Promise<Workflow | null> {
    const result = await query<Workflow>(
      `UPDATE workflows SET status = 'failed', error = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [error, id]
    );
    return result.rows[0] || null;
  },

  async updateIteration(
    id: string,
    iteration: number
  ): Promise<Workflow | null> {
    const result = await query<Workflow>(
      `UPDATE workflows SET iteration = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [iteration, id]
    );
    return result.rows[0] || null;
  },
};
