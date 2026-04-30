import { Router, type Request } from "express";
import type { AppDeps } from "../app";
import {
  listRecordings,
  getRecording,
  updateRecording,
  deleteRecordingRow,
} from "../services/recordings";
import { deleteAudioFile } from "../utils/storage";

export function recordingsRouter(deps: AppDeps): Router {
  const router = Router();

  router.get("/", (req, res, next) => {
    try {
      const tags = parseStringArray(req.query.tag);
      const items = listRecordings(deps.db, {
        projectId: parseOptionalNumber(req.query.project_id),
        tags: tags.length > 0 ? tags : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        limit: parseOptionalNumber(req.query.limit),
        offset: parseOptionalNumber(req.query.offset),
      });
      res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  router.get("/:id", (req, res, next) => {
    try {
      res.json(getRecording(deps.db, Number(req.params.id)));
    } catch (e) {
      next(e);
    }
  });

  router.patch("/:id", (req, res, next) => {
    try {
      const updated = updateRecording(deps.db, Number(req.params.id), {
        title: typeof req.body.title === "string" ? req.body.title : undefined,
        project_id:
          typeof req.body.project_id === "number" ? req.body.project_id : undefined,
        tags: Array.isArray(req.body.tags)
          ? req.body.tags.map((x: unknown) => String(x))
          : undefined,
      });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const filePath = deleteRecordingRow(deps.db, Number(req.params.id));
      deleteAudioFile(deps.dataRoot, filePath);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

function parseStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return [v];
  return [];
}

function parseOptionalNumber(v: unknown): number | undefined {
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
