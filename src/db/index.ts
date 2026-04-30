import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type DB = Database.Database;

const SCHEMA_VERSION = 2;
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export function openDb(filename: string): DB {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  seedInbox(db);

  return db;
}

function runMigrations(db: DB): void {
  const currentVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0;

  if (currentVersion === 0) {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
    db.exec(schema);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    return;
  }

  if (currentVersion < 2) {
    migrateV1toV2(db);
    db.pragma("user_version = 2");
  }
}

function migrateV1toV2(db: DB): void {
  // SQLite cannot drop NOT NULL via ALTER, so recreate the recordings table.
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;

    -- Drop FTS triggers; the FTS table itself rebuilds from content.
    DROP TRIGGER IF EXISTS recordings_ai;
    DROP TRIGGER IF EXISTS recordings_ad;
    DROP TRIGGER IF EXISTS recordings_au;

    CREATE TABLE recordings_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      original_text TEXT NOT NULL,
      voice TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'done',
      progress_total INTEGER NOT NULL DEFAULT 0,
      progress_done INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      file_path TEXT UNIQUE,
      file_size INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO recordings_new (
      id, project_id, title, original_text, voice, model,
      status, progress_total, progress_done, error,
      file_path, file_size, duration_ms, created_at
    )
    SELECT id, project_id, title, original_text, voice, model,
           'done', 1, 1, NULL,
           file_path, file_size, duration_ms, created_at
    FROM recordings;

    DROP TABLE recordings;
    ALTER TABLE recordings_new RENAME TO recordings;

    CREATE INDEX IF NOT EXISTS idx_recordings_project ON recordings(project_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);

    CREATE TABLE IF NOT EXISTS recording_chunks (
      recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      idx          INTEGER NOT NULL,
      text         TEXT    NOT NULL,
      status       TEXT    NOT NULL,
      file_path    TEXT,
      byte_size    INTEGER,
      error        TEXT,
      PRIMARY KEY (recording_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_recording_chunks_status ON recording_chunks(recording_id, status);

    -- Recreate FTS triggers (they were dropped above).
    CREATE TRIGGER recordings_ai AFTER INSERT ON recordings BEGIN
      INSERT INTO recordings_fts(rowid, title, original_text)
      VALUES (new.id, new.title, new.original_text);
    END;
    CREATE TRIGGER recordings_ad AFTER DELETE ON recordings BEGIN
      INSERT INTO recordings_fts(recordings_fts, rowid, title, original_text)
      VALUES('delete', old.id, old.title, old.original_text);
    END;
    CREATE TRIGGER recordings_au AFTER UPDATE ON recordings BEGIN
      INSERT INTO recordings_fts(recordings_fts, rowid, title, original_text)
      VALUES('delete', old.id, old.title, old.original_text);
      INSERT INTO recordings_fts(rowid, title, original_text)
      VALUES (new.id, new.title, new.original_text);
    END;

    -- Rebuild FTS from content table (rows survived the swap, but the
    -- 'content_rowid' bond is by table name + rowid, which we preserved).
    INSERT INTO recordings_fts(recordings_fts) VALUES('rebuild');

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function seedInbox(db: DB): void {
  const existing = db.prepare("SELECT id FROM projects WHERE id = 1").get();
  if (existing) {
    return;
  }
  db.prepare(
    "INSERT INTO projects (id, name, is_system) VALUES (1, 'Inbox', 1)"
  ).run();
}
