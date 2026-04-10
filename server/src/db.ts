import { Database } from "bun:sqlite";
import os from "os";
import path from "path";
import { mkdirSync } from "fs";

const TMPO_DIR = path.join(os.homedir(), ".tmpo");
const DB_PATH = path.join(TMPO_DIR, "tmpo.db");

export type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) => Promise<{ rows: T[] }>;

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    mkdirSync(TMPO_DIR, { recursive: true });
    mkdirSync(path.join(TMPO_DIR, "runs"), { recursive: true });
    db = new Database(DB_PATH);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      task TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      requirements TEXT,
      proposal TEXT,
      pr_number INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      iteration INTEGER NOT NULL DEFAULT 0,
      max_iters INTEGER NOT NULL DEFAULT 8,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      iteration INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      detail TEXT
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      step_id TEXT NOT NULL REFERENCES steps(id),
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      agent_role TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      log_path TEXT,
      exit_code INTEGER,
      duration_secs REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[] }> {
  const database = getDb();
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith("SELECT") || sql.toUpperCase().includes("RETURNING")) {
    const stmt = database.prepare(sql);
    const rows = (params ? stmt.all(...params) : stmt.all()) as T[];
    return { rows };
  } else {
    const stmt = database.prepare(sql);
    if (params) {
      stmt.run(...params);
    } else {
      stmt.run();
    }
    return { rows: [] as T[] };
  }
}

export function getDatabase(): Database {
  return getDb();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** For testing: initialize with a custom in-memory or temp database */
export function initTestDb(): Database {
  if (db) db.close();
  db = new Database(":memory:");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  initSchema(db);
  return db;
}
