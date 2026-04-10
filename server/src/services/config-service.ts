import { loadTmpoConfig, saveTmpoConfig, type TmpoConfig } from "../config";

export interface ConfigResponse {
  github_token: string | null;
  default_repo: string;
  max_iterations: number;
  log_level: string;
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

export interface ConfigServiceDeps {
  loadConfig: () => TmpoConfig;
  saveConfig: (cfg: TmpoConfig) => void;
}

const defaultDeps: ConfigServiceDeps = {
  loadConfig: loadTmpoConfig,
  saveConfig: saveTmpoConfig,
};

export function createConfigService(deps: ConfigServiceDeps = defaultDeps) {
  return {
    get(): ConfigResponse {
      const cfg = deps.loadConfig();
      return {
        github_token: cfg.github_token ? maskToken(cfg.github_token) : null,
        default_repo: cfg.default_repo,
        max_iterations: cfg.max_iterations,
        log_level: cfg.log_level,
      };
    },

    update(updates: Partial<Pick<TmpoConfig, "github_token" | "default_repo" | "max_iterations" | "log_level">>): ConfigResponse {
      const cfg = deps.loadConfig();
      if (updates.github_token !== undefined) cfg.github_token = updates.github_token;
      if (updates.default_repo !== undefined) cfg.default_repo = updates.default_repo;
      if (updates.max_iterations !== undefined) cfg.max_iterations = updates.max_iterations;
      if (updates.log_level !== undefined) cfg.log_level = updates.log_level;
      deps.saveConfig(cfg);
      return {
        github_token: cfg.github_token ? maskToken(cfg.github_token) : null,
        default_repo: cfg.default_repo,
        max_iterations: cfg.max_iterations,
        log_level: cfg.log_level,
      };
    },

    getDecryptedToken(): string {
      const cfg = deps.loadConfig();
      if (!cfg.github_token) {
        throw new Error("GitHub token not configured");
      }
      return cfg.github_token;
    },

    hasGithubToken(): boolean {
      const cfg = deps.loadConfig();
      return !!cfg.github_token;
    },
  };
}

export const configService = createConfigService();
