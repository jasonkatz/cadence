import { query } from "../db";

export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: Date;
}

export const userDao = {
  async findById(id: string): Promise<User | null> {
    const result = await query<User>("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows[0] || null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const result = await query<User>("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    return result.rows[0] || null;
  },

  async create(data: {
    email: string;
    name?: string;
  }): Promise<User> {
    const result = await query<User>(
      `INSERT INTO users (email, name)
       VALUES ($1, $2)
       RETURNING *`,
      [data.email, data.name]
    );
    return result.rows[0];
  },

  async update(
    id: string,
    data: { email?: string; name?: string }
  ): Promise<User | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.email !== undefined) {
      fields.push(`email = $${paramIndex++}`);
      values.push(data.email);
    }
    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await query<User>(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },
};
