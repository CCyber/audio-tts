import { Router, type Request, type Response, type NextFunction } from "express";
import type { AppDeps } from "../app";
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
} from "../services/projects";

export function projectsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get("/", (_req, res, next) => {
    try {
      res.json({ items: listProjects(deps.db) });
    } catch (e) {
      next(e);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const project = createProject(deps.db, String(req.body.name ?? ""));
      res.status(201).json(project);
    } catch (e) {
      next(e);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const project = renameProject(deps.db, id, String(req.body.name ?? ""));
      res.json(project);
    } catch (e) {
      next(e);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const id = Number(req.params.id);
      deleteProject(deps.db, id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
