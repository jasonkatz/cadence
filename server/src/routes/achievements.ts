import { Router, Request, Response } from "express";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const router = Router();

function achievementsPath(): string {
  // Mirrors AchievementStore::path() in Rust:
  //   parent of CadenceConfig::workflows_dir() / "achievements.json"
  const home = os.homedir();
  const configBase =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : path.join(home, ".config");
  return path.join(configBase, "cadence", "achievements.json");
}

interface Achievement {
  kind: string;
  earned_at: string;
  workflow_id: string;
}

interface AchievementStore {
  achievements: Achievement[];
  workflows_completed: number;
}

// GET /v1/achievements — returns the list of earned achievement IDs
router.get("/achievements", async (_req: Request, res: Response) => {
  const filePath = achievementsPath();
  try {
    const content = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(content) as AchievementStore;
    const earned = store.achievements.map((a) => a.kind);
    res.json({ earned, workflows_completed: store.workflows_completed });
  } catch {
    // File doesn't exist yet — no achievements earned
    res.json({ earned: [], workflows_completed: 0 });
  }
});

export default router;
