import { query } from "../db";

export interface UserSettings {
  id: string;
  user_id: string;
  github_token_encrypted: string | null;
  github_token_iv: string | null;
  github_token_tag: string | null;
  created_at: Date;
  updated_at: Date;
}

export const settingsDao = {
  async findByUserId(userId: string): Promise<UserSettings | null> {
    const result = await query<UserSettings>(
      "SELECT * FROM user_settings WHERE user_id = $1",
      [userId]
    );
    return result.rows[0] || null;
  },

  async upsert(
    userId: string,
    data: {
      encrypted: string;
      iv: string;
      tag: string;
    }
  ): Promise<UserSettings> {
    const result = await query<UserSettings>(
      `INSERT INTO user_settings (user_id, github_token_encrypted, github_token_iv, github_token_tag, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         github_token_encrypted = $2,
         github_token_iv = $3,
         github_token_tag = $4,
         updated_at = now()
       RETURNING *`,
      [userId, data.encrypted, data.iv, data.tag]
    );
    return result.rows[0];
  },
};
