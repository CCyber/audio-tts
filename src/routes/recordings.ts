import { Router, type Request } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { AppDeps } from "../app";
import {
  listRecordings,
  getRecording,
  updateRecording,
  deleteRecordingRow,
  insertRecording,
} from "../services/recordings";
import { setTagsForRecording } from "../services/tags";
import { generateTtsBuffer } from "../services/tts";
import { writeAudioFile, deleteAudioFile, audioPathFor } from "../utils/storage";
import { measureDurationMs } from "../utils/audio";
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
      const filePath = deleteRecordingRow(deps.db, Number(req.params.id));
      deleteAudioFile(deps.dataRoot, filePath);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post(
    "/",
    upload.single("file"),
    async (req: Request, res, next) => {
      let writtenRelativePath: string | null = null;
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

        const buffer = await generateTtsBuffer({ text, voice, model });
        const durationMs = await measureDurationMs(buffer);

        const filename = `${uuidv4()}.mp3`;
        const filePath = writeAudioFile(deps.dataRoot, filename, buffer);
        writtenRelativePath = filePath;

        const title = titleInput.trim() || deriveTitle(text, 50);

        const inserted = deps.db.transaction(() => {
          const row = insertRecording(deps.db, {
            project_id: projectId,
            title,
            original_text: text.trim(),
            voice,
            model,
            file_path: filePath,
            file_size: buffer.length,
            duration_ms: durationMs,
          });
          if (tags.length > 0) {
            setTagsForRecording(deps.db, row.id, tags);
          }
          return row;
        })();

        const full = getRecording(deps.db, inserted.id);
        res.status(201).json(full);
      } catch (e) {
        if (writtenRelativePath) {
          deleteAudioFile(deps.dataRoot, writtenRelativePath);
        }
        next(e);
      }
    }
  );

  router.get("/:id/audio", (req, res, next) => {
    try {
      const rec = getRecording(deps.db, Number(req.params.id));
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
