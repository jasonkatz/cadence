import { Router } from "express";
import { settingsService } from "../services/settings-service";
import { UnauthorizedError, ValidationError } from "../middleware/error-handler";

const router = Router();

router.get("/settings", async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const settings = await settingsService.get(req.user.id);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();

    const { github_token } = req.body;
    if (!github_token || typeof github_token !== "string") {
      throw new ValidationError("github_token is required");
    }

    const settings = await settingsService.update(req.user.id, github_token);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

export default router;
