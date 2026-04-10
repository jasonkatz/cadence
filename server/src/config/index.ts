import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import * as TOML from "smol-toml";

const TMPO_DIR = path.join(os.homedir(), ".tmpo");
const CONFIG_PATH = path.join(TMPO_DIR, "config.toml");

export interface TmpoConfig {
  github_token: string;
  default_repo: string;
  max_iterations: number;
  log_level: string;
}

const DEFAULT_CONFIG: TmpoConfig = {
  github_token: "",
  default_repo: "",
  max_iterations: 8,
  log_level: "info",
};

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadTmpoConfig(): TmpoConfig {
  mkdirSync(TMPO_DIR, { recursive: true });

  if (!existsSync(CONFIG_PATH)) {
    const content = serializeConfig(DEFAULT_CONFIG);
    writeFileSync(CONFIG_PATH, content, "utf-8");
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = TOML.parse(raw) as Record<string, unknown>;

  return {
    github_token: typeof parsed.github_token === "string" ? parsed.github_token : DEFAULT_CONFIG.github_token,
    default_repo: typeof parsed.default_repo === "string" ? parsed.default_repo : DEFAULT_CONFIG.default_repo,
    max_iterations: typeof parsed.max_iterations === "number" ? parsed.max_iterations : DEFAULT_CONFIG.max_iterations,
    log_level: typeof parsed.log_level === "string" ? parsed.log_level : DEFAULT_CONFIG.log_level,
  };
}

export function saveTmpoConfig(cfg: TmpoConfig): void {
  mkdirSync(TMPO_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, serializeConfig(cfg), "utf-8");
}

function serializeConfig(cfg: TmpoConfig): string {
  return `github_token = ${JSON.stringify(cfg.github_token)}
default_repo = ${JSON.stringify(cfg.default_repo)}
max_iterations = ${cfg.max_iterations}
log_level = ${JSON.stringify(cfg.log_level)}
`;
}

// Environment-only config (PORT, NODE_ENV)
const envSchema = z.object({
  PORT: z.string().default("8080"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ALLOWED_ORIGINS: z.string().optional(),
  BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
