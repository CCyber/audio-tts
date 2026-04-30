import type { DB } from "../db";
import { ApiError } from "../utils/errors";

export interface Project {
  id: number;
  name: string;
  is_system: number;
  created_at: string;
  recording_count: number;
}

const INBOX_ID = 1;

export function listProjects(db: DB): Project[] {
  return db
    .prepare(
      `SELECT p.id, p.name, p.is_system, p.created_at,
              COALESCE(c.cnt, 0) AS recording_count
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS cnt FROM recordings GROUP BY project_id
       ) c ON c.project_id = p.id
       ORDER BY p.is_system DESC, p.name COLLATE NOCASE ASC`
    )
    .all() as Project[];
}

export function createProject(db: DB, name: string): Project {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ApiError(400, "Project name must not be empty");
  }
  const result = db
    .prepare("INSERT INTO projects (name) VALUES (?)")
    .run(trimmed);
  const id = Number(result.lastInsertRowid);
  return getProjectById(db, id);
}

export function renameProject(db: DB, id: number, name: string): Project {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ApiError(400, "Project name must not be empty");
  }
  if (id === INBOX_ID) {
    throw new ApiError(400, "Inbox cannot be renamed");
  }
  const project = getProjectById(db, id);
  if (!project) {
    throw new ApiError(404, "Project not found");
  }
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(trimmed, id);
  return getProjectById(db, id);
}

export function deleteProject(db: DB, id: number): void {
  if (id === INBOX_ID) {
    throw new ApiError(400, "Inbox cannot be deleted");
  }
  const project = getProjectById(db, id);
  if (!project) {
    throw new ApiError(404, "Project not found");
  }
  const tx = db.transaction(() => {
    db.prepare("UPDATE recordings SET project_id = ? WHERE project_id = ?").run(
      INBOX_ID,
      id
    );
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
}

function getProjectById(db: DB, id: number): Project {
  const row = db
    .prepare(
      `SELECT p.id, p.name, p.is_system, p.created_at,
              COALESCE(c.cnt, 0) AS recording_count
       FROM projects p
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS cnt FROM recordings GROUP BY project_id
       ) c ON c.project_id = p.id
       WHERE p.id = ?`
    )
    .get(id) as Project | undefined;
  if (!row) {
    throw new ApiError(404, "Project not found");
  }
  return row;
}
