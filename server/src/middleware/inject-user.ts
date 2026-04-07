import { Request, Response, NextFunction } from "express";
import { query } from "../db";
import { logger } from "../utils/logger";

interface DefaultUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: DefaultUser;
    }
  }
}

let defaultUser: DefaultUser | null = null;

export async function ensureDefaultUser(): Promise<void> {
  // Use the first existing user, or create a default one
  const existing = await query<DefaultUser>(
    "SELECT id, email, name FROM users ORDER BY created_at ASC LIMIT 1"
  );

  if (existing.rows[0]) {
    defaultUser = existing.rows[0];
  } else {
    const inserted = await query<DefaultUser>(
      `INSERT INTO users (email, name)
       VALUES ('default@localhost', 'Default User')
       RETURNING id, email, name`,
      []
    );
    defaultUser = inserted.rows[0];
  }

  logger.info("Default user ready", { userId: defaultUser.id });
}

export function injectUser(req: Request, _res: Response, next: NextFunction) {
  req.user = defaultUser!;
  next();
}
