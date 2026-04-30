import { Router } from "express";
import type { AppDeps } from "../app";
import { listTagsWithCount } from "../services/tags";

export function tagsRouter(deps: AppDeps): Router {
  const router = Router();
  router.get("/", (_req, res, next) => {
    try {
      res.json({ items: listTagsWithCount(deps.db) });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
