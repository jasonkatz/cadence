import { query, type QueryFn } from "../db";

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
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowListParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export function createWorkflowDao(q: QueryFn) {
  return {
  async create(data: {
    task: string;
    repo: string;
    branch: string;
    requirements?: string;
    maxIters?: number;
  }): Promise<Workflow> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = await q<Workflow>(
      `INSERT INTO workflows (id, task, repo, branch, requirements, max_iters, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        id,
        data.task,
        data.repo,
        data.branch,
        data.requirements || null,
        data.maxIters ?? 8,
        now,
        now,
      ]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<Workflow | null> {
    const result = await q<Workflow>(
      "SELECT * FROM workflows WHERE id = ?",
      [id]
    );
    return result.rows[0] || null;
  },

  async list(params: WorkflowListParams): Promise<{ workflows: Workflow[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.status) {
      conditions.push("status = ?");
      values.push(params.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await q<{ count: number }>(
      `SELECT COUNT(*) as count FROM workflows ${where}`,
      values
    );
    const total = Number(countResult.rows[0].count);

    const limit = params.limit || 50;
    const offset = params.offset || 0;

    const result = await q<Workflow>(
      `SELECT * FROM workflows ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    return { workflows: result.rows, total };
  },

  async updateStatus(
    id: string,
    status: string
  ): Promise<Workflow | null> {
    const result = await q<Workflow>(
      `UPDATE workflows SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  },

  async findPending(): Promise<Workflow | null> {
    const result = await q<Workflow>(
      `SELECT * FROM workflows WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
    );
    return result.rows[0] || null;
  },

  async updateProposal(
    id: string,
    proposal: string
  ): Promise<Workflow | null> {
    const result = await q<Workflow>(
      `UPDATE workflows SET proposal = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      [proposal, id]
    );
    return result.rows[0] || null;
  },

  async updateError(
    id: string,
    error: string
  ): Promise<Workflow | null> {
    const result = await q<Workflow>(
      `UPDATE workflows SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      [error, id]
    );
    return result.rows[0] || null;
  },

  async updateIteration(
    id: string,
    iteration: number
  ): Promise<Workflow | null> {
    const result = await q<Workflow>(
      `UPDATE workflows SET iteration = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      [iteration, id]
    );
    return result.rows[0] || null;
  },

  async updatePrNumber(
    id: string,
    prNumber: number
  ): Promise<Workflow | null> {
    const result = await q<Workflow>(
      `UPDATE workflows SET pr_number = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      [prNumber, id]
    );
    return result.rows[0] || null;
  },
  };
}

export const workflowDao = createWorkflowDao(query);
