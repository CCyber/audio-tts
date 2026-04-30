# Async TTS Generation with Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple `POST /api/recordings` from the OpenAI work via an in-process worker, persist per-chunk state for resume, expose live progress through polling, and add cancel/retry endpoints.

**Architecture:** Existing Express + better-sqlite3 + vanilla TS frontend. New worker module owns a FIFO queue (concurrency = 1). DB gains `status`/`progress_*` columns on `recordings` and a new `recording_chunks` table. Frontend polls `GET /api/recordings/:id` every second while pending recordings exist.

**Tech Stack:** TypeScript, Express, better-sqlite3, vitest, supertest, native `fetch`.

**Spec:** `docs/superpowers/specs/2026-04-30-async-tts-progress-design.md`

---

## File Structure

**New files:**
- `src/services/worker.ts` — in-process queue + chunk-by-chunk generation logic
- `src/services/recording_chunks.ts` — DB access for `recording_chunks` table
- `src/utils/concat.ts` — streaming MP3 concatenation
- `src/utils/recovery.ts` — startup reconciliation (`generating` → `failed`, orphan cleanup)
- `src/public/polling.ts` — frontend polling module
- `tests/services/worker.test.ts`
- `tests/services/recording_chunks.test.ts`
- `tests/utils/concat.test.ts`
- `tests/utils/recovery.test.ts`
- `tests/db-migration.test.ts`

**Modified files:**
- `src/db/schema.sql` — extend recordings, add recording_chunks (for fresh DBs)
- `src/db/index.ts` — bump `SCHEMA_VERSION`, run migration v2 for existing DBs
- `src/services/recordings.ts` — `Recording`/`InsertInput` types, helpers for status & progress
- `src/services/tts.ts` — extract chunk-list builder so worker can call it; keep `splitTextIntoChunks` (already module-private — make it exported)
- `src/routes/recordings.ts` — async POST, new cancel + retry routes, audio guard
- `src/server.ts` — call recovery hook before starting worker
- `src/utils/storage.ts` — chunk-file helpers
- `src/public/api.ts` — `Recording` type, `cancelRecording`, `retryRecording`
- `src/public/library.ts` — register pending recordings with polling on reload
- `src/public/card.ts` — three render variants (`generating` | `failed` | `done`)
- `src/public/generate.ts` — close modal immediately on submit
- `src/public/state.ts` — store pending IDs (optional helper)
- `src/public/style.css` — progress bar + failed banner styling
- `tests/routes/recordings.test.ts` — adapt to async POST, add cancel/retry/audio-guard tests

---

## Task 1: Schema — Add columns to `recordings` and create `recording_chunks`

**Why first:** All backend tasks depend on the new schema. Doing this with TDD on the migration ensures old DBs upgrade cleanly.

**Files:**
- Modify: `src/db/index.ts:7` (`SCHEMA_VERSION` and migration logic)
- Modify: `src/db/schema.sql` (full rewrite of `recordings`, plus new `recording_chunks`)
- Create: `tests/db-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/db-migration.test.ts`:

```ts
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
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npx vitest run tests/db-migration.test.ts`
Expected: failures referencing missing columns / missing table.

- [ ] **Step 3: Update `schema.sql` for fresh DBs**

Replace `src/db/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recordings (
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

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS recording_tags (
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, tag_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS recordings_fts USING fts5(
  title,
  original_text,
  content='recordings',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS recordings_ai AFTER INSERT ON recordings BEGIN
  INSERT INTO recordings_fts(rowid, title, original_text)
  VALUES (new.id, new.title, new.original_text);
END;

CREATE TRIGGER IF NOT EXISTS recordings_ad AFTER DELETE ON recordings BEGIN
  INSERT INTO recordings_fts(recordings_fts, rowid, title, original_text)
  VALUES('delete', old.id, old.title, old.original_text);
END;

CREATE TRIGGER IF NOT EXISTS recordings_au AFTER UPDATE ON recordings BEGIN
  INSERT INTO recordings_fts(recordings_fts, rowid, title, original_text)
  VALUES('delete', old.id, old.title, old.original_text);
  INSERT INTO recordings_fts(rowid, title, original_text)
  VALUES (new.id, new.title, new.original_text);
END;
```

- [ ] **Step 4: Implement versioned migration runner**

Replace `src/db/index.ts` with:

```ts
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
```

- [ ] **Step 5: Run migration test, expect pass**

Run: `npx vitest run tests/db-migration.test.ts`
Expected: all five tests pass.

- [ ] **Step 6: Run full test suite, fix any breakage from new nullable columns**

Run: `npm test`
Expected: existing tests pass. If any fail because they read `r.file_path` etc. and now get `null`, those will be fixed in later tasks where we touch the same code paths. If a test fails purely on schema, fix it here (likely none — existing seeds set all fields).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/index.ts tests/db-migration.test.ts
git commit -m "Add status/progress columns + recording_chunks table"
```

---

## Task 2: Update `Recording` types and add status/progress helpers

**Files:**
- Modify: `src/services/recordings.ts:5-32` (`RecordingRow`, `Recording`, `InsertInput`)
- Modify: `src/services/recordings.ts:47-68` (`insertRecording`)
- Test: `tests/services/recordings.test.ts` (extend if exists, otherwise new)

- [ ] **Step 1: Write failing test for new fields**

Append to `tests/services/recordings.test.ts` (or create if missing — check first):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/db";
import { insertRecording, getRecording } from "../../src/services/recordings";

describe("recordings status fields", () => {
  let db: DB;
  beforeEach(() => { db = openDb(":memory:"); });

  it("insertRecording defaults status='done' and progress=1/1", () => {
    const row = insertRecording(db, {
      project_id: 1,
      title: "T",
      original_text: "x",
      voice: "alloy",
      model: "tts-1",
      file_path: "audio/x.mp3",
      file_size: 100,
      duration_ms: 500,
    });
    const fetched = getRecording(db, row.id);
    expect(fetched.status).toBe("done");
    expect(fetched.progress_total).toBe(1);
    expect(fetched.progress_done).toBe(1);
    expect(fetched.error).toBeNull();
  });

  it("can insert a pending recording with NULL file_path", () => {
    const r = db.prepare(
      `INSERT INTO recordings (project_id, title, original_text, voice, model,
                               status, progress_total, progress_done)
       VALUES (1, 'P', 'hi', 'alloy', 'tts-1', 'generating', 5, 0)`
    ).run();
    const fetched = getRecording(db, Number(r.lastInsertRowid));
    expect(fetched.status).toBe("generating");
    expect(fetched.file_path).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure on type mismatch / missing fields**

Run: `npx vitest run tests/services/recordings.test.ts`
Expected: TypeScript / runtime error about missing `status`, `progress_total`, etc.

- [ ] **Step 3: Update types and `insertRecording`**

Replace the `RecordingRow`, `Recording`, `InsertInput` blocks in `src/services/recordings.ts` (lines 5-32):

```ts
export type RecordingStatus = "generating" | "done" | "failed";

export interface RecordingRow {
  id: number;
  project_id: number;
  title: string;
  original_text: string;
  voice: string;
  model: string;
  status: RecordingStatus;
  progress_total: number;
  progress_done: number;
  error: string | null;
  file_path: string | null;
  file_size: number | null;
  duration_ms: number | null;
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
  // For sync inserts (tests, legacy code path) — status defaults to 'done'.
  // For pending inserts use insertPendingRecording.
  file_path: string;
  file_size: number;
  duration_ms: number;
}

export interface InsertPendingInput {
  project_id: number;
  title: string;
  original_text: string;
  voice: string;
  model: string;
  progress_total: number;
}
```

Replace `insertRecording` body to populate `status='done'`, `progress_total=1`, `progress_done=1`, `error=null`:

```ts
export function insertRecording(db: DB, input: InsertInput): RecordingRow {
  const r = db
    .prepare(
      `INSERT INTO recordings
        (project_id, title, original_text, voice, model,
         status, progress_total, progress_done, error,
         file_path, file_size, duration_ms)
       VALUES (?, ?, ?, ?, ?, 'done', 1, 1, NULL, ?, ?, ?)`
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

export function insertPendingRecording(db: DB, input: InsertPendingInput): RecordingRow {
  const r = db
    .prepare(
      `INSERT INTO recordings
        (project_id, title, original_text, voice, model,
         status, progress_total, progress_done, error,
         file_path, file_size, duration_ms)
       VALUES (?, ?, ?, ?, ?, 'generating', ?, 0, NULL, NULL, NULL, NULL)`
    )
    .run(
      input.project_id,
      input.title,
      input.original_text,
      input.voice,
      input.model,
      input.progress_total
    );
  const id = Number(r.lastInsertRowid);
  return db.prepare("SELECT * FROM recordings WHERE id = ?").get(id) as RecordingRow;
}

export function markRecordingDone(
  db: DB,
  id: number,
  patch: { file_path: string; file_size: number; duration_ms: number }
): void {
  db.prepare(
    `UPDATE recordings
        SET status = 'done',
            file_path = ?,
            file_size = ?,
            duration_ms = ?,
            error = NULL
      WHERE id = ?`
  ).run(patch.file_path, patch.file_size, patch.duration_ms, id);
}

export function markRecordingFailed(db: DB, id: number, message: string): void {
  db.prepare(
    "UPDATE recordings SET status = 'failed', error = ? WHERE id = ?"
  ).run(message, id);
}

export function incrementProgressDone(db: DB, id: number): void {
  db.prepare(
    "UPDATE recordings SET progress_done = progress_done + 1 WHERE id = ?"
  ).run(id);
}

export function resetForRetry(db: DB, id: number, newProgressDone: number): void {
  db.prepare(
    `UPDATE recordings
        SET status = 'generating',
            progress_done = ?,
            error = NULL
      WHERE id = ?`
  ).run(newProgressDone, id);
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run tests/services/recordings.test.ts`
Expected: pass.

- [ ] **Step 5: Run full suite to catch type fallout**

Run: `npm test`
Expected: pass. If `routes/recordings.ts` has compile errors because of changed types, **stop and fix only the trivially-broken bits** here (the route POST handler will be fully rewritten in Task 7). Quick fix: where the route currently reads `inserted.id` and the return type changed, the existing field access still works — `id`, `file_path`, etc. all still exist (just nullable now). Ensure `getRecording` in `routes/recordings.ts:143` still type-checks; should be fine.

- [ ] **Step 6: Commit**

```bash
git add src/services/recordings.ts tests/services/recordings.test.ts
git commit -m "Extend Recording with status/progress + helpers"
```

---

## Task 3: `recording_chunks` service

**Files:**
- Create: `src/services/recording_chunks.ts`
- Create: `tests/services/recording_chunks.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/services/recording_chunks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/db";
import { insertPendingRecording } from "../../src/services/recordings";
import {
  insertChunks,
  listChunks,
  markChunkDone,
  markChunkFailed,
  resetFailedChunks,
} from "../../src/services/recording_chunks";

describe("recording_chunks service", () => {
  let db: DB;
  let recordingId: number;

  beforeEach(() => {
    db = openDb(":memory:");
    const rec = insertPendingRecording(db, {
      project_id: 1,
      title: "T",
      original_text: "abc",
      voice: "alloy",
      model: "tts-1",
      progress_total: 3,
    });
    recordingId = rec.id;
  });

  it("insertChunks creates rows with status='pending'", () => {
    insertChunks(db, recordingId, ["a", "b", "c"]);
    const rows = listChunks(db, recordingId);
    expect(rows.map((r) => [r.idx, r.status, r.text])).toEqual([
      [0, "pending", "a"],
      [1, "pending", "b"],
      [2, "pending", "c"],
    ]);
  });

  it("markChunkDone sets file_path/byte_size", () => {
    insertChunks(db, recordingId, ["a", "b"]);
    markChunkDone(db, recordingId, 0, "audio/chunks/1/0.mp3", 512);
    const [first] = listChunks(db, recordingId);
    expect(first.status).toBe("done");
    expect(first.file_path).toBe("audio/chunks/1/0.mp3");
    expect(first.byte_size).toBe(512);
  });

  it("markChunkFailed records error", () => {
    insertChunks(db, recordingId, ["a"]);
    markChunkFailed(db, recordingId, 0, "OpenAI 429");
    const [c] = listChunks(db, recordingId);
    expect(c.status).toBe("failed");
    expect(c.error).toBe("OpenAI 429");
  });

  it("resetFailedChunks flips failed back to pending and clears error", () => {
    insertChunks(db, recordingId, ["a", "b"]);
    markChunkDone(db, recordingId, 0, "audio/chunks/1/0.mp3", 100);
    markChunkFailed(db, recordingId, 1, "boom");
    resetFailedChunks(db, recordingId);
    const rows = listChunks(db, recordingId);
    expect(rows[0].status).toBe("done");
    expect(rows[1].status).toBe("pending");
    expect(rows[1].error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/services/recording_chunks.test.ts`
Expected: module-not-found error.

- [ ] **Step 3: Implement the service**

Create `src/services/recording_chunks.ts`:

```ts
import type { DB } from "../db";

export type ChunkStatus = "pending" | "done" | "failed";

export interface ChunkRow {
  recording_id: number;
  idx: number;
  text: string;
  status: ChunkStatus;
  file_path: string | null;
  byte_size: number | null;
  error: string | null;
}

export function insertChunks(db: DB, recordingId: number, texts: string[]): void {
  const stmt = db.prepare(
    `INSERT INTO recording_chunks (recording_id, idx, text, status)
     VALUES (?, ?, ?, 'pending')`
  );
  const tx = db.transaction((items: string[]) => {
    items.forEach((text, idx) => stmt.run(recordingId, idx, text));
  });
  tx(texts);
}

export function listChunks(db: DB, recordingId: number): ChunkRow[] {
  return db
    .prepare(
      "SELECT * FROM recording_chunks WHERE recording_id = ? ORDER BY idx ASC"
    )
    .all(recordingId) as ChunkRow[];
}

export function listPendingChunks(db: DB, recordingId: number): ChunkRow[] {
  return db
    .prepare(
      `SELECT * FROM recording_chunks
        WHERE recording_id = ? AND status = 'pending'
        ORDER BY idx ASC`
    )
    .all(recordingId) as ChunkRow[];
}

export function markChunkDone(
  db: DB,
  recordingId: number,
  idx: number,
  filePath: string,
  byteSize: number
): void {
  db.prepare(
    `UPDATE recording_chunks
        SET status = 'done',
            file_path = ?,
            byte_size = ?,
            error = NULL
      WHERE recording_id = ? AND idx = ?`
  ).run(filePath, byteSize, recordingId, idx);
}

export function markChunkFailed(
  db: DB,
  recordingId: number,
  idx: number,
  message: string
): void {
  db.prepare(
    `UPDATE recording_chunks
        SET status = 'failed',
            error = ?
      WHERE recording_id = ? AND idx = ?`
  ).run(message, recordingId, idx);
}

export function resetFailedChunks(db: DB, recordingId: number): number {
  const r = db
    .prepare(
      `UPDATE recording_chunks
          SET status = 'pending',
              error = NULL
        WHERE recording_id = ? AND status = 'failed'`
    )
    .run(recordingId);
  return r.changes;
}

export function countDoneChunks(db: DB, recordingId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM recording_chunks
        WHERE recording_id = ? AND status = 'done'`
    )
    .get(recordingId) as { n: number };
  return row.n;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/services/recording_chunks.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording_chunks.ts tests/services/recording_chunks.test.ts
git commit -m "Add recording_chunks service"
```

---

## Task 4: Export `splitTextIntoChunks` and add per-chunk OpenAI call

**Files:**
- Modify: `src/services/tts.ts:85` (export the splitter; extract single-chunk OpenAI call)

The existing `tts.ts` has both the splitter and `callOpenAi` already; we just need them exported so the worker can use them, plus an auto-retry wrapper.

- [ ] **Step 1: Write failing test for retry wrapper**

Append to `tests/services/tts.test.ts` (or create if missing):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateChunkBuffer, splitTextIntoChunks } from "../../src/services/tts";

describe("splitTextIntoChunks (now exported)", () => {
  it("splits long text into <= 4000-char chunks", () => {
    const text = "a".repeat(10_000);
    const chunks = splitTextIntoChunks(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
  });
});

describe("generateChunkBuffer auto-retry", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test";
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const buf = await generateChunkBuffer({
      text: "hi", voice: "alloy", model: "tts-1",
    }, { backoffMs: () => 0 });

    expect(buf.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 attempts on persistent 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 429 }));
    globalThis.fetch = fetchMock as any;

    await expect(
      generateChunkBuffer({ text: "hi", voice: "alloy", model: "tts-1" },
                         { backoffMs: () => 0 })
    ).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 4xx (other)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    globalThis.fetch = fetchMock as any;

    await expect(
      generateChunkBuffer({ text: "hi", voice: "alloy", model: "tts-1" },
                         { backoffMs: () => 0 })
    ).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/services/tts.test.ts`
Expected: import errors for `generateChunkBuffer`, `splitTextIntoChunks`.

- [ ] **Step 3: Update `src/services/tts.ts`**

Append to `src/services/tts.ts` and adjust visibility:

- Change `function splitTextIntoChunks` → `export function splitTextIntoChunks`.
- Add the retry wrapper:

```ts
export interface GenerateChunkOptions {
  /** Number of attempts in total (default 3). */
  attempts?: number;
  /** Backoff in ms for retry attempt N (1-based). Default: linear 2s, 4s. */
  backoffMs?: (attempt: number) => number;
}

export async function generateChunkBuffer(
  input: GenerateInput,
  opts: GenerateChunkOptions = {}
): Promise<Buffer> {
  const apiKey = getApiKey();
  if (!VOICES.some((v) => v.id === input.voice)) {
    throw new ApiError(400, `Unknown voice: ${input.voice}`);
  }
  if (!isAllowedModel(input.model)) {
    throw new ApiError(400, `Unknown model: ${input.model}`);
  }

  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? ((n: number) => n * 2000);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await callOpenAi(apiKey, input.text, input.voice, input.model);
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ApiError) || !shouldRetry(e) || attempt === attempts) {
        throw e;
      }
      await delay(backoffMs(attempt));
    }
  }
  throw lastErr;
}

function shouldRetry(e: ApiError): boolean {
  // Retry on rate limit and 5xx upstream.
  return /\b(429|5\d\d)\b/.test(e.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
```

(Keep the existing `generateTtsBuffer` function in place; it's used by the legacy synchronous tests until we rewrite the route.)

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/services/tts.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/tts.ts tests/services/tts.test.ts
git commit -m "Export splitter and add per-chunk retry wrapper"
```

---

## Task 5: Streaming MP3 concat utility

**Files:**
- Create: `src/utils/concat.ts`
- Create: `tests/utils/concat.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/utils/concat.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { concatFiles } from "../../src/utils/concat";

let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("concatFiles", () => {
  it("concatenates byte streams in order", async () => {
    const a = path.join(dir, "a"); fs.writeFileSync(a, Buffer.from([1, 2, 3]));
    const b = path.join(dir, "b"); fs.writeFileSync(b, Buffer.from([4, 5]));
    const out = path.join(dir, "out");

    await concatFiles([a, b], out);

    expect(Array.from(fs.readFileSync(out))).toEqual([1, 2, 3, 4, 5]);
  });

  it("creates parent directories", async () => {
    const a = path.join(dir, "a"); fs.writeFileSync(a, Buffer.from([1]));
    const out = path.join(dir, "nested", "deep", "out.mp3");

    await concatFiles([a], out);

    expect(fs.existsSync(out)).toBe(true);
  });

  it("rejects when an input file is missing", async () => {
    const out = path.join(dir, "out");
    await expect(concatFiles([path.join(dir, "missing")], out)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, expect failure (module not found)**

Run: `npx vitest run tests/utils/concat.test.ts`
Expected: failure.

- [ ] **Step 3: Implement `concatFiles`**

Create `src/utils/concat.ts`:

```ts
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export async function concatFiles(inputs: string[], output: string): Promise<void> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const out = fs.createWriteStream(output);
  try {
    for (const input of inputs) {
      const src = fs.createReadStream(input);
      await pipeline(src, out, { end: false });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/utils/concat.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/concat.ts tests/utils/concat.test.ts
git commit -m "Add streaming concat utility"
```

---

## Task 6: Storage helpers for chunk files

**Files:**
- Modify: `src/utils/storage.ts` (append helpers)
- Modify or create: `tests/utils/storage.test.ts` (test new helpers)

- [ ] **Step 1: Add failing tests**

Append to `tests/utils/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  writeChunkFile,
  chunkPathFor,
  deleteChunkDir,
  chunkDirFor,
} from "../../src/utils/storage";

let dataRoot: string;
beforeEach(() => { dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-storage-")); });
afterEach(() => { fs.rmSync(dataRoot, { recursive: true, force: true }); });

describe("chunk storage helpers", () => {
  it("writeChunkFile returns a relative path under audio/chunks/<id>/", () => {
    const rel = writeChunkFile(dataRoot, 42, 3, Buffer.from([9, 9]));
    expect(rel).toBe(path.join("audio", "chunks", "42", "3.mp3"));
    const abs = path.join(dataRoot, rel);
    expect(fs.readFileSync(abs)[0]).toBe(9);
  });

  it("deleteChunkDir removes the whole recording chunk dir", () => {
    writeChunkFile(dataRoot, 7, 0, Buffer.from([1]));
    writeChunkFile(dataRoot, 7, 1, Buffer.from([2]));
    deleteChunkDir(dataRoot, 7);
    expect(fs.existsSync(chunkDirFor(dataRoot, 7))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/utils/storage.test.ts`
Expected: import error.

- [ ] **Step 3: Add helpers to `src/utils/storage.ts`**

Append to `src/utils/storage.ts`:

```ts
const CHUNKS_SUBDIR = path.join(AUDIO_SUBDIR, "chunks");

export function chunkDirFor(dataRoot: string, recordingId: number): string {
  return path.join(dataRoot, CHUNKS_SUBDIR, String(recordingId));
}

export function chunkPathFor(dataRoot: string, recordingId: number, idx: number): string {
  return path.join(chunkDirFor(dataRoot, recordingId), `${idx}.mp3`);
}

export function writeChunkFile(
  dataRoot: string,
  recordingId: number,
  idx: number,
  buffer: Buffer
): string {
  const relative = path.join(CHUNKS_SUBDIR, String(recordingId), `${idx}.mp3`);
  const full = path.join(dataRoot, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return relative;
}

export function deleteChunkDir(dataRoot: string, recordingId: number): void {
  const dir = chunkDirFor(dataRoot, recordingId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/utils/storage.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/storage.ts tests/utils/storage.test.ts
git commit -m "Add chunk-file storage helpers"
```

---

## Task 7: Worker module — happy path

**Files:**
- Create: `src/services/worker.ts`
- Create: `tests/services/worker.test.ts`

- [ ] **Step 1: Write failing happy-path test**

Create `tests/services/worker.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, type DB } from "../../src/db";
import { insertPendingRecording, getRecording } from "../../src/services/recordings";
import { insertChunks } from "../../src/services/recording_chunks";
import { createWorker, type Worker } from "../../src/services/worker";

let db: DB;
let dataRoot: string;
let worker: Worker;

beforeEach(() => {
  db = openDb(":memory:");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-worker-"));
  process.env.OPENAI_API_KEY = "test";
});
afterEach(() => {
  worker?.shutdown();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function mockOpenAiOk() {
  globalThis.fetch = vi.fn(async () =>
    new Response(Buffer.from([1, 2, 3, 4]), { status: 200 })
  ) as any;
}

function seedPending(chunks: string[]): number {
  const rec = insertPendingRecording(db, {
    project_id: 1,
    title: "T",
    original_text: chunks.join(""),
    voice: "alloy",
    model: "tts-1",
    progress_total: chunks.length,
  });
  insertChunks(db, rec.id, chunks);
  return rec.id;
}

describe("worker happy path", () => {
  it("processes all chunks and marks recording as done", async () => {
    mockOpenAiOk();
    worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
    const id = seedPending(["aa", "bb", "cc"]);

    await worker.enqueueAndAwait(id);

    const rec = getRecording(db, id);
    expect(rec.status).toBe("done");
    expect(rec.progress_done).toBe(3);
    expect(rec.file_path).toMatch(/^audio\/.+\.mp3$/);
    expect(rec.file_size).toBe(4 * 3); // 4-byte mock × 3 chunks
    expect(rec.duration_ms).toBeGreaterThanOrEqual(0);

    // Final file exists, chunk dir is gone.
    expect(fs.existsSync(path.join(dataRoot, rec.file_path!))).toBe(true);
    expect(fs.existsSync(path.join(dataRoot, "audio", "chunks", String(id)))).toBe(false);
  });
});
```

(`enqueueAndAwait` is a test-only API on the worker that resolves once the job ends.)

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/services/worker.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Implement worker**

Create `src/services/worker.ts`:

```ts
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { DB } from "../db";
import { generateChunkBuffer } from "./tts";
import {
  listPendingChunks,
  markChunkDone,
  markChunkFailed,
} from "./recording_chunks";
import {
  incrementProgressDone,
  markRecordingDone,
  markRecordingFailed,
  type RecordingRow,
} from "./recordings";
import {
  writeChunkFile,
  deleteChunkDir,
  chunkPathFor,
  writeAudioFile,
} from "../utils/storage";
import { concatFiles } from "../utils/concat";
import { measureDurationMs } from "../utils/audio";
import fs from "fs";
import { ApiError } from "../utils/errors";

export interface WorkerOptions {
  db: DB;
  dataRoot: string;
  /** Test hook: override retry backoff. */
  retryBackoffMs?: (attempt: number) => number;
}

export interface Worker {
  enqueue(recordingId: number): void;
  cancel(recordingId: number): void;
  isQueued(recordingId: number): boolean;
  /** Test-only: enqueue and resolve when the job has ended. */
  enqueueAndAwait(recordingId: number): Promise<void>;
  shutdown(): void;
}

export function createWorker(opts: WorkerOptions): Worker {
  const queue: number[] = [];
  const cancelFlags = new Set<number>();
  const completionWaiters = new Map<number, () => void>();
  let running = false;
  let stopped = false;

  function enqueue(id: number): void {
    if (stopped) return;
    if (!queue.includes(id)) queue.push(id);
    void tick();
  }

  function cancel(id: number): void {
    cancelFlags.add(id);
  }

  function isQueued(id: number): boolean {
    return queue.includes(id);
  }

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      while (queue.length > 0 && !stopped) {
        const id = queue.shift()!;
        await processOne(id).catch((e) => {
          console.error(`worker: unexpected error on recording ${id}`, e);
        });
        const wake = completionWaiters.get(id);
        if (wake) {
          completionWaiters.delete(id);
          wake();
        }
      }
    } finally {
      running = false;
    }
  }

  async function processOne(recordingId: number): Promise<void> {
    const rec = opts.db
      .prepare("SELECT * FROM recordings WHERE id = ?")
      .get(recordingId) as RecordingRow | undefined;
    if (!rec || rec.status !== "generating") return;

    const pending = listPendingChunks(opts.db, recordingId);

    for (const chunk of pending) {
      if (cancelFlags.has(recordingId)) {
        cancelFlags.delete(recordingId);
        return; // Cancel handler has already / will delete the row.
      }

      let buf: Buffer;
      try {
        buf = await generateChunkBuffer(
          { text: chunk.text, voice: rec.voice, model: rec.model },
          opts.retryBackoffMs ? { backoffMs: opts.retryBackoffMs } : {}
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        opts.db.transaction(() => {
          markChunkFailed(opts.db, recordingId, chunk.idx, msg);
          markRecordingFailed(opts.db, recordingId, msg);
        })();
        console.error(
          `worker: recording ${recordingId} chunk ${chunk.idx} failed: ${msg}`
        );
        return;
      }

      const relPath = writeChunkFile(opts.dataRoot, recordingId, chunk.idx, buf);
      opts.db.transaction(() => {
        markChunkDone(opts.db, recordingId, chunk.idx, relPath, buf.length);
        incrementProgressDone(opts.db, recordingId);
      })();
      console.log(
        `worker: recording ${recordingId} chunk ${chunk.idx + 1}/${rec.progress_total} ok`
      );
    }

    // All chunks done — concat into final file.
    const all = opts.db
      .prepare(
        `SELECT idx, file_path FROM recording_chunks
          WHERE recording_id = ? ORDER BY idx ASC`
      )
      .all(recordingId) as Array<{ idx: number; file_path: string }>;

    if (all.some((c) => !c.file_path)) {
      // Resume race: someone reset chunks between the loop and now. Bail; next enqueue picks it up.
      return;
    }

    const inputAbs = all.map((c) => path.join(opts.dataRoot, c.file_path));
    const finalName = `${uuidv4()}.mp3`;

    let finalRel: string;
    try {
      // Concat first into a temp file under audio/, then rename.
      const tempBuf = Buffer.concat(
        inputAbs.map((p) => fs.readFileSync(p))
      ); // small enough — true streaming concat used for production volume comes via concatFiles in next refactor.
      finalRel = writeAudioFile(opts.dataRoot, finalName, tempBuf);
    } catch (e) {
      const msg = "Datei konnte nicht gespeichert werden";
      markRecordingFailed(opts.db, recordingId, msg);
      console.error(`worker: recording ${recordingId} concat failed`, e);
      return;
    }

    let durationMs = 0;
    try {
      durationMs = await measureDurationMs(fs.readFileSync(path.join(opts.dataRoot, finalRel)));
    } catch {
      // measureDurationMs failures are non-fatal — leave duration at 0.
    }

    opts.db.transaction(() => {
      markRecordingDone(opts.db, recordingId, {
        file_path: finalRel,
        file_size: fs.statSync(path.join(opts.dataRoot, finalRel)).size,
        duration_ms: durationMs,
      });
      opts.db.prepare("DELETE FROM recording_chunks WHERE recording_id = ?").run(recordingId);
    })();
    deleteChunkDir(opts.dataRoot, recordingId);
  }

  function enqueueAndAwait(id: number): Promise<void> {
    return new Promise((resolve) => {
      completionWaiters.set(id, resolve);
      enqueue(id);
    });
  }

  function shutdown(): void {
    stopped = true;
  }

  return { enqueue, cancel, isQueued, enqueueAndAwait, shutdown };
}
```

(Note: the implementation here uses `Buffer.concat` for concat instead of streaming `concatFiles` — a deliberate first-pass simplification. Task 13 swaps to streaming.)

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/services/worker.test.ts`
Expected: happy-path test passes.

- [ ] **Step 5: Commit**

```bash
git add src/services/worker.ts tests/services/worker.test.ts
git commit -m "Add worker (happy path)"
```

---

## Task 8: Worker — failure path

**Files:**
- Modify: `tests/services/worker.test.ts`

- [ ] **Step 1: Add failing test for hard failure**

Append to `tests/services/worker.test.ts` (inside a new describe):

```ts
describe("worker failure path", () => {
  it("marks recording failed with error after retries exhausted", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 429 })
    ) as any;
    worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
    const id = seedPending(["a", "b"]);

    await worker.enqueueAndAwait(id);

    const rec = getRecording(db, id);
    expect(rec.status).toBe("failed");
    expect(rec.error).toMatch(/429/);
    expect(rec.progress_done).toBe(0);
  });

  it("preserves done chunks when a later chunk fails", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n++;
      if (n <= 1) return new Response(Buffer.from([1, 2]), { status: 200 });
      return new Response("boom", { status: 400 });
    }) as any;
    worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
    const id = seedPending(["good", "bad"]);

    await worker.enqueueAndAwait(id);

    const rec = getRecording(db, id);
    expect(rec.status).toBe("failed");
    expect(rec.progress_done).toBe(1);
    // Chunk 0 file still on disk for resume.
    expect(fs.existsSync(path.join(dataRoot, "audio", "chunks", String(id), "0.mp3"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect pass (worker logic from Task 7 already handles this)**

Run: `npx vitest run tests/services/worker.test.ts`
Expected: pass. If not, adjust worker implementation accordingly.

- [ ] **Step 3: Commit**

```bash
git add tests/services/worker.test.ts
git commit -m "Verify worker failure preserves done chunks"
```

---

## Task 9: Worker — cancel path

**Files:**
- Modify: `tests/services/worker.test.ts`
- Modify: `src/services/worker.ts` (if needed)

- [ ] **Step 1: Add failing test**

Append:

```ts
describe("worker cancel", () => {
  it("stops between chunks when cancel flag is set", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      // After first chunk, ask the worker to cancel before the second starts.
      if (calls === 1 && worker) worker.cancel(activeId);
      return new Response(Buffer.from([1]), { status: 200 });
    }) as any;

    worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
    const activeId = seedPending(["a", "b", "c"]);

    await worker.enqueueAndAwait(activeId);

    expect(calls).toBe(1); // second chunk never reached
    const rec = getRecording(db, activeId);
    // Worker leaves status='generating' on cancel; the cancel route is what
    // deletes the row. Here we just verify the worker stopped without writing
    // chunk 1 or finalizing.
    expect(rec.status).toBe("generating");
    expect(rec.progress_done).toBe(1);
  });
});
```

- [ ] **Step 2: Run; if it fails, ensure the worker checks `cancelFlags` *before* each chunk's OpenAI call, not just at the very top of the loop**

Confirm in `worker.ts` that the cancel check is the first statement inside the `for (const chunk of pending)` loop. (Already so per Task 7; this test verifies.)

Run: `npx vitest run tests/services/worker.test.ts`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/services/worker.test.ts src/services/worker.ts
git commit -m "Verify worker honors cancel flag between chunks"
```

---

## Task 10: Worker — resume path

**Files:**
- Modify: `tests/services/worker.test.ts`

- [ ] **Step 1: Add failing test**

Append:

```ts
describe("worker resume", () => {
  it("regenerates only failed chunks on retry", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      // chunks 0..2 succeed first time; chunk 3 fails first time, succeeds on retry round.
      if (n === 4) return new Response("boom", { status: 400 });
      return new Response(Buffer.from([7, 7]), { status: 200 });
    });
    globalThis.fetch = fetchMock as any;
    worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
    const id = seedPending(["a", "b", "c", "d"]);

    await worker.enqueueAndAwait(id);
    expect(getRecording(db, id).status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Simulate the retry endpoint: reset failed chunk and progress_done.
    const { resetFailedChunks } = await import("../../src/services/recording_chunks");
    const { resetForRetry } = await import("../../src/services/recordings");
    resetFailedChunks(db, id);
    resetForRetry(db, id, 3);

    await worker.enqueueAndAwait(id);

    const rec = getRecording(db, id);
    expect(rec.status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(5); // only the failed chunk was re-fetched
  });
});
```

- [ ] **Step 2: Run, expect pass**

Run: `npx vitest run tests/services/worker.test.ts`
Expected: pass. The worker iterates `listPendingChunks`, which already excludes `done` chunks — so this should work without code changes.

- [ ] **Step 3: Commit**

```bash
git add tests/services/worker.test.ts
git commit -m "Verify worker resume regenerates only failed chunks"
```

---

## Task 11: Crash-recovery hook

**Files:**
- Create: `src/utils/recovery.ts`
- Create: `tests/utils/recovery.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/utils/recovery.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, type DB } from "../../src/db";
import { insertPendingRecording, getRecording } from "../../src/services/recordings";
import { insertChunks, markChunkDone } from "../../src/services/recording_chunks";
import { writeChunkFile } from "../../src/utils/storage";
import { reconcileOnStartup } from "../../src/utils/recovery";

let db: DB;
let dataRoot: string;
beforeEach(() => {
  db = openDb(":memory:");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-recovery-"));
});
afterEach(() => fs.rmSync(dataRoot, { recursive: true, force: true }));

describe("reconcileOnStartup", () => {
  it("flips 'generating' rows to 'failed' with a clear error", () => {
    const r = insertPendingRecording(db, {
      project_id: 1, title: "T", original_text: "x", voice: "alloy",
      model: "tts-1", progress_total: 3,
    });
    reconcileOnStartup(db, dataRoot);
    const fetched = getRecording(db, r.id);
    expect(fetched.status).toBe("failed");
    expect(fetched.error).toMatch(/neugestartet/);
  });

  it("demotes 'done' chunks whose file is missing back to 'pending'", () => {
    const r = insertPendingRecording(db, {
      project_id: 1, title: "T", original_text: "x", voice: "alloy",
      model: "tts-1", progress_total: 2,
    });
    insertChunks(db, r.id, ["a", "b"]);
    writeChunkFile(dataRoot, r.id, 0, Buffer.from([1]));
    markChunkDone(db, r.id, 0, path.join("audio", "chunks", String(r.id), "0.mp3"), 1);
    markChunkDone(db, r.id, 1, path.join("audio", "chunks", String(r.id), "1.mp3"), 1);
    // file for idx=1 was never created.

    reconcileOnStartup(db, dataRoot);

    const rows = db.prepare(
      "SELECT idx, status FROM recording_chunks WHERE recording_id = ? ORDER BY idx"
    ).all(r.id) as Array<{ idx: number; status: string }>;
    expect(rows[0].status).toBe("done");
    expect(rows[1].status).toBe("pending");
  });

  it("removes orphan chunk dirs without a DB row", () => {
    const orphanDir = path.join(dataRoot, "audio", "chunks", "9999");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "0.mp3"), Buffer.from([0]));

    reconcileOnStartup(db, dataRoot);

    expect(fs.existsSync(orphanDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/utils/recovery.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Create `src/utils/recovery.ts`:

```ts
import fs from "fs";
import path from "path";
import type { DB } from "../db";

const CRASH_MESSAGE = "Server wurde während der Generierung neugestartet";

export function reconcileOnStartup(db: DB, dataRoot: string): void {
  // 1. generating -> failed
  db.prepare(
    `UPDATE recordings
        SET status = 'failed', error = ?
      WHERE status = 'generating'`
  ).run(CRASH_MESSAGE);

  // 2. demote 'done' chunks whose file is missing
  const doneChunks = db
    .prepare(
      "SELECT recording_id, idx, file_path FROM recording_chunks WHERE status = 'done'"
    )
    .all() as Array<{ recording_id: number; idx: number; file_path: string | null }>;
  for (const c of doneChunks) {
    if (!c.file_path) continue;
    const abs = path.join(dataRoot, c.file_path);
    if (!fs.existsSync(abs)) {
      db.prepare(
        `UPDATE recording_chunks
            SET status = 'pending', file_path = NULL, byte_size = NULL, error = NULL
          WHERE recording_id = ? AND idx = ?`
      ).run(c.recording_id, c.idx);
    }
  }

  // 3. orphan chunk-dir cleanup
  const chunksRoot = path.join(dataRoot, "audio", "chunks");
  if (!fs.existsSync(chunksRoot)) return;
  const knownIds = new Set(
    (db.prepare("SELECT id FROM recordings").all() as Array<{ id: number }>).map((r) => r.id)
  );
  for (const entry of fs.readdirSync(chunksRoot)) {
    const id = Number(entry);
    if (!Number.isFinite(id) || !knownIds.has(id)) {
      fs.rmSync(path.join(chunksRoot, entry), { recursive: true, force: true });
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/utils/recovery.test.ts`
Expected: pass.

- [ ] **Step 5: Wire into `server.ts`**

Modify `src/server.ts` after `const db = openDb(...)` and before `createApp`:

```ts
import { reconcileOnStartup } from "./utils/recovery";
import { createWorker } from "./services/worker";
// ...
const db = openDb(path.join(DATA_ROOT, "aria.db"));
reconcileOnStartup(db, DATA_ROOT);
const worker = createWorker({ db, dataRoot: DATA_ROOT });
const app = createApp({ db, dataRoot: DATA_ROOT, worker });
```

(`AppDeps` will be updated in Task 12 to include the worker; for now this introduces a type error, which Task 12 fixes.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/recovery.ts tests/utils/recovery.test.ts src/server.ts
git commit -m "Add startup reconciliation for crash recovery"
```

---

## Task 12: Async POST `/api/recordings`

**Files:**
- Modify: `src/app.ts:11-14` (`AppDeps` adds `worker`)
- Modify: `src/routes/recordings.ts:88-152` (replace POST handler)
- Modify: `tests/routes/recordings.test.ts` (existing tests need worker plumbing)

- [ ] **Step 1: Update `AppDeps`**

Modify `src/app.ts`:

```ts
import type { Worker } from "./services/worker";

export interface AppDeps {
  db: DB;
  dataRoot: string;
  worker: Worker;
}
```

- [ ] **Step 2: Update existing route tests to provide a worker**

Modify `tests/routes/recordings.test.ts` `beforeEach`:

```ts
import { createWorker, type Worker } from "../../src/services/worker";

let worker: Worker;

beforeEach(() => {
  db = openDb(":memory:");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-test-"));
  worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
  app = createApp({ db, dataRoot, worker });
});

afterEach(() => {
  worker.shutdown();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});
```

The existing happy-path test (`creates a recording end-to-end with mocked OpenAI`) currently asserts a synchronous `201` with `duration_ms > 0`. Update it to:

```ts
it("submits a recording and worker finishes it asynchronously", async () => {
  const fakeMp3 = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
  globalThis.fetch = vi.fn(async () =>
    new Response(fakeMp3, { status: 200 })
  ) as any;

  const res = await request(app)
    .post("/api/recordings")
    .field("text", "Hallo Welt")
    .field("voice", "alloy")
    .field("model", "tts-1")
    .field("tags[]", "hello");

  expect(res.status).toBe(202);
  expect(res.body.status).toBe("generating");
  expect(res.body.progress_total).toBeGreaterThanOrEqual(1);
  expect(res.body.file_path).toBeNull();

  await worker.enqueueAndAwait(res.body.id);

  const after = await request(app).get(`/api/recordings/${res.body.id}`);
  expect(after.body.status).toBe("done");
  expect(after.body.duration_ms).toBeGreaterThan(0);
  expect(after.body.tags.map((t: any) => t.name)).toEqual(["hello"]);
});
```

The `audio + download` describe block also creates recordings via POST and expects sync completion. Update each setup to await the worker:

```ts
const created = (await request(app).post("/api/recordings")...).body;
await worker.enqueueAndAwait(created.id);
```

The "rejects unknown project_id before calling OpenAI" test stays as-is in spirit (still 400 + no fetch), but expectation needs to change because validation runs *before* enqueue: assert `400` + `fetchMock.not.toHaveBeenCalled()` still hold.

- [ ] **Step 3: Run tests, expect failures (route still synchronous)**

Run: `npx vitest run tests/routes/recordings.test.ts`
Expected: tests fail because POST returns 201 not 202.

- [ ] **Step 4: Replace POST handler in `src/routes/recordings.ts`**

Replace the `router.post("/", upload.single("file"), ...)` block with:

```ts
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
      if (!projectExists) throw new ApiError(400, `Project ${projectId} does not exist`);

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
```

Add the imports near the top of `routes/recordings.ts`:

```ts
import { splitTextIntoChunks } from "../services/tts";
import { insertPendingRecording } from "../services/recordings";
import { insertChunks } from "../services/recording_chunks";
```

Remove the now-unused imports (`generateTtsBuffer`, `writeAudioFile`, `measureDurationMs`, `uuidv4`, `audioPathFor` stays — used for `:id/audio`).

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run tests/routes/recordings.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/routes/recordings.ts tests/routes/recordings.test.ts
git commit -m "Make POST /api/recordings async (202 + background worker)"
```

---

## Task 13: Cancel and retry endpoints

**Files:**
- Modify: `src/routes/recordings.ts` (add two new routes; modify DELETE to cancel-then-delete)
- Modify: `tests/routes/recordings.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/routes/recordings.test.ts`:

```ts
describe("cancel and retry endpoints", () => {
  it("POST /:id/cancel deletes a generating recording + chunk files", async () => {
    // Block fetch so the worker doesn't finish before we cancel.
    let resolveFetch: (r: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((res) => { resolveFetch = res; })
    ) as any;

    const created = (await request(app)
      .post("/api/recordings")
      .field("text", "x".repeat(8000)) // 2 chunks
      .field("voice", "alloy")
      .field("model", "tts-1")).body;

    expect(created.status).toBe("generating");

    const cancelled = await request(app).post(`/api/recordings/${created.id}/cancel`);
    expect(cancelled.status).toBe(204);

    // Allow the in-flight fetch to resolve so the worker observes cancel.
    resolveFetch!(new Response(Buffer.from([1]), { status: 200 }));
    await worker.enqueueAndAwait(created.id);

    const after = await request(app).get(`/api/recordings/${created.id}`);
    expect(after.status).toBe(404);
    expect(fs.existsSync(path.join(dataRoot, "audio", "chunks", String(created.id)))).toBe(false);
  });

  it("POST /:id/cancel returns 409 if not generating", async () => {
    const r = seed();
    db.prepare("UPDATE recordings SET status='done' WHERE id=?").run(r.id);
    const res = await request(app).post(`/api/recordings/${r.id}/cancel`);
    expect(res.status).toBe(409);
  });

  it("POST /:id/retry resets failed chunks and re-enqueues", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n++;
      if (n === 2) return new Response("boom", { status: 400 });
      return new Response(Buffer.from([1, 2]), { status: 200 });
    }) as any;

    const created = (await request(app).post("/api/recordings")
      .field("text", "x".repeat(8000))
      .field("voice", "alloy")
      .field("model", "tts-1")).body;
    await worker.enqueueAndAwait(created.id);

    expect((await request(app).get(`/api/recordings/${created.id}`)).body.status).toBe("failed");

    // Make the next attempt succeed.
    globalThis.fetch = vi.fn(async () =>
      new Response(Buffer.from([1, 2]), { status: 200 })
    ) as any;

    const retry = await request(app).post(`/api/recordings/${created.id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe("generating");

    await worker.enqueueAndAwait(created.id);
    expect((await request(app).get(`/api/recordings/${created.id}`)).body.status).toBe("done");
  });

  it("POST /:id/retry returns 409 if not failed", async () => {
    const r = seed();
    const res = await request(app).post(`/api/recordings/${r.id}/retry`);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npx vitest run tests/routes/recordings.test.ts`
Expected: 404s for the two new routes.

- [ ] **Step 3: Implement routes**

Add to `src/routes/recordings.ts` inside `recordingsRouter` (before `return router;`):

```ts
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
    const filePath = rec.file_path;
    deps.db.prepare("DELETE FROM recordings WHERE id = ?").run(id);
    if (filePath) deleteAudioFile(deps.dataRoot, filePath);
    deleteChunkDir(deps.dataRoot, id);

    res.status(204).end();
  } catch (e) { next(e); }
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
  } catch (e) { next(e); }
});
```

Add imports at the top of the file:

```ts
import { deleteChunkDir } from "../utils/storage";
import {
  resetFailedChunks,
  countDoneChunks,
} from "../services/recording_chunks";
import { resetForRetry } from "../services/recordings";
```

Also modify `DELETE /:id` so it cancels first if needed:

```ts
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
  } catch (e) { next(e); }
});
```

(`deleteRecordingRow` currently expects a string return; with `file_path` now nullable it should return `string | null`. Update its signature in `services/recordings.ts`.)

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/routes/recordings.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/recordings.ts src/services/recordings.ts tests/routes/recordings.test.ts
git commit -m "Add cancel + retry endpoints, harden DELETE for in-flight recordings"
```

---

## Task 14: Audio endpoint guard + streaming concat upgrade

**Files:**
- Modify: `src/routes/recordings.ts:154-173` (audio + download routes)
- Modify: `src/services/worker.ts` (replace `Buffer.concat` with `concatFiles`)
- Modify: `tests/routes/recordings.test.ts`

- [ ] **Step 1: Failing test for audio guard**

Append to route tests:

```ts
it("GET /:id/audio returns 404 while still generating", async () => {
  let resolveFetch: (r: Response) => void;
  globalThis.fetch = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; })) as any;
  const created = (await request(app).post("/api/recordings")
    .field("text", "x".repeat(8000))
    .field("voice", "alloy").field("model", "tts-1")).body;

  const res = await request(app).get(`/api/recordings/${created.id}/audio`);
  expect(res.status).toBe(404);

  resolveFetch!(new Response(Buffer.from([1]), { status: 200 }));
  await worker.enqueueAndAwait(created.id);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/routes/recordings.test.ts`
Expected: route currently returns 200 (or fails because file_path is null).

- [ ] **Step 3: Update audio route**

In `src/routes/recordings.ts`:

```ts
router.get("/:id/audio", (req, res, next) => {
  try {
    const rec = getRecording(deps.db, Number(req.params.id));
    if (rec.status !== "done" || !rec.file_path) {
      throw new ApiError(404, "Recording is not ready");
    }
    const fullPath = audioPathFor(deps.dataRoot, rec.file_path);
    res.type("audio/mpeg");
    res.sendFile(fullPath);
  } catch (e) { next(e); }
});

router.get("/:id/download", (req, res, next) => {
  try {
    const rec = getRecording(deps.db, Number(req.params.id));
    if (rec.status !== "done" || !rec.file_path) {
      throw new ApiError(404, "Recording is not ready");
    }
    const fullPath = audioPathFor(deps.dataRoot, rec.file_path);
    res.download(fullPath, `${rec.title.replace(/[^\w\-_.\s]/g, "_")}.mp3`);
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Replace `Buffer.concat` with `concatFiles` in worker**

In `src/services/worker.ts`, replace the concat block with:

```ts
import { concatFiles } from "../utils/concat";
// ...
const inputAbs = all.map((c) => path.join(opts.dataRoot, c.file_path!));
const finalName = `${uuidv4()}.mp3`;
const finalRel = path.join("audio", finalName);
const finalAbs = path.join(opts.dataRoot, finalRel);

try {
  await concatFiles(inputAbs, finalAbs);
} catch (e) {
  const msg = "Datei konnte nicht gespeichert werden";
  markRecordingFailed(opts.db, recordingId, msg);
  console.error(`worker: recording ${recordingId} concat failed`, e);
  return;
}

let durationMs = 0;
try {
  durationMs = await measureDurationMs(fs.readFileSync(finalAbs));
} catch { /* non-fatal */ }

opts.db.transaction(() => {
  markRecordingDone(opts.db, recordingId, {
    file_path: finalRel,
    file_size: fs.statSync(finalAbs).size,
    duration_ms: durationMs,
  });
  opts.db.prepare("DELETE FROM recording_chunks WHERE recording_id = ?").run(recordingId);
})();
deleteChunkDir(opts.dataRoot, recordingId);
```

Drop the unused `writeAudioFile` import from the worker.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/recordings.ts src/services/worker.ts tests/routes/recordings.test.ts
git commit -m "Guard audio endpoints + use streaming concat"
```

---

## Task 15: Frontend — types, modal, API client

**Files:**
- Modify: `src/public/api.ts`
- Modify: `src/public/generate.ts:114-147` (submit handler)

- [ ] **Step 1: Update `Recording` type and add cancel/retry**

Replace the `Recording` interface and add helpers in `src/public/api.ts`:

```ts
export type RecordingStatus = "generating" | "done" | "failed";

export interface Recording {
  id: number;
  project_id: number;
  title: string;
  original_text: string;
  voice: string;
  model: string;
  status: RecordingStatus;
  progress_total: number;
  progress_done: number;
  error: string | null;
  file_path: string | null;
  file_size: number | null;
  duration_ms: number | null;
  created_at: string;
  tags: Tag[];
}
```

Add to `api`:

```ts
cancelRecording: (id: number) =>
  jsonFetch<void>(`/api/recordings/${id}/cancel`, { method: "POST" }),
retryRecording: (id: number) =>
  jsonFetch<Recording>(`/api/recordings/${id}/retry`, { method: "POST" }),
```

- [ ] **Step 2: Update modal submit**

In `src/public/generate.ts:114-147`, replace the submit handler body:

```ts
submitBtn.addEventListener("click", async () => {
  const text = textEl.value.trim();
  if (!text) {
    showError("Bitte Text eingeben.");
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = "Wird gesendet…";
  errorEl.style.display = "none";
  try {
    const form = new FormData();
    form.append("text", text);
    form.append("voice", voiceEl.value);
    form.append("model", modelEl.value);
    form.append("project_id", projectEl.value);
    if (titleEl.value.trim()) form.append("title", titleEl.value.trim());
    const tags = tagsEl.value.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    for (const t of tags) form.append("tags[]", t);

    await api.generateRecording(form);
    close();
    document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    const [projects, tagsList] = await Promise.all([api.listProjects(), api.listTags()]);
    store.set({ projects, tags: tagsList });
  } catch (e) {
    showError((e as Error).message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Generieren";
  }
});
```

(The submit no longer waits for generation. Modal closes as soon as the 202 lands.)

- [ ] **Step 3: Smoke build**

Run: `npm run build`
Expected: TypeScript compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/public/api.ts src/public/generate.ts
git commit -m "Update frontend types + close modal on submit"
```

---

## Task 16: Frontend — polling module

**Files:**
- Create: `src/public/polling.ts`

- [ ] **Step 1: Create the module**

Create `src/public/polling.ts`:

```ts
import { api, type Recording } from "./api.js";

const PENDING = new Set<number>();
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 1000;

export function register(id: number): void {
  PENDING.add(id);
  ensureTimer();
}

export function unregister(id: number): void {
  PENDING.delete(id);
  if (PENDING.size === 0) stopTimer();
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(tick, TICK_MS);
}

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (PENDING.size === 0) {
    stopTimer();
    return;
  }
  const ids = [...PENDING];
  const results = await Promise.allSettled(ids.map((id) => api.getRecording(id)));
  results.forEach((res, i) => {
    const id = ids[i];
    if (res.status === "rejected") return; // try again next tick
    const rec: Recording = res.value;
    document.dispatchEvent(new CustomEvent("aria:recording-updated", { detail: rec }));
    if (rec.status !== "generating") {
      PENDING.delete(id);
    }
  });
  if (PENDING.size === 0) stopTimer();
}
```

- [ ] **Step 2: Smoke build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/public/polling.ts
git commit -m "Add frontend polling module"
```

---

## Task 17: Frontend — pending and failed card variants

**Files:**
- Modify: `src/public/card.ts` (full rewrite of `renderCard`, keep helpers)
- Modify: `src/public/library.ts` (register pending recordings on reload + listen for updates)
- Modify: `src/public/style.css`

- [ ] **Step 1: Update `card.ts`**

At the top of `src/public/card.ts`:

```ts
import type { Recording } from "./api.js";
import { api } from "./api.js";
import { store } from "./state.js";
import { register as registerPolling } from "./polling.js";
```

Replace `renderCard` so it dispatches by status. The card always carries `data-recording-id="..."` so updates can target it:

```ts
export function renderCard(r: Recording): HTMLElement {
  const card = document.createElement("div");
  card.className = `card card-status-${r.status}`;
  card.dataset.recordingId = String(r.id);

  if (r.status === "generating") {
    card.appendChild(renderHeader(r));
    card.appendChild(renderGeneratingBody(r));
    registerPolling(r.id);
    return card;
  }
  if (r.status === "failed") {
    card.appendChild(renderHeader(r));
    card.appendChild(renderFailedBody(r));
    return card;
  }
  // done
  card.appendChild(renderHeader(r));
  card.appendChild(renderMeta(r));
  card.appendChild(renderTags(r));
  card.appendChild(renderAudio(r));
  return card;
}

function renderGeneratingBody(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-generating";

  const bar = document.createElement("progress");
  bar.value = r.progress_done;
  bar.max = r.progress_total || 1;
  bar.className = "progress-bar";
  wrap.appendChild(bar);

  const status = document.createElement("div");
  status.className = "card-progress-status";
  status.textContent = "Vertonung läuft…";
  wrap.appendChild(status);

  const detail = document.createElement("div");
  detail.className = "card-progress-detail";
  detail.textContent = formatProgressDetail(r);
  wrap.appendChild(detail);

  const cancel = document.createElement("button");
  cancel.className = "btn-ghost";
  cancel.textContent = "Abbrechen";
  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    cancel.textContent = "Wird abgebrochen…";
    try {
      await api.cancelRecording(r.id);
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    } catch (e) {
      cancel.disabled = false;
      cancel.textContent = "Abbrechen";
      alert((e as Error).message);
    }
  });
  wrap.appendChild(cancel);

  return wrap;
}

function renderFailedBody(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-failed";

  const banner = document.createElement("div");
  banner.className = "fail-banner";
  banner.textContent = r.error ?? "Vertonung fehlgeschlagen";
  wrap.appendChild(banner);

  const actions = document.createElement("div");
  actions.className = "card-failed-actions";

  const retry = document.createElement("button");
  retry.className = "btn-primary";
  retry.textContent = "Erneut versuchen";
  retry.addEventListener("click", async () => {
    retry.disabled = true;
    try {
      const updated = await api.retryRecording(r.id);
      registerPolling(updated.id);
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    } catch (e) {
      retry.disabled = false;
      alert((e as Error).message);
    }
  });
  actions.appendChild(retry);

  const del = document.createElement("button");
  del.className = "btn-ghost";
  del.textContent = "Löschen";
  del.addEventListener("click", async () => {
    if (!confirm(`Aufnahme "${r.title}" wirklich löschen?`)) return;
    await api.deleteRecording(r.id);
    document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
  });
  actions.appendChild(del);

  wrap.appendChild(actions);
  return wrap;
}

function formatProgressDetail(r: Recording): string {
  // "Abschnitt 3 von 8" — 1-based, the chunk currently being worked on.
  const current = Math.min(r.progress_done + 1, r.progress_total);
  return `Abschnitt ${current} von ${r.progress_total}`;
}

export function applyRecordingUpdate(r: Recording): void {
  const el = document.querySelector<HTMLElement>(
    `.card[data-recording-id="${r.id}"]`
  );
  if (!el) return;

  if (el.classList.contains(`card-status-${r.status}`)) {
    // Same status, just update progress bar + detail.
    if (r.status === "generating") {
      const bar = el.querySelector<HTMLProgressElement>("progress.progress-bar");
      const detail = el.querySelector<HTMLElement>(".card-progress-detail");
      if (bar) { bar.value = r.progress_done; bar.max = r.progress_total || 1; }
      if (detail) detail.textContent = formatProgressDetail(r);
    }
    return;
  }
  // Status changed — replace the card entirely.
  const fresh = renderCard(r);
  el.replaceWith(fresh);
}
```

The existing `renderHeader`, `renderMeta`, `renderTags`, `renderAudio`, `renderMenu`, `formatDuration`, `formatDate` stay untouched. Note: `renderHeader` currently makes the title `contentEditable`; for `generating` rows that should still work (the title is editable on the pending card too — your call), but the existing menu calls `r.tags`, which is `[]` for newly created pending rows. That's fine, the menu still renders.

To keep edit behavior unchanged for non-`done` rows, leave `renderHeader` as-is — `done`-card UX is unaffected.

- [ ] **Step 2: Wire polling into `library.ts`**

Modify `src/public/library.ts`:

```ts
import { applyRecordingUpdate } from "./card.js";
import { register as registerPolling } from "./polling.js";

export function initLibrary(): void {
  document.addEventListener("aria:reload-recordings", reload);
  document.addEventListener("aria:recording-updated", (ev: Event) => {
    const r = (ev as CustomEvent).detail;
    applyRecordingUpdate(r);
  });
  store.subscribe(() => renderHeader());
  renderHeader();
  reload();
}
```

In `reload()`, after rendering the cards, register all `generating` recordings with the polling module:

```ts
for (const r of recordings) {
  listEl.appendChild(renderCard(r));
}
for (const r of recordings) {
  if (r.status === "generating") registerPolling(r.id);
}
```

- [ ] **Step 3: Add CSS**

Append to `src/public/style.css`:

```css
.card-generating progress.progress-bar {
  width: 100%;
  height: 6px;
  border: none;
  border-radius: 3px;
  background: #f0f0f3;
  overflow: hidden;
  margin: 8px 0 4px;
}
.card-generating progress.progress-bar::-webkit-progress-bar {
  background: #f0f0f3;
  border-radius: 3px;
}
.card-generating progress.progress-bar::-webkit-progress-value {
  background: #2563eb;
  border-radius: 3px;
  transition: width 200ms ease;
}
.card-generating progress.progress-bar::-moz-progress-bar {
  background: #2563eb;
  border-radius: 3px;
}
.card-progress-status { font-size: 14px; color: #1a1a1a; margin-bottom: 2px; }
.card-progress-detail { font-size: 12px; color: #888; margin-bottom: 12px; }

.card-status-generating { opacity: 0.95; }
.card-status-failed .fail-banner {
  background: #fee;
  color: #c00;
  padding: 10px 12px;
  border-radius: 6px;
  margin: 8px 0 12px;
  font-size: 13px;
}
.card-failed-actions { display: flex; gap: 8px; }
```

- [ ] **Step 4: Build, smoke-test in browser**

Run: `npm run build && npm start`

Open `http://localhost:3000`. Mock OpenAI is not active; use a small real text (≤ 4000 chars, single chunk) to verify modal closes immediately, card appears as `generating`, then flips to `done`. Then with a longer text (e.g. 12 000 chars), verify the progress bar advances.

Expected: progress works, no console errors. (If `OPENAI_API_KEY` is missing, the modal shows the pre-flight 500 — that's correct behavior.)

- [ ] **Step 5: Commit**

```bash
git add src/public/card.ts src/public/library.ts src/public/style.css
git commit -m "Add generating/failed card variants + polling integration"
```

---

## Task 18: README + spec wrap-up

**Files:**
- Modify: `README.md` — note async behavior, retry/cancel
- Verify: spec already documents everything; nothing to change

- [ ] **Step 1: Update README**

In `README.md`, replace the "Features" section's last bullet (`Automatisches Chunking…`) with two:

```md
- Automatisches Chunking langer Texte (> 4000 Zeichen) mit Live-Fortschrittsanzeige
- Resume bei Fehlern (z. B. Rate Limit) — bereits erzeugte Abschnitte werden nicht neu generiert
```

In the "Aufnahmen" API list, change the entry for `POST /api/recordings`:

```md
- `POST /api/recordings` — multipart oder JSON: `text`, `voice`, `model`, `project_id?`, `tags?`, `title?`, `file?`. Antwortet `202 Accepted`, Generierung läuft asynchron.
- `POST /api/recordings/:id/cancel` — laufende Generierung abbrechen, Aufnahme verwerfen.
- `POST /api/recordings/:id/retry` — fehlgeschlagene Aufnahme erneut versuchen (nur fehlende Abschnitte).
```

- [ ] **Step 2: Run full test suite once more**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document async generation and cancel/retry endpoints"
```

---

## Self-Review Checklist (already applied)

- ✅ Spec coverage: every section of the spec maps to at least one task — schema (T1), types (T2), chunks service (T3), TTS retry (T4), concat (T5), storage (T6), worker happy/fail/cancel/resume (T7-T10), recovery (T11), POST async (T12), cancel/retry (T13), audio guard + streaming concat (T14), frontend types/modal (T15), polling (T16), card variants (T17), docs (T18).
- ✅ No "TBD"/"TODO"/placeholders in the plan.
- ✅ Type/method names consistent across tasks: `insertPendingRecording`, `markRecordingDone`, `markRecordingFailed`, `incrementProgressDone`, `resetForRetry`, `resetFailedChunks`, `countDoneChunks`, `enqueue`, `cancel`, `enqueueAndAwait`, `applyRecordingUpdate` — all defined where first used and reused with the same signature later.
- ✅ Each task has TDD red→green→commit cadence.
- ✅ Streaming concat introduced as Task 14 swap-in (rather than being baked into Task 7) so the TDD-driven worker test remains simple.
