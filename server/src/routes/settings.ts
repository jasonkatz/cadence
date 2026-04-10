import { Router } from "express";
import { configService } from "../services/config-service";
import { ValidationError } from "../middleware/error-handler";

const router = Router();

router.get("/settings", (_req, res, next) => {
  try {
    const settings = configService.get();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put("/settings", (req, res, next) => {
  try {
    const { github_token } = req.body;
    if (!github_token || typeof github_token !== "string") {
      throw new ValidationError("github_token is required");
    }

    const settings = configService.update({ github_token });
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

export default router;
