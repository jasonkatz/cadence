import { describe, it, expect, afterEach } from "bun:test";
import { loadTmpoConfig, saveTmpoConfig } from "./index";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";

const TMPO_DIR = path.join(os.homedir(), ".tmpo");
const CONFIG_PATH = path.join(TMPO_DIR, "config.toml");

// Save and restore the original config
let originalConfig: string | null = null;

function backupConfig() {
  if (existsSync(CONFIG_PATH)) {
    const { readFileSync } = require("fs");
    originalConfig = readFileSync(CONFIG_PATH, "utf-8");
  } else {
    originalConfig = null;
  }
}

function restoreConfig() {
  if (originalConfig !== null) {
    writeFileSync(CONFIG_PATH, originalConfig, "utf-8");
  } else if (existsSync(CONFIG_PATH)) {
    rmSync(CONFIG_PATH);
  }
}

describe("config", () => {
  afterEach(() => {
    // Clean up: restore any modified config
  });

  it("should load config with defaults when file exists", () => {
    backupConfig();
    try {
      mkdirSync(TMPO_DIR, { recursive: true });
      writeFileSync(
        CONFIG_PATH,
        `github_token = "ghp_test123"\ndefault_repo = "acme/app"\nmax_iterations = 5\nlog_level = "debug"\n`,
        "utf-8"
      );

      const cfg = loadTmpoConfig();
      expect(cfg.github_token).toBe("ghp_test123");
      expect(cfg.default_repo).toBe("acme/app");
      expect(cfg.max_iterations).toBe(5);
      expect(cfg.log_level).toBe("debug");
    } finally {
      restoreConfig();
    }
  });

  it("should create config with defaults when file is missing", () => {
    backupConfig();
    try {
      if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);

      const cfg = loadTmpoConfig();
      expect(cfg.github_token).toBe("");
      expect(cfg.default_repo).toBe("");
      expect(cfg.max_iterations).toBe(8);
      expect(cfg.log_level).toBe("info");
      expect(existsSync(CONFIG_PATH)).toBe(true);
    } finally {
      restoreConfig();
    }
  });

  it("should save and reload config", () => {
    backupConfig();
    try {
      saveTmpoConfig({
        github_token: "ghp_saved",
        default_repo: "org/repo",
        max_iterations: 3,
        log_level: "warn",
      });

      const cfg = loadTmpoConfig();
      expect(cfg.github_token).toBe("ghp_saved");
      expect(cfg.default_repo).toBe("org/repo");
      expect(cfg.max_iterations).toBe(3);
      expect(cfg.log_level).toBe("warn");
    } finally {
      restoreConfig();
    }
  });
});
