import { Router, type Request } from "express";
import multer from "multer";
import path from "path";
import type { AppDeps } from "../app";
import {
  listRecordings,
  getRecording,
  updateRecording,
  deleteRecordingRow,
  insertPendingRecording,
  resetForRetry,
} from "../services/recordings";
import { setTagsForRecording } from "../services/tags";
import { splitTextIntoChunks } from "../services/tts";
import {
  insertChunks,
  resetFailedChunks,
  countDoneChunks,
} from "../services/recording_chunks";
import { deleteAudioFile, audioPathFor, deleteChunkDir } from "../utils/storage";
import { deriveTitle } from "../utils/title";
import { ApiError } from "../utils/errors";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "text/plain" ||
      path.extname(file.originalname).toLowerCase() === ".txt"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .txt files are allowed"));
    }
  },
});

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
      const id = Number(req.params.id);
      const rec = getRecording(deps.db, id);
      if (rec.status === "generating") {
        deps.worker.cancel(id);
      }
      const filePath = deleteRecordingRow(deps.db, id);
      if (filePath) deleteAudioFile(deps.dataRoot, filePath);
      deleteChunkDir(deps.dataRoot, id);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post("/:id/cancel", (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rec = getRecording(deps.db, id); // throws 404
      if (rec.status !== "generating") {
        throw new ApiError(409, "Recording is not generating");
      }

      deps.worker.cancel(id);

      // Worker will see the flag at the next chunk boundary. We delete the row +
      // chunk dir now: ON DELETE CASCADE removes recording_chunks. Any in-flight
      // chunk write will land in a now-stale dir; we sweep it on the next line.
      const filePath = deleteRecordingRow(deps.db, id);
      if (filePath) deleteAudioFile(deps.dataRoot, filePath);
      deleteChunkDir(deps.dataRoot, id);

      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post("/:id/retry", (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rec = getRecording(deps.db, id);
      if (rec.status !== "failed") {
        throw new ApiError(409, "Recording is not in failed state");
      }
      const doneCount = countDoneChunks(deps.db, id);
      deps.db.transaction(() => {
        resetFailedChunks(deps.db, id);
        resetForRetry(deps.db, id, doneCount);
      })();
      deps.worker.enqueue(id);
      res.status(200).json(getRecording(deps.db, id));
    } catch (e) {
      next(e);
    }
  });

  router.post(
    "/",
    upload.single("file"),
    (req: Request, res, next) => {
      try {
        let text = String(req.body.text ?? "");
        const voice = String(req.body.voice ?? "");
        const model = String(req.body.model ?? "");
        const projectIdRaw = req.body.project_id;
        const projectId = projectIdRaw ? Number(projectIdRaw) : 1;
        const titleInput = typeof req.body.title === "string" ? req.body.title : "";
        const tags = parseTagsField(req.body.tags ?? req.body["tags[]"]);

        if (req.file) {
          text = req.file.buffer.toString("utf-8");
        }

        if (!text.trim()) throw new ApiError(400, "No text provided");
        if (!Number.isFinite(projectId)) throw new ApiError(400, "Invalid project_id");

        // Pre-flight key check so the user gets immediate feedback in the modal.
        if (!process.env.OPENAI_API_KEY) {
          throw new ApiError(500, "OPENAI_API_KEY is not configured");
        }

        const projectExists = deps.db
          .prepare("SELECT id FROM projects WHERE id = ?")
          .get(projectId);
        if (!projectExists) {
          throw new ApiError(400, `Project ${projectId} does not exist`);
        }

        const chunks = splitTextIntoChunks(text.trim(), 4000);
        if (chunks.length === 0) throw new ApiError(400, "No text provided");

        const title = titleInput.trim() || deriveTitle(text, 50);

        const inserted = deps.db.transaction(() => {
          const row = insertPendingRecording(deps.db, {
            project_id: projectId,
            title,
            original_text: text.trim(),
            voice,
            model,
            progress_total: chunks.length,
          });
          insertChunks(deps.db, row.id, chunks);
          if (tags.length > 0) setTagsForRecording(deps.db, row.id, tags);
          return row;
        })();

        deps.worker.enqueue(inserted.id);
        const full = getRecording(deps.db, inserted.id);
        res.status(202).json(full);
      } catch (e) {
        next(e);
      }
    }
  );

  router.get("/:id/audio", (req, res, next) => {
    try {
      const rec = getRecording(deps.db, Number(req.params.id));
      if (rec.status !== "done" || !rec.file_path) {
        throw new ApiError(404, "Recording is not ready");
      }
      const fullPath = audioPathFor(deps.dataRoot, rec.file_path);
      res.type("audio/mpeg");
      res.sendFile(fullPath);
    } catch (e) {
      next(e);
    }
  });

  router.get("/:id/download", (req, res, next) => {
    try {
      const rec = getRecording(deps.db, Number(req.params.id));
      if (rec.status !== "done" || !rec.file_path) {
        throw new ApiError(404, "Recording is not ready");
      }
      const fullPath = audioPathFor(deps.dataRoot, rec.file_path);
      res.download(fullPath, `${rec.title.replace(/[^\w\-_.\s]/g, "_")}.mp3`);
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

function parseTagsField(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string") {
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
      } catch {
        return [raw];
      }
    }
    return [raw];
  }
  return [];
}
