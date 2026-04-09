import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createConfigService, type ConfigServiceDeps } from "./config-service";
import type { TmpoConfig } from "../config";

function makeConfig(overrides?: Partial<TmpoConfig>): TmpoConfig {
  return {
    github_token: "",
    default_repo: "",
    max_iterations: 8,
    log_level: "info",
    ...overrides,
  };
}

function makeDeps() {
  let storedConfig = makeConfig();

  const mockLoadConfig = mock(() => ({ ...storedConfig }));
  const mockSaveConfig = mock((cfg: TmpoConfig) => {
    storedConfig = { ...cfg };
  });

  const deps: ConfigServiceDeps = {
    loadConfig: mockLoadConfig,
    saveConfig: mockSaveConfig,
  };

  return { deps, mocks: { loadConfig: mockLoadConfig, saveConfig: mockSaveConfig }, setConfig: (cfg: Partial<TmpoConfig>) => { storedConfig = makeConfig(cfg); } };
}

describe("configService", () => {
  let service: ReturnType<typeof createConfigService>;
  let helpers: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    helpers = makeDeps();
    service = createConfigService(helpers.deps);
  });

  describe("get", () => {
    it("should return null github_token when not configured", () => {
      const result = service.get();
      expect(result.github_token).toBeNull();
    });

    it("should return masked token when configured", () => {
      helpers.setConfig({ github_token: "ghp_testtoken1234" });
      const result = service.get();
      expect(result.github_token).not.toBeNull();
      expect(result.github_token).toContain("****");
      expect(result.github_token).not.toBe("ghp_testtoken1234");
    });

    it("should return other config values", () => {
      helpers.setConfig({
        default_repo: "acme/app",
        max_iterations: 5,
        log_level: "debug",
      });
      const result = service.get();
      expect(result.default_repo).toBe("acme/app");
      expect(result.max_iterations).toBe(5);
      expect(result.log_level).toBe("debug");
    });
  });

  describe("update", () => {
    it("should update github_token and return masked version", () => {
      const result = service.update({ github_token: "ghp_newtoken5678" });
      expect(result.github_token).toContain("****");
      expect(helpers.mocks.saveConfig).toHaveBeenCalledTimes(1);
    });

    it("should update partial config fields", () => {
      helpers.setConfig({ github_token: "ghp_existing" });
      const result = service.update({ max_iterations: 3 });
      expect(result.max_iterations).toBe(3);
    });
  });

  describe("getDecryptedToken", () => {
    it("should return the raw token", () => {
      helpers.setConfig({ github_token: "ghp_secrettoken99" });
      const result = service.getDecryptedToken();
      expect(result).toBe("ghp_secrettoken99");
    });

    it("should throw when no token is configured", () => {
      expect(() => service.getDecryptedToken()).toThrow("GitHub token not configured");
    });
  });

  describe("hasGithubToken", () => {
    it("should return false when no token is set", () => {
      expect(service.hasGithubToken()).toBe(false);
    });

    it("should return true when token is set", () => {
      helpers.setConfig({ github_token: "ghp_token123" });
      expect(service.hasGithubToken()).toBe(true);
    });
  });
});
