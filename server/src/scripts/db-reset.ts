import { pool } from "../db";

async function reset() {
  console.log("Dropping all tables...");
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
  console.log("Schema reset. Running migrations...");
  await pool.end();

  const proc = Bun.spawn(["bun", "node-pg-migrate", "up"], {
    cwd: import.meta.dir + "/../..",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const code = await proc.exited;
  process.exit(code);
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
