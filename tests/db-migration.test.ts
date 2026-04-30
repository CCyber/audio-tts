import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "../src/db";

function makeOldDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-mig-"));
  const file = path.join(dir, "old.db");
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      original_text TEXT NOT NULL,
      voice TEXT NOT NULL,
      model TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_recordings_project ON recordings(project_id);
    CREATE INDEX idx_recordings_created ON recordings(created_at DESC);
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE recording_tags (
      recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (recording_id, tag_id)
    );
    CREATE VIRTUAL TABLE recordings_fts USING fts5(
      title, original_text, content='recordings', content_rowid='id'
    );
    INSERT INTO projects (id, name, is_system) VALUES (1, 'Inbox', 1);
    INSERT INTO recordings (project_id, title, original_text, voice, model, file_path, file_size, duration_ms)
      VALUES (1, 'Old', 'hi', 'alloy', 'tts-1', 'audio/old.mp3', 100, 1000);
  `);
  db.pragma("user_version = 1");
  db.close();
  return file;
}

describe("DB migration v1 -> v2", () => {
  it("adds status/progress columns to recordings with safe defaults", () => {
    const file = makeOldDb();
    const db = openDb(file);

    const row = db.prepare("SELECT * FROM recordings WHERE id = 1").get() as any;
    expect(row.status).toBe("done");
    expect(row.progress_total).toBe(1);
    expect(row.progress_done).toBe(1);
    expect(row.error).toBeNull();
    expect(row.file_path).toBe("audio/old.mp3");
  });

  it("creates recording_chunks table", () => {
    const file = makeOldDb();
    const db = openDb(file);

    const tbl = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='recording_chunks'"
    ).get();
    expect(tbl).toBeTruthy();
  });

  it("relaxes file_path/size/duration NOT NULL via table recreation", () => {
    const file = makeOldDb();
    const db = openDb(file);

    db.prepare(
      `INSERT INTO recordings (project_id, title, original_text, voice, model, status, progress_total, progress_done)
       VALUES (1, 'Pending', 'x', 'alloy', 'tts-1', 'generating', 3, 0)`
    ).run();

    const row = db.prepare("SELECT * FROM recordings WHERE title = 'Pending'").get() as any;
    expect(row.file_path).toBeNull();
    expect(row.file_size).toBeNull();
    expect(row.duration_ms).toBeNull();
  });

  it("preserves FTS index after migration", () => {
    const file = makeOldDb();
    const db = openDb(file);

    const res = db.prepare(
      "SELECT rowid FROM recordings_fts WHERE recordings_fts MATCH ?"
    ).all("Old");
    expect(res.length).toBe(1);
  });

  it("is idempotent (running migration twice is a no-op)", () => {
    const file = makeOldDb();
    const db1 = openDb(file);
    db1.close();
    const db2 = openDb(file);
    expect(db2.pragma("user_version", { simple: true })).toBe(2);

    // Stronger: the migrated row must still be there, untouched.
    const row = db2.prepare("SELECT id, title, status FROM recordings WHERE id = 1").get() as any;
    expect(row).toEqual({ id: 1, title: "Old", status: "done" });
  });

  it("preserves recording_tags FK after table recreation", () => {
    const file = makeOldDb();
    // Add a tag + link in v1 BEFORE migration so the FK target is the old table.
    const v1 = new Database(file);
    v1.exec(`
      INSERT INTO tags (name) VALUES ('legacy');
      INSERT INTO recording_tags (recording_id, tag_id)
        SELECT 1, id FROM tags WHERE name = 'legacy';
    `);
    v1.close();

    const db = openDb(file);
    // Tag link survived migration.
    const before = db.prepare(
      "SELECT COUNT(*) AS n FROM recording_tags WHERE recording_id = 1"
    ).get() as { n: number };
    expect(before.n).toBe(1);

    // Cascade still fires when we delete the recording.
    db.prepare("DELETE FROM recordings WHERE id = 1").run();
    const after = db.prepare(
      "SELECT COUNT(*) AS n FROM recording_tags WHERE recording_id = 1"
    ).get() as { n: number };
    expect(after.n).toBe(0);
  });
});
