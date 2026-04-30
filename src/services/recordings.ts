import type { DB } from "../db";
import { ApiError } from "../utils/errors";
import { setTagsForRecording, getTagsForRecording, type Tag } from "./tags";

export interface RecordingRow {
  id: number;
  project_id: number;
  title: string;
  original_text: string;
  voice: string;
  model: string;
  file_path: string;
  file_size: number;
  duration_ms: number;
  created_at: string;
}

export interface Recording extends RecordingRow {
  tags: Tag[];
}

export interface InsertInput {
  project_id: number;
  title: string;
  original_text: string;
  voice: string;
  model: string;
  file_path: string;
  file_size: number;
  duration_ms: number;
}

export interface ListFilters {
  projectId?: number;
  tags?: string[];
  q?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateInput {
  title?: string;
  project_id?: number;
  tags?: string[];
}

export function insertRecording(db: DB, input: InsertInput): RecordingRow {
  const r = db
    .prepare(
      `INSERT INTO recordings
        (project_id, title, original_text, voice, model, file_path, file_size, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.project_id,
      input.title,
      input.original_text,
      input.voice,
      input.model,
      input.file_path,
      input.file_size,
      input.duration_ms
    );
  const id = Number(r.lastInsertRowid);
  return db
    .prepare("SELECT * FROM recordings WHERE id = ?")
    .get(id) as RecordingRow;
}

export function listRecordings(db: DB, filters: ListFilters): Recording[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.projectId !== undefined) {
    where.push("r.project_id = ?");
    params.push(filters.projectId);
  }

  if (filters.tags && filters.tags.length > 0) {
    const placeholders = filters.tags.map(() => "?").join(", ");
    where.push(
      `r.id IN (
         SELECT rt.recording_id FROM recording_tags rt
         JOIN tags t ON t.id = rt.tag_id
         WHERE t.name COLLATE NOCASE IN (${placeholders})
         GROUP BY rt.recording_id
         HAVING COUNT(DISTINCT t.id) = ?
       )`
    );
    params.push(...filters.tags, filters.tags.length);
  }

  let sql = `SELECT r.* FROM recordings r`;

  if (filters.q && filters.q.trim().length > 0) {
    sql += ` JOIN recordings_fts ON recordings_fts.rowid = r.id`;
    where.push("recordings_fts MATCH ?");
    params.push(buildFtsQuery(filters.q));
  }

  if (where.length > 0) {
    sql += " WHERE " + where.join(" AND ");
  }

  sql += " ORDER BY r.created_at DESC, r.id DESC";

  if (filters.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(filters.limit);
    if (filters.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(filters.offset);
    }
  }

  const rows = db.prepare(sql).all(...params) as RecordingRow[];
  return rows.map((row) => ({ ...row, tags: getTagsForRecording(db, row.id) }));
}

export function getRecording(db: DB, id: number): Recording {
  const row = db.prepare("SELECT * FROM recordings WHERE id = ?").get(id) as
    | RecordingRow
    | undefined;
  if (!row) {
    throw new ApiError(404, "Recording not found");
  }
  return { ...row, tags: getTagsForRecording(db, id) };
}

export function updateRecording(db: DB, id: number, input: UpdateInput): Recording {
  const existing = getRecording(db, id);

  const tx = db.transaction(() => {
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed) {
        throw new ApiError(400, "Title must not be empty");
      }
      db.prepare("UPDATE recordings SET title = ? WHERE id = ?").run(trimmed, id);
    }
    if (input.project_id !== undefined) {
      const project = db
        .prepare("SELECT id FROM projects WHERE id = ?")
        .get(input.project_id);
      if (!project) {
        throw new ApiError(400, "Project does not exist");
      }
      db.prepare("UPDATE recordings SET project_id = ? WHERE id = ?").run(
        input.project_id,
        id
      );
    }
    if (input.tags !== undefined) {
      setTagsForRecording(db, id, input.tags);
    }
  });
  tx();
  return getRecording(db, id);
}

export function deleteRecordingRow(db: DB, id: number): string {
  const existing = getRecording(db, id);
  db.prepare("DELETE FROM recordings WHERE id = ?").run(id);
  return existing.file_path;
}

function buildFtsQuery(input: string): string {
  // Schutz vor FTS5-Operatoren — wir wollen Standard-Tokenization als Konjunktion.
  const tokens = input
    .replace(/["']/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tokens.map((t) => `"${t}"*`).join(" ");
}
