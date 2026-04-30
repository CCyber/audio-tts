# Aria — Library & Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erweitere Aria um persistente Aufnahmen, Projekte, Tags, FTS5-Suche, Inline-Player und eine sidebar-basierte Library-UI. Ersetzt das aktuelle 5-min-tmp-Pattern durch dauerhaften Speicher.

**Architecture:** Bestehender Express-Server bekommt SQLite (better-sqlite3) als Persistenz, FTS5 für Volltextsuche, und drei neue Service-Module (projects/tags/recordings). Audio-Dateien liegen persistent in `/app/data/audio/`, DB unter `/app/data/aria.db`. Frontend wird komplett neu strukturiert: Sidebar-Layout mit Projektliste + Tag-Liste links, Aufnahmen-Library rechts, Generate-Dialog als Modal.

**Tech Stack:** Express + TypeScript (vorhanden), `better-sqlite3` für DB, `music-metadata` für MP3-Dauer, `vitest` + `supertest` für Tests, Vanilla TypeScript fürs Frontend.

**Spec:** `docs/superpowers/specs/2026-04-30-aria-library-and-projects-design.md`

---

## File Structure

**Created:**
- `src/db/index.ts` — DB-Open + Migrations + Inbox-Seeding
- `src/db/schema.sql` — Schema-DDL (Tabellen, FTS5, Trigger)
- `src/services/projects.ts` — Projekt-CRUD + Inbox-Schutz
- `src/services/tags.ts` — Tag-Resolve, List-with-Count
- `src/services/recordings.ts` — Recording-CRUD, Filter, FTS5-Suche
- `src/services/tts.ts` — TTS-Generation (Buffer raus, kein Save)
- `src/utils/title.ts` — `deriveTitle(text, max)`
- `src/utils/audio.ts` — `measureDurationMs(buffer)`
- `src/utils/storage.ts` — File-Schreiben/Löschen
- `src/utils/errors.ts` — `ApiError`-Klasse
- `src/routes/projects.ts` — Projekte-Router
- `src/routes/tags.ts` — Tags-Router
- `src/routes/recordings.ts` — Recordings-Router (CRUD + Generate + Audio + Download)
- `src/public/api.ts` — typisierter Frontend-API-Client
- `src/public/sidebar.ts` — Sidebar-Render-Logik
- `src/public/library.ts` — Library-Liste, Suche, Tag-Filter
- `src/public/card.ts` — Aufnahmen-Card-Rendering und Interaktionen
- `src/public/generate.ts` — Generate-Modal
- `src/public/state.ts` — globaler App-State + Event-Bus
- `tests/setup.ts` — Test-Setup (in-memory DB)
- `tests/services/projects.test.ts`
- `tests/services/tags.test.ts`
- `tests/services/recordings.test.ts`
- `tests/services/tts.test.ts`
- `tests/utils/title.test.ts`
- `tests/utils/audio.test.ts`
- `tests/utils/storage.test.ts`
- `tests/routes/projects.test.ts`
- `tests/routes/recordings.test.ts`
- `tests/routes/tags.test.ts`
- `tests/fixtures/silence.mp3` — kleine MP3-Fixture
- `vitest.config.ts`

**Modified:**
- `src/server.ts` — DB-Init beim Boot, neue Router einhängen, alten ttsRouter raus, statische Voices/Models bleiben
- `src/routes/tts.ts` — wird auf `/voices` und `/models` reduziert (Generate-Logik wandert in `services/tts.ts` + `routes/recordings.ts`)
- `src/public/index.html` — komplett neues Layout
- `src/public/style.css` — komplett neues Styling
- `src/public/app.ts` — Bootstrap nur noch
- `package.json` — Dev-Deps (vitest, supertest, @types/supertest), Runtime-Deps (better-sqlite3, music-metadata), `test`-Script
- `Dockerfile` — `mkdir -p /app/data/audio` + Ownership
- `docker-compose.yml` — neues `data`-Volume mounten
- `.gitignore` — `data/` rein, `tmp/` raus
- `README.md` — Library/Projekte-Features dokumentieren

---

## Task 0: Test-Framework + Dependencies installieren

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Dependencies installieren**

Run:
```bash
npm install --save better-sqlite3 music-metadata
npm install --save-dev vitest supertest @types/better-sqlite3 @types/supertest
```

Expected: `package.json` und `package-lock.json` aktualisiert, `node_modules/` enthält die neuen Pakete.

- [ ] **Step 2: `vitest.config.ts` erstellen**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Test-Setup-Datei**

`tests/setup.ts`:

```typescript
// Globaler Test-Setup. Pro Test wird eine eigene in-memory DB erzeugt
// (siehe Helpers in tests/services/*.test.ts), nicht hier global.
process.env.OPENAI_API_KEY = "test-key";
```

- [ ] **Step 4: `package.json` Scripts erweitern**

In `package.json` unter `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: `.gitignore` updaten**

Ersetze den Inhalt von `.gitignore` mit:

```
node_modules/
dist/
data/
.env
.DS_Store
```

- [ ] **Step 6: Smoke-Test schreiben**

`tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("test framework runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Tests laufen lassen**

Run: `npm test`
Expected: 1 Test passed (`smoke > test framework runs`).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/ .gitignore
git commit -m "Add vitest, supertest, better-sqlite3, music-metadata"
```

---

## Task 1: DB-Modul mit Schema und Migrationen

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/index.ts`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Schema-Test schreiben**

`tests/db.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "../src/db";

describe("db", () => {
  it("creates schema on first open and seeds Inbox", () => {
    const db = openDb(":memory:");
    const projects = db.prepare("SELECT * FROM projects").all() as Array<{
      id: number;
      name: string;
      is_system: number;
    }>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: 1, name: "Inbox", is_system: 1 });
  });

  it("creates recordings_fts virtual table", () => {
    const db = openDb(":memory:");
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recordings_fts'")
      .get();
    expect(row).toBeDefined();
  });

  it("re-opening does not duplicate Inbox", () => {
    const db = openDb(":memory:");
    openDb(":memory:");
    const count = (db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number }).c;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Test laufen lassen → fail**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — `Cannot find module '../src/db'`.

- [ ] **Step 3: Schema-SQL erstellen**

`src/db/schema.sql`:

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
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recordings_project ON recordings(project_id);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);

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

- [ ] **Step 4: DB-Modul implementieren**

`src/db/index.ts`:

```typescript
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type DB = Database.Database;

const SCHEMA_VERSION = 1;
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
  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
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

- [ ] **Step 5: TypeScript-Build verifizieren**

In `tsconfig.json` muss `resolveJsonModule` nicht gesetzt sein, aber die SQL-Datei muss zur Laufzeit gefunden werden. Prüfe, dass `__dirname` auf `dist/db/` zeigt — wir müssen die SQL-Datei mit ins Build kopieren.

Update `package.json`-Build-Script:

```json
"build": "tsc && tsc --project tsconfig.frontend.json && cp src/public/index.html src/public/style.css dist/public/ && cp src/db/schema.sql dist/db/"
```

- [ ] **Step 6: Tests laufen lassen → pass**

Run: `npm test -- tests/db.test.ts`
Expected: 3 tests passed.

Falls Tests beim Lesen der SQL-Datei fehlen: vitest läuft auf `src/`, nicht `dist/`. SQL-Datei ist neben `index.ts`, also funktioniert `path.join(__dirname, "schema.sql")` direkt.

- [ ] **Step 7: Commit**

```bash
git add src/db/ tests/db.test.ts package.json
git commit -m "Add SQLite schema with FTS5 and Inbox seeding"
```

---

## Task 2: `deriveTitle`-Helper

**Files:**
- Create: `src/utils/title.ts`
- Create: `tests/utils/title.test.ts`

- [ ] **Step 1: Test schreiben**

`tests/utils/title.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveTitle } from "../../src/utils/title";

describe("deriveTitle", () => {
  it("returns full text when shorter than max", () => {
    expect(deriveTitle("Hallo Welt", 50)).toBe("Hallo Welt");
  });

  it("truncates at word boundary and adds ellipsis", () => {
    const text = "Karl der Große war ein bedeutender Herrscher des Mittelalters";
    expect(deriveTitle(text, 30)).toBe("Karl der Große war ein…");
  });

  it("collapses whitespace and trims", () => {
    expect(deriveTitle("  Hallo\n\n  Welt  ", 50)).toBe("Hallo Welt");
  });

  it("falls back to hard truncation when no space within window", () => {
    expect(deriveTitle("Loooooooooooooooooooooooong", 10)).toBe("Loooooooo…");
  });

  it("returns 'Untitled' for empty input", () => {
    expect(deriveTitle("", 50)).toBe("Untitled");
    expect(deriveTitle("   ", 50)).toBe("Untitled");
  });
});
```

- [ ] **Step 2: Test fails**

Run: `npm test -- tests/utils/title.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementierung**

`src/utils/title.ts`:

```typescript
export function deriveTitle(text: string, maxLen: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return "Untitled";
  }
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  const window = cleaned.substring(0, maxLen - 1);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? lastSpace : maxLen - 1;
  return cleaned.substring(0, cut) + "…";
}
```

- [ ] **Step 4: Tests passen**

Run: `npm test -- tests/utils/title.test.ts`
Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/title.ts tests/utils/title.test.ts
git commit -m "Add deriveTitle helper for auto-generating recording titles"
```

---

## Task 3: `measureDurationMs`-Helper für MP3-Dauer

**Files:**
- Create: `src/utils/audio.ts`
- Create: `tests/utils/audio.test.ts`
- Create: `tests/fixtures/silence.mp3`

- [ ] **Step 1: MP3-Fixture erzeugen**

Wir generieren eine 1-Sekunde-Silence-MP3 mit `ffmpeg`. Falls ffmpeg nicht installiert ist, kann eine vorhandene MP3 reichen. Run:

```bash
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -b:a 64k tests/fixtures/silence.mp3
```

Falls `ffmpeg` nicht verfügbar: lege irgendeine kurze MP3 (z.B. von einem System-Sound) als `tests/fixtures/silence.mp3` ab.

- [ ] **Step 2: Test schreiben**

`tests/utils/audio.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { measureDurationMs } from "../../src/utils/audio";

describe("measureDurationMs", () => {
  it("returns duration in milliseconds for an MP3 buffer", async () => {
    const fixture = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
    const ms = await measureDurationMs(fixture);
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThan(2000);
  });

  it("returns 0 if buffer is not parseable", async () => {
    const ms = await measureDurationMs(Buffer.from("not an mp3"));
    expect(ms).toBe(0);
  });
});
```

- [ ] **Step 3: Implementation**

`src/utils/audio.ts`:

```typescript
import { parseBuffer } from "music-metadata";

export async function measureDurationMs(buffer: Buffer): Promise<number> {
  try {
    const metadata = await parseBuffer(buffer, { mimeType: "audio/mpeg" });
    const seconds = metadata.format.duration ?? 0;
    return Math.round(seconds * 1000);
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Tests passen**

Run: `npm test -- tests/utils/audio.test.ts`
Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/audio.ts tests/utils/audio.test.ts tests/fixtures/silence.mp3
git commit -m "Add measureDurationMs helper using music-metadata"
```

---

## Task 4: Storage-Helper (File schreiben/löschen)

**Files:**
- Create: `src/utils/storage.ts`
- Create: `tests/utils/storage.test.ts`

- [ ] **Step 1: Test schreiben**

`tests/utils/storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { writeAudioFile, deleteAudioFile, audioPathFor } from "../../src/utils/storage";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-store-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("storage", () => {
  it("writeAudioFile writes buffer to <root>/audio/<filename> and returns relative path", () => {
    const buf = Buffer.from("hello");
    const rel = writeAudioFile(tmpRoot, "abc.mp3", buf);
    expect(rel).toBe("audio/abc.mp3");
    const full = path.join(tmpRoot, rel);
    expect(fs.existsSync(full)).toBe(true);
    expect(fs.readFileSync(full).toString()).toBe("hello");
  });

  it("deleteAudioFile removes the file", () => {
    const rel = writeAudioFile(tmpRoot, "abc.mp3", Buffer.from("x"));
    deleteAudioFile(tmpRoot, rel);
    expect(fs.existsSync(path.join(tmpRoot, rel))).toBe(false);
  });

  it("deleteAudioFile is silent when file is missing", () => {
    expect(() => deleteAudioFile(tmpRoot, "audio/missing.mp3")).not.toThrow();
  });

  it("audioPathFor joins root and relative path", () => {
    expect(audioPathFor(tmpRoot, "audio/x.mp3")).toBe(path.join(tmpRoot, "audio/x.mp3"));
  });
});
```

- [ ] **Step 2: Implementation**

`src/utils/storage.ts`:

```typescript
import fs from "fs";
import path from "path";

const AUDIO_SUBDIR = "audio";

export function writeAudioFile(
  dataRoot: string,
  filename: string,
  buffer: Buffer
): string {
  const relative = path.join(AUDIO_SUBDIR, filename);
  const full = path.join(dataRoot, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return relative;
}

export function deleteAudioFile(dataRoot: string, relativePath: string): void {
  const full = path.join(dataRoot, relativePath);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
}

export function audioPathFor(dataRoot: string, relativePath: string): string {
  return path.join(dataRoot, relativePath);
}
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/utils/storage.test.ts`
Expected: 4 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/utils/storage.ts tests/utils/storage.test.ts
git commit -m "Add storage helpers for audio file write/delete"
```

---

## Task 5: ApiError-Klasse

**Files:**
- Create: `src/utils/errors.ts`

- [ ] **Step 1: Implementation**

`src/utils/errors.ts`:

```typescript
export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/errors.ts
git commit -m "Add ApiError class for typed HTTP errors"
```

---

## Task 6: Projects-Service

**Files:**
- Create: `src/services/projects.ts`
- Create: `tests/services/projects.test.ts`

- [ ] **Step 1: Test schreiben**

`tests/services/projects.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/db";
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
} from "../../src/services/projects";
import { ApiError } from "../../src/utils/errors";

let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("projects service", () => {
  it("listProjects returns Inbox first, then alphabetical, with recording counts", () => {
    db.prepare("INSERT INTO projects (name) VALUES ('Zett')").run();
    db.prepare("INSERT INTO projects (name) VALUES ('Alpha')").run();
    const rows = listProjects(db);
    expect(rows.map((r) => r.name)).toEqual(["Inbox", "Alpha", "Zett"]);
    expect(rows[0].recording_count).toBe(0);
  });

  it("createProject inserts and returns the new project", () => {
    const p = createProject(db, "Hörbücher");
    expect(p.id).toBeGreaterThan(1);
    expect(p.name).toBe("Hörbücher");
    expect(p.is_system).toBe(0);
  });

  it("renameProject updates name", () => {
    const p = createProject(db, "Old");
    renameProject(db, p.id, "New");
    const refetched = listProjects(db).find((x) => x.id === p.id);
    expect(refetched?.name).toBe("New");
  });

  it("renameProject throws 400 for Inbox", () => {
    expect(() => renameProject(db, 1, "Anything")).toThrowError(ApiError);
  });

  it("deleteProject moves recordings into Inbox and removes the project", () => {
    const p = createProject(db, "Tmp");
    db.prepare(
      "INSERT INTO recordings (project_id, title, original_text, voice, model, file_path, file_size, duration_ms) VALUES (?, 'T', 'X', 'alloy', 'tts-1', 'audio/x.mp3', 1, 1000)"
    ).run(p.id);
    deleteProject(db, p.id);
    const remainingProjects = db.prepare("SELECT id FROM projects").all();
    expect(remainingProjects).toHaveLength(1);
    const recProjectId = (db
      .prepare("SELECT project_id AS pid FROM recordings")
      .get() as { pid: number }).pid;
    expect(recProjectId).toBe(1);
  });

  it("deleteProject throws 400 for Inbox", () => {
    expect(() => deleteProject(db, 1)).toThrowError(ApiError);
  });
});
```

- [ ] **Step 2: Implementation**

`src/services/projects.ts`:

```typescript
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
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/services/projects.test.ts`
Expected: 6 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/projects.ts tests/services/projects.test.ts
git commit -m "Add projects service with Inbox protection"
```

---

## Task 7: Tags-Service

**Files:**
- Create: `src/services/tags.ts`
- Create: `tests/services/tags.test.ts`

- [ ] **Step 1: Test schreiben**

`tests/services/tags.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/db";
import { resolveTags, setTagsForRecording, listTagsWithCount } from "../../src/services/tags";

let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
});

function insertRecording(): number {
  const r = db
    .prepare(
      "INSERT INTO recordings (project_id, title, original_text, voice, model, file_path, file_size, duration_ms) VALUES (1, 't', 'x', 'alloy', 'tts-1', ?, 1, 1000)"
    )
    .run(`audio/${Math.random()}.mp3`);
  return Number(r.lastInsertRowid);
}

describe("tags service", () => {
  it("resolveTags creates missing and reuses existing, case-insensitive", () => {
    const a = resolveTags(db, ["urgent", "Lernen"]);
    const b = resolveTags(db, ["URGENT", "podcast"]);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    const ids = new Set([...a.map((t) => t.id), ...b.map((t) => t.id)]);
    expect(ids.size).toBe(3);
  });

  it("setTagsForRecording replaces the full tag set", () => {
    const recId = insertRecording();
    setTagsForRecording(db, recId, ["a", "b"]);
    setTagsForRecording(db, recId, ["b", "c"]);
    const names = (
      db
        .prepare(
          "SELECT t.name FROM tags t JOIN recording_tags rt ON rt.tag_id = t.id WHERE rt.recording_id = ? ORDER BY t.name"
        )
        .all(recId) as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toEqual(["b", "c"]);
  });

  it("listTagsWithCount returns only tags with at least one recording, sorted by count desc", () => {
    const r1 = insertRecording();
    const r2 = insertRecording();
    setTagsForRecording(db, r1, ["alpha", "beta"]);
    setTagsForRecording(db, r2, ["beta"]);
    resolveTags(db, ["orphan"]);
    const list = listTagsWithCount(db);
    expect(list.map((t) => t.name)).toEqual(["beta", "alpha"]);
    expect(list[0].count).toBe(2);
  });

  it("ignores empty tag names and trims whitespace", () => {
    const r = insertRecording();
    setTagsForRecording(db, r, [" hello ", "", "  "]);
    const names = (
      db
        .prepare("SELECT t.name FROM tags t JOIN recording_tags rt ON rt.tag_id = t.id WHERE rt.recording_id = ?")
        .all(r) as Array<{ name: string }>
    ).map((x) => x.name);
    expect(names).toEqual(["hello"]);
  });
});
```

- [ ] **Step 2: Implementation**

`src/services/tags.ts`:

```typescript
import type { DB } from "../db";

export interface Tag {
  id: number;
  name: string;
}

export interface TagWithCount extends Tag {
  count: number;
}

export function resolveTags(db: DB, names: string[]): Tag[] {
  const cleaned = Array.from(
    new Set(
      names
        .map((n) => n.trim())
        .filter((n) => n.length > 0)
        .map((n) => n.toLowerCase())
    )
  );
  if (cleaned.length === 0) {
    return [];
  }
  const tx = db.transaction(() => {
    const result: Tag[] = [];
    const findStmt = db.prepare("SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE");
    const insertStmt = db.prepare("INSERT INTO tags (name) VALUES (?)");
    for (const name of cleaned) {
      const existing = findStmt.get(name) as Tag | undefined;
      if (existing) {
        result.push(existing);
      } else {
        const r = insertStmt.run(name);
        result.push({ id: Number(r.lastInsertRowid), name });
      }
    }
    return result;
  });
  return tx();
}

export function setTagsForRecording(db: DB, recordingId: number, names: string[]): void {
  const tags = resolveTags(db, names);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM recording_tags WHERE recording_id = ?").run(recordingId);
    const ins = db.prepare(
      "INSERT INTO recording_tags (recording_id, tag_id) VALUES (?, ?)"
    );
    for (const t of tags) {
      ins.run(recordingId, t.id);
    }
  });
  tx();
}

export function listTagsWithCount(db: DB): TagWithCount[] {
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(rt.recording_id) AS count
       FROM tags t
       INNER JOIN recording_tags rt ON rt.tag_id = t.id
       GROUP BY t.id, t.name
       HAVING count > 0
       ORDER BY count DESC, t.name COLLATE NOCASE ASC`
    )
    .all() as TagWithCount[];
}

export function getTagsForRecording(db: DB, recordingId: number): Tag[] {
  return db
    .prepare(
      `SELECT t.id, t.name
       FROM tags t
       JOIN recording_tags rt ON rt.tag_id = t.id
       WHERE rt.recording_id = ?
       ORDER BY t.name COLLATE NOCASE`
    )
    .all(recordingId) as Tag[];
}
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/services/tags.test.ts`
Expected: 4 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/tags.ts tests/services/tags.test.ts
git commit -m "Add tags service with case-insensitive resolve"
```

---

## Task 8: Recordings-Service (CRUD ohne Generate)

**Files:**
- Create: `src/services/recordings.ts`
- Create: `tests/services/recordings.test.ts`

- [ ] **Step 1: Tests schreiben**

`tests/services/recordings.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/db";
import {
  insertRecording,
  listRecordings,
  getRecording,
  updateRecording,
  deleteRecordingRow,
} from "../../src/services/recordings";
import { setTagsForRecording } from "../../src/services/tags";
import { ApiError } from "../../src/utils/errors";

let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
});

function insertSample(args: {
  title?: string;
  text?: string;
  projectId?: number;
  voice?: string;
  model?: string;
  durationMs?: number;
}) {
  return insertRecording(db, {
    project_id: args.projectId ?? 1,
    title: args.title ?? "Sample",
    original_text: args.text ?? "Hello World",
    voice: args.voice ?? "alloy",
    model: args.model ?? "tts-1",
    file_path: `audio/${Math.random()}.mp3`,
    file_size: 1024,
    duration_ms: args.durationMs ?? 1000,
  });
}

describe("recordings service", () => {
  it("insertRecording returns the new row with id", () => {
    const r = insertSample({ title: "Hello" });
    expect(r.id).toBeGreaterThan(0);
    expect(r.title).toBe("Hello");
  });

  it("listRecordings returns all rows when no filter, sorted DESC by created_at", () => {
    insertSample({ title: "A" });
    insertSample({ title: "B" });
    const list = listRecordings(db, {});
    expect(list).toHaveLength(2);
  });

  it("listRecordings filters by project_id", () => {
    db.prepare("INSERT INTO projects (name) VALUES ('P2')").run();
    insertSample({ projectId: 1 });
    insertSample({ projectId: 2 });
    const list = listRecordings(db, { projectId: 2 });
    expect(list).toHaveLength(1);
  });

  it("listRecordings full-text search hits title", () => {
    insertSample({ title: "Karl der Große", text: "irrelevant" });
    insertSample({ title: "Friedrich II", text: "irrelevant" });
    const hits = listRecordings(db, { q: "Karl" });
    expect(hits.map((r) => r.title)).toEqual(["Karl der Große"]);
  });

  it("listRecordings full-text search hits original_text", () => {
    insertSample({ title: "T1", text: "Mein Hund heißt Bello" });
    insertSample({ title: "T2", text: "Etwas anderes" });
    const hits = listRecordings(db, { q: "Bello" });
    expect(hits.map((r) => r.title)).toEqual(["T1"]);
  });

  it("listRecordings with tag filter (AND)", () => {
    const a = insertSample({ title: "A" });
    const b = insertSample({ title: "B" });
    setTagsForRecording(db, a.id, ["urgent", "lernen"]);
    setTagsForRecording(db, b.id, ["urgent"]);
    const both = listRecordings(db, { tags: ["urgent", "lernen"] });
    expect(both.map((r) => r.title)).toEqual(["A"]);
    const single = listRecordings(db, { tags: ["urgent"] });
    expect(single.map((r) => r.title).sort()).toEqual(["A", "B"]);
  });

  it("listRecordings supports limit/offset", () => {
    for (let i = 0; i < 5; i++) {
      insertSample({ title: `R${i}` });
    }
    const list = listRecordings(db, { limit: 2, offset: 1 });
    expect(list).toHaveLength(2);
  });

  it("getRecording returns row with tags", () => {
    const r = insertSample({ title: "T" });
    setTagsForRecording(db, r.id, ["foo", "bar"]);
    const fetched = getRecording(db, r.id);
    expect(fetched.tags.map((t) => t.name).sort()).toEqual(["bar", "foo"]);
  });

  it("getRecording throws 404 for missing", () => {
    expect(() => getRecording(db, 999)).toThrowError(ApiError);
  });

  it("updateRecording can change title, project_id, tags", () => {
    db.prepare("INSERT INTO projects (name) VALUES ('P2')").run();
    const r = insertSample({ title: "Old" });
    setTagsForRecording(db, r.id, ["a"]);
    updateRecording(db, r.id, { title: "New", project_id: 2, tags: ["b", "c"] });
    const updated = getRecording(db, r.id);
    expect(updated.title).toBe("New");
    expect(updated.project_id).toBe(2);
    expect(updated.tags.map((t) => t.name).sort()).toEqual(["b", "c"]);
  });

  it("deleteRecordingRow removes row and returns its file_path", () => {
    const r = insertSample({ title: "T" });
    const path = deleteRecordingRow(db, r.id);
    expect(path).toContain("audio/");
    expect(() => getRecording(db, r.id)).toThrowError(ApiError);
  });
});
```

- [ ] **Step 2: Implementation**

`src/services/recordings.ts`:

```typescript
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
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/services/recordings.test.ts`
Expected: 11 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/recordings.ts tests/services/recordings.test.ts
git commit -m "Add recordings service with FTS5 search and tag filter"
```

---

## Task 9: TTS-Service (Buffer-Erzeugung)

**Files:**
- Create: `src/services/tts.ts`
- Create: `tests/services/tts.test.ts`

- [ ] **Step 1: Test schreiben**

`tests/services/tts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateTtsBuffer, ALLOWED_MODELS, VOICES } from "../../src/services/tts";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOk(body: ArrayBuffer) {
  globalThis.fetch = vi.fn(async () =>
    new Response(body, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
  );
}

describe("generateTtsBuffer", () => {
  it("rejects unknown voice", async () => {
    await expect(
      generateTtsBuffer({ text: "x", voice: "bogus", model: "tts-1" })
    ).rejects.toThrow(/voice/i);
  });

  it("rejects unknown model", async () => {
    await expect(
      generateTtsBuffer({ text: "x", voice: "alloy", model: "bogus" })
    ).rejects.toThrow(/model/i);
  });

  it("rejects empty text", async () => {
    await expect(
      generateTtsBuffer({ text: "   ", voice: "alloy", model: "tts-1" })
    ).rejects.toThrow(/text/i);
  });

  it("calls OpenAI once for short text and concatenates buffers", async () => {
    mockFetchOk(new TextEncoder().encode("FAKE_MP3_BYTES").buffer);
    const buf = await generateTtsBuffer({
      text: "Hallo Welt",
      voice: "alloy",
      model: "tts-1",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(buf.toString()).toBe("FAKE_MP3_BYTES");
  });

  it("chunks long text", async () => {
    mockFetchOk(new TextEncoder().encode("X").buffer);
    const longText = "Aaa. ".repeat(2000); // ~10000 chars
    await generateTtsBuffer({ text: longText, voice: "alloy", model: "tts-1" });
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(1);
  });

  it("exposes ALLOWED_MODELS and VOICES", () => {
    expect(ALLOWED_MODELS).toEqual(["tts-1", "gpt-4o-mini-tts"]);
    expect(VOICES.length).toBeGreaterThan(0);
  });
});
```

(Add `import { afterEach } from "vitest";` to imports if missing.)

- [ ] **Step 2: Implementation**

`src/services/tts.ts`:

```typescript
import { ApiError } from "../utils/errors";

const OPENAI_API_BASE = "https://api.openai.com";
const CHUNK_SIZE = 4000;

export const ALLOWED_MODELS = ["tts-1", "gpt-4o-mini-tts"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const VOICES = [
  { id: "alloy", title: "Alloy" },
  { id: "echo", title: "Echo" },
  { id: "fable", title: "Fable" },
  { id: "onyx", title: "Onyx" },
  { id: "nova", title: "Nova" },
  { id: "shimmer", title: "Shimmer" },
];

export interface GenerateInput {
  text: string;
  voice: string;
  model: string;
}

export async function generateTtsBuffer(input: GenerateInput): Promise<Buffer> {
  const text = input.text.trim();
  if (!text) {
    throw new ApiError(400, "No text provided");
  }
  if (!VOICES.some((v) => v.id === input.voice)) {
    throw new ApiError(400, `Unknown voice: ${input.voice}`);
  }
  if (!isAllowedModel(input.model)) {
    throw new ApiError(
      400,
      `Unknown model: ${input.model}. Allowed: ${ALLOWED_MODELS.join(", ")}`
    );
  }

  const apiKey = getApiKey();
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await callOpenAi(apiKey, chunk, input.voice, input.model));
  }
  return Buffer.concat(buffers);
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new ApiError(500, "OPENAI_API_KEY is not configured");
  }
  return key;
}

function isAllowedModel(model: string): model is AllowedModel {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}

async function callOpenAi(
  apiKey: string,
  text: string,
  voice: string,
  model: string
): Promise<Buffer> {
  const response = await fetch(`${OPENAI_API_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(
      502,
      `OpenAI API error: ${response.status} ${response.statusText} – ${body}`
    );
  }
  const arrayBuf = await response.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function splitTextIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining.trim());
      break;
    }
    const segment = remaining.substring(0, maxLen);
    let splitIndex = maxLen;
    const lastSentenceEnd = Math.max(
      segment.lastIndexOf(". "),
      segment.lastIndexOf("! "),
      segment.lastIndexOf("? "),
      segment.lastIndexOf(".\n"),
      segment.lastIndexOf("!\n"),
      segment.lastIndexOf("?\n")
    );
    if (lastSentenceEnd > maxLen * 0.3) {
      splitIndex = lastSentenceEnd + 1;
    } else {
      const lastSpace = segment.lastIndexOf(" ");
      if (lastSpace > maxLen * 0.3) {
        splitIndex = lastSpace;
      }
    }
    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }
  return chunks.filter((c) => c.length > 0);
}
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/services/tts.test.ts`
Expected: 6 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/tts.ts tests/services/tts.test.ts
git commit -m "Extract TTS generation into service with buffer-only output"
```

---

## Task 10: Routes-Helper (App-Factory mit DB-Inject)

**Files:**
- Create: `src/app.ts`
- Modify: `src/server.ts` (vorerst nur als Hinweis — wirklich modifiziert wird er in Task 14)

Wir brauchen eine App-Factory, damit wir in Tests Express-App + DB injecten können.

- [ ] **Step 1: App-Factory implementieren**

`src/app.ts`:

```typescript
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import type { DB } from "./db";
import { ApiError } from "./utils/errors";

export interface AppDeps {
  db: DB;
  dataRoot: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  // Routers werden in den nächsten Tasks angehängt.
  app.locals.deps = deps;

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Static frontend
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // Centralized error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Unhandled error:", message);
    res.status(500).json({ error: message });
  });

  return app;
}
```

- [ ] **Step 2: Smoke-Test schreiben**

`tests/routes/app.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db";
import { createApp } from "../../src/app";

describe("app health", () => {
  it("returns 200 for /health", async () => {
    const db = openDb(":memory:");
    const app = createApp({ db, dataRoot: "/tmp" });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/routes/app.test.ts`
Expected: 1 test passed.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts tests/routes/app.test.ts
git commit -m "Add Express app factory with DI and central error handler"
```

---

## Task 11: Projects-Router

**Files:**
- Create: `src/routes/projects.ts`
- Create: `tests/routes/projects.test.ts`
- Modify: `src/app.ts` (Router einhängen)

- [ ] **Step 1: Router-Test schreiben**

`tests/routes/projects.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDb, type DB } from "../../src/db";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp({ db, dataRoot: "/tmp" });
});

describe("/api/projects", () => {
  it("GET returns Inbox initially", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe("Inbox");
  });

  it("POST creates a project", async () => {
    const res = await request(app).post("/api/projects").send({ name: "Hörbücher" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(1);
    expect(res.body.name).toBe("Hörbücher");
  });

  it("PATCH renames a project", async () => {
    const created = (
      await request(app).post("/api/projects").send({ name: "Old" })
    ).body;
    const res = await request(app)
      .patch(`/api/projects/${created.id}`)
      .send({ name: "New" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New");
  });

  it("PATCH refuses to rename Inbox", async () => {
    const res = await request(app).patch("/api/projects/1").send({ name: "X" });
    expect(res.status).toBe(400);
  });

  it("DELETE removes a project", async () => {
    const created = (
      await request(app).post("/api/projects").send({ name: "Tmp" })
    ).body;
    const res = await request(app).delete(`/api/projects/${created.id}`);
    expect(res.status).toBe(204);
  });

  it("DELETE refuses to delete Inbox", async () => {
    const res = await request(app).delete("/api/projects/1");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Router implementieren**

`src/routes/projects.ts`:

```typescript
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
```

- [ ] **Step 3: Router in `app.ts` einhängen**

In `src/app.ts`, nach den Standard-Middleware-Setup-Zeilen und vor dem `express.static`-Aufruf:

```typescript
import { projectsRouter } from "./routes/projects";
// ...
app.use("/api/projects", projectsRouter(deps));
```

- [ ] **Step 4: Tests passen**

Run: `npm test -- tests/routes/projects.test.ts`
Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/projects.ts src/app.ts tests/routes/projects.test.ts
git commit -m "Add /api/projects router"
```

---

## Task 12: Tags-Router

**Files:**
- Create: `src/routes/tags.ts`
- Create: `tests/routes/tags.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Test schreiben**

`tests/routes/tags.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDb, type DB } from "../../src/db";
import { createApp } from "../../src/app";
import { setTagsForRecording } from "../../src/services/tags";

let app: ReturnType<typeof createApp>;
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp({ db, dataRoot: "/tmp" });
  // Eine Recording einfügen, um Tag-Counts zu testen
  db.prepare(
    "INSERT INTO recordings (project_id, title, original_text, voice, model, file_path, file_size, duration_ms) VALUES (1, 't', 'x', 'alloy', 'tts-1', 'audio/x.mp3', 1, 1000)"
  ).run();
  setTagsForRecording(db, 1, ["urgent", "lernen"]);
});

describe("/api/tags", () => {
  it("GET returns tags with count", async () => {
    const res = await request(app).get("/api/tags");
    expect(res.status).toBe(200);
    expect(res.body.items.map((t: any) => t.name).sort()).toEqual([
      "lernen",
      "urgent",
    ]);
    expect(res.body.items[0].count).toBe(1);
  });
});
```

- [ ] **Step 2: Router implementieren**

`src/routes/tags.ts`:

```typescript
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
```

- [ ] **Step 3: Einhängen in `src/app.ts`**

```typescript
import { tagsRouter } from "./routes/tags";
app.use("/api/tags", tagsRouter(deps));
```

- [ ] **Step 4: Tests passen**

Run: `npm test -- tests/routes/tags.test.ts`
Expected: 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tags.ts src/app.ts tests/routes/tags.test.ts
git commit -m "Add /api/tags router"
```

---

## Task 13: Recordings-Router (CRUD ohne POST)

**Files:**
- Create: `src/routes/recordings.ts`
- Create: `tests/routes/recordings.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Tests schreiben**

`tests/routes/recordings.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDb, type DB } from "../../src/db";
import { createApp } from "../../src/app";
import { insertRecording } from "../../src/services/recordings";
import { setTagsForRecording } from "../../src/services/tags";

let app: ReturnType<typeof createApp>;
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp({ db, dataRoot: "/tmp" });
});

function seed(args: { title?: string; text?: string; projectId?: number } = {}) {
  return insertRecording(db, {
    project_id: args.projectId ?? 1,
    title: args.title ?? "Sample",
    original_text: args.text ?? "Hello",
    voice: "alloy",
    model: "tts-1",
    file_path: `audio/${Math.random()}.mp3`,
    file_size: 1024,
    duration_ms: 1000,
  });
}

describe("/api/recordings (read/edit)", () => {
  it("GET returns empty list initially", async () => {
    const res = await request(app).get("/api/recordings");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("GET filters by project_id", async () => {
    db.prepare("INSERT INTO projects (name) VALUES ('P2')").run();
    seed({ projectId: 1 });
    seed({ projectId: 2 });
    const res = await request(app).get("/api/recordings?project_id=2");
    expect(res.body.items).toHaveLength(1);
  });

  it("GET filters by tag (multiple = AND)", async () => {
    const a = seed({ title: "A" });
    const b = seed({ title: "B" });
    setTagsForRecording(db, a.id, ["foo", "bar"]);
    setTagsForRecording(db, b.id, ["foo"]);
    const res = await request(app).get("/api/recordings?tag=foo&tag=bar");
    expect(res.body.items.map((r: any) => r.title)).toEqual(["A"]);
  });

  it("GET full-text search", async () => {
    seed({ title: "Karl der Große" });
    seed({ title: "Friedrich" });
    const res = await request(app).get("/api/recordings?q=Karl");
    expect(res.body.items.map((r: any) => r.title)).toEqual(["Karl der Große"]);
  });

  it("GET /:id returns recording with tags", async () => {
    const r = seed({ title: "T" });
    setTagsForRecording(db, r.id, ["foo"]);
    const res = await request(app).get(`/api/recordings/${r.id}`);
    expect(res.body.tags.map((t: any) => t.name)).toEqual(["foo"]);
  });

  it("PATCH updates title and tags", async () => {
    const r = seed({ title: "Old" });
    const res = await request(app)
      .patch(`/api/recordings/${r.id}`)
      .send({ title: "New", tags: ["hello"] });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New");
    expect(res.body.tags.map((t: any) => t.name)).toEqual(["hello"]);
  });

  it("DELETE removes recording", async () => {
    const r = seed();
    const res = await request(app).delete(`/api/recordings/${r.id}`);
    expect(res.status).toBe(204);
    const get = await request(app).get(`/api/recordings/${r.id}`);
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: Router implementieren (CRUD-Teile)**

`src/routes/recordings.ts`:

```typescript
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
```

- [ ] **Step 3: Einhängen in `src/app.ts`**

```typescript
import { recordingsRouter } from "./routes/recordings";
app.use("/api/recordings", recordingsRouter(deps));
```

- [ ] **Step 4: Tests passen**

Run: `npm test -- tests/routes/recordings.test.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/recordings.ts src/app.ts tests/routes/recordings.test.ts
git commit -m "Add /api/recordings CRUD router"
```

---

## Task 14: Recordings-Router — POST (Generate)

**Files:**
- Modify: `src/routes/recordings.ts`
- Modify: `tests/routes/recordings.test.ts` (Tests ergänzen)

- [ ] **Step 1: Test ergänzen**

In `tests/routes/recordings.test.ts` zusätzlich:

```typescript
import { vi } from "vitest";

describe("POST /api/recordings", () => {
  it("creates a recording end-to-end with mocked OpenAI", async () => {
    const fakeMp3 = await import("fs").then((fs) =>
      fs.readFileSync(__dirname + "/../fixtures/silence.mp3")
    );
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    );
    const res = await request(app)
      .post("/api/recordings")
      .field("text", "Hallo Welt")
      .field("voice", "alloy")
      .field("model", "tts-1")
      .field("tags[]", "hello")
      .field("tags[]", "test");
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Hallo Welt");
    expect(res.body.duration_ms).toBeGreaterThan(0);
    expect(res.body.tags.map((t: any) => t.name).sort()).toEqual(["hello", "test"]);
  });
});
```

(Stelle sicher, dass dieser describe-Block im selben File `tests/routes/recordings.test.ts` mit demselben `beforeEach` lebt — `dataRoot` muss in den Test umkonfiguriert werden auf einen tmp-Ordner für diesen Test, sonst wird in `/tmp/audio/...` geschrieben. Lege oben in der File einen tmp-Ordner an:)

```typescript
import os from "os";
import fs from "fs";
import path from "path";

let dataRoot: string;

beforeEach(() => {
  db = openDb(":memory:");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-test-"));
  app = createApp({ db, dataRoot });
});

afterEach(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: POST-Route implementieren**

In `src/routes/recordings.ts` ganz oben den Multer-Setup einfügen und den Generate-Handler hinzufügen:

```typescript
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { generateTtsBuffer } from "../services/tts";
import { writeAudioFile, deleteAudioFile } from "../utils/storage";
import { measureDurationMs } from "../utils/audio";
import { deriveTitle } from "../utils/title";
import { insertRecording } from "../services/recordings";
import { setTagsForRecording } from "../services/tags";
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
```

Innerhalb der `recordingsRouter`-Funktion, vor `return router`:

```typescript
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
      writtenRelativePath = writeAudioFile(deps.dataRoot, filename, buffer);

      const title = titleInput.trim() || deriveTitle(text, 50);

      const inserted = insertRecording(deps.db, {
        project_id: projectId,
        title,
        original_text: text.trim(),
        voice,
        model,
        file_path: writtenRelativePath,
        file_size: buffer.length,
        duration_ms: durationMs,
      });

      if (tags.length > 0) {
        setTagsForRecording(deps.db, inserted.id, tags);
      }

      const full = (await import("../services/recordings")).getRecording(
        deps.db,
        inserted.id
      );
      res.status(201).json(full);
    } catch (e) {
      if (writtenRelativePath) {
        deleteAudioFile(deps.dataRoot, writtenRelativePath);
      }
      next(e);
    }
  }
);
```

Helper unten in `src/routes/recordings.ts`:

```typescript
function parseTagsField(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string") {
    // JSON-Body kann ein String mit kommaseparierten Tags sein, oder ein einziger Tag
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
```

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/routes/recordings.test.ts`
Expected: alle Tests passed (vorherige + neuer Generate-Test).

- [ ] **Step 4: Commit**

```bash
git add src/routes/recordings.ts tests/routes/recordings.test.ts
git commit -m "Add POST /api/recordings to generate and persist TTS"
```

---

## Task 15: Audio-Streaming und Download

**Files:**
- Modify: `src/routes/recordings.ts`
- Modify: `tests/routes/recordings.test.ts`

- [ ] **Step 1: Tests ergänzen**

In `tests/routes/recordings.test.ts`:

```typescript
describe("audio + download", () => {
  it("GET /:id/audio streams the file", async () => {
    const fakeMp3 = await import("fs").then((fs) =>
      fs.readFileSync(__dirname + "/../fixtures/silence.mp3")
    );
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    );
    const created = (
      await request(app)
        .post("/api/recordings")
        .field("text", "x")
        .field("voice", "alloy")
        .field("model", "tts-1")
    ).body;

    const res = await request(app).get(`/api/recordings/${created.id}/audio`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
  });

  it("GET /:id/download sets Content-Disposition", async () => {
    const fakeMp3 = await import("fs").then((fs) =>
      fs.readFileSync(__dirname + "/../fixtures/silence.mp3")
    );
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    );
    const created = (
      await request(app)
        .post("/api/recordings")
        .field("text", "x")
        .field("voice", "alloy")
        .field("model", "tts-1")
    ).body;

    const res = await request(app).get(`/api/recordings/${created.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });
});
```

- [ ] **Step 2: Routen implementieren**

In `src/routes/recordings.ts`, vor `return router`:

```typescript
import { audioPathFor } from "../utils/storage";
import { getRecording as getRecordingFn } from "../services/recordings";

router.get("/:id/audio", (req, res, next) => {
  try {
    const rec = getRecordingFn(deps.db, Number(req.params.id));
    const fullPath = audioPathFor(deps.dataRoot, rec.file_path);
    res.type("audio/mpeg");
    res.sendFile(fullPath);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/download", (req, res, next) => {
  try {
    const rec = getRecordingFn(deps.db, Number(req.params.id));
    const fullPath = audioPathFor(deps.dataRoot, rec.file_path);
    res.download(fullPath, `${rec.title.replace(/[^\w\-_.\s]/g, "_")}.mp3`);
  } catch (e) {
    next(e);
  }
});
```

(Hinweis: Express's `res.sendFile()` unterstützt Range-Requests automatisch via `send`-Library. Browser nutzen das beim `<audio>`-Element für Seek-Operationen.)

- [ ] **Step 3: Tests passen**

Run: `npm test -- tests/routes/recordings.test.ts`
Expected: alle Tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/routes/recordings.ts tests/routes/recordings.test.ts
git commit -m "Add /api/recordings/:id/audio and /download routes"
```

---

## Task 16: Voices/Models-Routen extrahieren + alten ttsRouter entfernen

**Files:**
- Modify: `src/routes/tts.ts` — wird auf `/voices` und `/models` reduziert
- Modify: `src/app.ts` — neuen Router einhängen
- Modify: `src/server.ts` — alten Code entfernen, App-Factory + DB nutzen

- [ ] **Step 1: `src/routes/tts.ts` ersetzen**

`src/routes/tts.ts` komplett ersetzen mit:

```typescript
import { Router } from "express";
import { ALLOWED_MODELS, VOICES } from "../services/tts";

export function metaRouter(): Router {
  const router = Router();

  router.get("/voices", (_req, res) => {
    res.json({
      items: VOICES.map((v) => ({ _id: v.id, title: v.title })),
    });
  });

  router.get("/models", (_req, res) => {
    res.json({ items: ALLOWED_MODELS });
  });

  return router;
}
```

- [ ] **Step 2: In `src/app.ts` einhängen**

Nach den anderen `/api/*` Routern:

```typescript
import { metaRouter } from "./routes/tts";
app.use("/api", metaRouter());
```

- [ ] **Step 3: `src/server.ts` umstellen**

`src/server.ts` ersetzen mit:

```typescript
import path from "path";
import fs from "fs";
import { openDb } from "./db";
import { createApp } from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_ROOT = process.env.ARIA_DATA_DIR || path.join(__dirname, "..", "data");

fs.mkdirSync(path.join(DATA_ROOT, "audio"), { recursive: true });

const db = openDb(path.join(DATA_ROOT, "aria.db"));
const app = createApp({ db, dataRoot: DATA_ROOT });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aria TTS server running on http://0.0.0.0:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY is not set. API calls will fail.");
  }
});
```

- [ ] **Step 4: Voices/Models-Smoke-Test**

`tests/routes/meta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db";
import { createApp } from "../../src/app";

describe("/api/voices and /api/models", () => {
  it("returns voices", async () => {
    const app = createApp({ db: openDb(":memory:"), dataRoot: "/tmp" });
    const res = await request(app).get("/api/voices");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("returns models", async () => {
    const app = createApp({ db: openDb(":memory:"), dataRoot: "/tmp" });
    const res = await request(app).get("/api/models");
    expect(res.status).toBe(200);
    expect(res.body.items).toContain("tts-1");
  });
});
```

- [ ] **Step 5: Build + Test**

Run:
```bash
npm run build
npm test
```
Expected: Build OK, alle Tests grün.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tts.ts src/server.ts src/app.ts tests/routes/meta.test.ts
git commit -m "Reduce tts router to /voices and /models, wire DB into server"
```

---

## Task 17: Docker-Setup erweitern

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: `Dockerfile` anpassen**

Ersetze in `Dockerfile` die `RUN mkdir -p /app/tmp …`-Zeile mit:

```dockerfile
RUN mkdir -p /app/data/audio && chown -R appuser:appgroup /app/data
```

Außerdem: in der `production` Stage muss die SQL-Schema-Datei mitkopiert werden — füge nach den `COPY src/public/...`-Zeilen hinzu:

```dockerfile
COPY src/db/schema.sql ./dist/db/
```

(Wenn die `--from=builder /app/dist`-Zeile bereits `dist` als Ganzes kopiert, ist das nicht nötig — verifiziere durch Lesen des Dockerfiles.)

- [ ] **Step 2: `docker-compose.yml` anpassen**

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - PORT=${PORT:-3000}
      - ARIA_DATA_DIR=/app/data
    restart: unless-stopped
    volumes:
      - aria-data:/app/data

volumes:
  aria-data:
```

(Das alte `tmp-data`-Volume kann raus — die `tmp/`-Logik ist tot.)

- [ ] **Step 3: Verifizieren**

Run:
```bash
docker compose build
```

Expected: Build erfolgreich.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "Set up persistent /app/data volume in Docker"
```

---

## Task 18: Frontend-Bootstrap leerräumen

**Files:**
- Modify: `src/public/app.ts` — auf Skeleton reduzieren
- Modify: `src/public/index.html` — auf Skeleton reduzieren
- Modify: `src/public/style.css` — auf Skeleton reduzieren

In den nächsten Tasks bauen wir das Frontend Stück für Stück neu auf. Damit das ein sauberer Start ist, räumen wir die alten Inhalte raus und beginnen mit einem minimalen Skeleton, das beim Boot der App geladen wird.

- [ ] **Step 1: HTML-Skeleton**

`src/public/index.html`:

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aria — TTS</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">
    <aside id="sidebar">
      <h1 class="brand">Aria</h1>
      <section class="sidebar-section">
        <h2>Projekte</h2>
        <ul id="project-list" class="project-list"></ul>
        <button id="add-project-btn" class="link-btn">+ Neues Projekt</button>
      </section>
      <section class="sidebar-section">
        <h2>Tags</h2>
        <ul id="tag-list" class="tag-list"></ul>
      </section>
    </aside>
    <main id="main">
      <header id="project-header"></header>
      <div id="toolbar" class="toolbar"></div>
      <div id="recording-list" class="recording-list"></div>
    </main>
  </div>

  <div id="modal-root"></div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: CSS-Skeleton**

`src/public/style.css` komplett ersetzen mit:

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; background: #f7f7f8; }

#app { display: grid; grid-template-columns: 240px 1fr; height: 100vh; }

#sidebar { background: #fff; border-right: 1px solid #e5e5e5; padding: 16px; overflow-y: auto; }
.brand { font-size: 20px; margin: 0 0 24px; }
.sidebar-section { margin-bottom: 24px; }
.sidebar-section h2 { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; margin: 0 0 8px; }
.project-list, .tag-list { list-style: none; margin: 0; padding: 0; }
.project-list li, .tag-list li { padding: 6px 8px; border-radius: 4px; cursor: pointer; display: flex; justify-content: space-between; }
.project-list li.active, .tag-list li.active { background: #2563eb; color: #fff; }
.project-list li:hover:not(.active), .tag-list li:hover:not(.active) { background: #f0f0f3; }
.project-list .count, .tag-list .count { color: #999; font-size: 12px; }
.project-list li.active .count, .tag-list li.active .count { color: #cdd9ff; }
.link-btn { background: none; border: none; color: #2563eb; cursor: pointer; padding: 6px 8px; font-size: 13px; }

#main { padding: 24px 32px; overflow-y: auto; }
#project-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
#project-header h1 { margin: 0; font-size: 24px; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.toolbar input[type="search"] { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #d4d4d8; }
.btn-primary { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
.btn-primary:hover { background: #1d4ed8; }
.btn-ghost { background: transparent; border: 1px solid #d4d4d8; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-icon { background: transparent; border: none; cursor: pointer; padding: 4px; }
.btn-icon:hover { background: #f0f0f3; border-radius: 4px; }

.recording-list { display: flex; flex-direction: column; gap: 12px; }
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; }
.card-header { display: flex; justify-content: space-between; gap: 8px; }
.card-title { font-size: 16px; font-weight: 600; cursor: text; }
.card-meta { color: #777; font-size: 13px; margin: 4px 0 8px; }
.card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.tag-pill { background: #f0f0f3; color: #333; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
.tag-pill.removable::after { content: "×"; margin-left: 6px; color: #999; }
.card-audio { display: flex; align-items: center; gap: 8px; }
.card-audio audio { flex: 1; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 10px; padding: 24px; min-width: 480px; max-width: 90vw; max-height: 90vh; overflow-y: auto; }
.modal h2 { margin: 0 0 16px; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; }
.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 14px; }
.form-group textarea { min-height: 160px; font-family: inherit; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

.empty-state { text-align: center; padding: 64px 0; color: #777; }

.dropdown { position: relative; }
.dropdown-menu { position: absolute; top: 100%; right: 0; background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 4px; min-width: 180px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); z-index: 10; }
.dropdown-menu button { display: block; width: 100%; text-align: left; background: transparent; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.dropdown-menu button:hover { background: #f0f0f3; }

.error-banner { background: #fee; color: #c00; padding: 12px; border-radius: 6px; margin-bottom: 12px; }
```

- [ ] **Step 3: app.ts-Skeleton**

`src/public/app.ts`:

```typescript
// Aria — TTS Frontend Application

document.addEventListener("DOMContentLoaded", () => {
  console.log("Aria booting...");
  // Wird in den nächsten Tasks ausgebaut.
});
```

- [ ] **Step 4: Build verifizieren**

Run: `npm run build`
Expected: Erfolgreich. Die alten Voice-/Model-Dropdowns sind weg, die App lädt aber.

- [ ] **Step 5: Commit**

```bash
git add src/public/
git commit -m "Replace frontend with library-shell skeleton"
```

---

## Task 19: Frontend — API-Client + State

**Files:**
- Create: `src/public/api.ts`
- Create: `src/public/state.ts`

- [ ] **Step 1: API-Client schreiben**

`src/public/api.ts`:

```typescript
export interface Project {
  id: number;
  name: string;
  is_system: number;
  recording_count: number;
}

export interface Tag {
  id: number;
  name: string;
}

export interface TagWithCount extends Tag {
  count: number;
}

export interface Recording {
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
  tags: Tag[];
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => jsonFetch<{ items: Project[] }>("/api/projects").then((r) => r.items),
  createProject: (name: string) =>
    jsonFetch<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  renameProject: (id: number, name: string) =>
    jsonFetch<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteProject: (id: number) =>
    jsonFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),

  listTags: () => jsonFetch<{ items: TagWithCount[] }>("/api/tags").then((r) => r.items),

  listRecordings: (params: {
    projectId?: number;
    tags?: string[];
    q?: string;
  }) => {
    const url = new URL("/api/recordings", location.origin);
    if (params.projectId !== undefined) url.searchParams.set("project_id", String(params.projectId));
    (params.tags ?? []).forEach((t) => url.searchParams.append("tag", t));
    if (params.q) url.searchParams.set("q", params.q);
    return jsonFetch<{ items: Recording[] }>(url.pathname + url.search).then((r) => r.items);
  },
  getRecording: (id: number) => jsonFetch<Recording>(`/api/recordings/${id}`),
  updateRecording: (
    id: number,
    body: { title?: string; project_id?: number; tags?: string[] }
  ) =>
    jsonFetch<Recording>(`/api/recordings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteRecording: (id: number) =>
    jsonFetch<void>(`/api/recordings/${id}`, { method: "DELETE" }),

  generateRecording: async (form: FormData) => {
    const res = await fetch("/api/recordings", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as Recording;
  },

  listVoices: () =>
    jsonFetch<{ items: Array<{ _id: string; title: string }> }>("/api/voices").then((r) => r.items),
  listModels: () => jsonFetch<{ items: string[] }>("/api/models").then((r) => r.items),
};
```

- [ ] **Step 2: State-Modul**

`src/public/state.ts`:

```typescript
import type { Project, Recording, TagWithCount } from "./api";

export interface AppState {
  projects: Project[];
  tags: TagWithCount[];
  selectedProjectId: number;
  activeTagFilters: string[];
  searchQuery: string;
  recordings: Recording[];
  voices: Array<{ _id: string; title: string }>;
  models: string[];
}

type Listener = () => void;

class Store {
  state: AppState = {
    projects: [],
    tags: [],
    selectedProjectId: 1,
    activeTagFilters: [],
    searchQuery: "",
    recordings: [],
    voices: [],
    models: [],
  };
  private listeners: Listener[] = [];

  set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener): void {
    this.listeners.push(l);
  }
}

export const store = new Store();
```

- [ ] **Step 3: Build verifizieren**

Run: `npm run build`
Expected: Erfolgreich.

- [ ] **Step 4: Commit**

```bash
git add src/public/api.ts src/public/state.ts
git commit -m "Add typed API client and global state store"
```

---

## Task 20: Frontend — Sidebar (Projekte + Tags)

**Files:**
- Create: `src/public/sidebar.ts`
- Modify: `src/public/app.ts`

- [ ] **Step 1: Sidebar-Logik**

`src/public/sidebar.ts`:

```typescript
import { api } from "./api";
import { store } from "./state";

export function initSidebar(): void {
  const projectListEl = document.getElementById("project-list") as HTMLUListElement;
  const tagListEl = document.getElementById("tag-list") as HTMLUListElement;
  const addProjectBtn = document.getElementById("add-project-btn") as HTMLButtonElement;

  store.subscribe(() => render());
  render();

  addProjectBtn.addEventListener("click", () => promptCreateProject());

  function render() {
    projectListEl.innerHTML = "";
    for (const p of store.state.projects) {
      const li = document.createElement("li");
      if (p.id === store.state.selectedProjectId && store.state.activeTagFilters.length === 0) {
        li.classList.add("active");
      }
      li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="count">${p.recording_count}</span>`;
      li.addEventListener("click", () => {
        store.set({
          selectedProjectId: p.id,
          activeTagFilters: [],
          searchQuery: "",
        });
        triggerReload();
      });
      projectListEl.appendChild(li);
    }

    tagListEl.innerHTML = "";
    for (const t of store.state.tags) {
      const li = document.createElement("li");
      if (store.state.activeTagFilters.includes(t.name)) li.classList.add("active");
      li.innerHTML = `<span>#${escapeHtml(t.name)}</span><span class="count">${t.count}</span>`;
      li.addEventListener("click", () => {
        const isActive = store.state.activeTagFilters.includes(t.name);
        store.set({
          activeTagFilters: isActive
            ? store.state.activeTagFilters.filter((x) => x !== t.name)
            : [...store.state.activeTagFilters, t.name],
        });
        triggerReload();
      });
      tagListEl.appendChild(li);
    }
  }

  async function promptCreateProject() {
    const name = window.prompt("Name des neuen Projekts:")?.trim();
    if (!name) return;
    try {
      await api.createProject(name);
      const projects = await api.listProjects();
      store.set({ projects });
    } catch (e) {
      alert((e as Error).message);
    }
  }
}

export function triggerReload(): void {
  document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
```

- [ ] **Step 2: In `src/public/app.ts` initialisieren**

`src/public/app.ts` ersetzen mit:

```typescript
import { api } from "./api";
import { store } from "./state";
import { initSidebar } from "./sidebar";

document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  await loadInitial();
});

async function loadInitial() {
  try {
    const [projects, tags, voices, models] = await Promise.all([
      api.listProjects(),
      api.listTags(),
      api.listVoices(),
      api.listModels(),
    ]);
    store.set({ projects, tags, voices, models });
  } catch (e) {
    console.error("Failed to load initial data:", e);
  }
}
```

Das vorhandene `tsconfig.frontend.json` ist bereits auf `module: "ES2020"` gesetzt — das passt für ES-Modul-Output. Damit der Browser die `import`-Statements ausführt, muss das `<script>`-Tag in `index.html` als Modul markiert sein:

```html
<script type="module" src="app.js"></script>
```

Update Task 18's `index.html`-Skeleton entsprechend, falls noch nicht so gesetzt (im Plan ist es ohne `type="module"`).

- [ ] **Step 3: Manuell prüfen**

Run:
```bash
export $(grep -v '^#' .env | xargs)
npm run build
npm start
```
Im Browser http://localhost:3000 öffnen. Erwartet: Sidebar zeigt "Inbox (0)", keine Tags.

- [ ] **Step 4: Commit**

```bash
git add src/public/sidebar.ts src/public/app.ts src/public/index.html tsconfig.frontend.json
git commit -m "Render projects and tags in sidebar"
```

---

## Task 21: Frontend — Recordings-Liste + Suche + Tag-Filter

**Files:**
- Create: `src/public/library.ts`
- Modify: `src/public/app.ts`

- [ ] **Step 1: Library-Modul**

`src/public/library.ts`:

```typescript
import { api } from "./api";
import { store } from "./state";
import { renderCard } from "./card";

let searchDebounce: ReturnType<typeof setTimeout> | undefined;

export function initLibrary(): void {
  document.addEventListener("aria:reload-recordings", reload);
  store.subscribe(() => renderHeader());
  renderHeader();
  reload();
}

function renderHeader(): void {
  const headerEl = document.getElementById("project-header") as HTMLElement;
  const toolbarEl = document.getElementById("toolbar") as HTMLElement;
  const project = store.state.projects.find(
    (p) => p.id === store.state.selectedProjectId
  );

  headerEl.innerHTML = "";
  if (!project) return;

  const title = document.createElement("h1");
  title.textContent = project.name;
  if (!project.is_system) {
    title.contentEditable = "true";
    title.addEventListener("blur", async () => {
      const newName = (title.textContent ?? "").trim();
      if (newName && newName !== project.name) {
        try {
          await api.renameProject(project.id, newName);
          store.set({ projects: await api.listProjects() });
        } catch (e) {
          title.textContent = project.name;
          alert((e as Error).message);
        }
      } else {
        title.textContent = project.name;
      }
    });
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (title as HTMLElement).blur();
      }
    });
  }
  headerEl.appendChild(title);

  if (!project.is_system) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-ghost";
    delBtn.textContent = "Projekt löschen";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Projekt "${project.name}" wirklich löschen? Aufnahmen werden in die Inbox verschoben.`))
        return;
      await api.deleteProject(project.id);
      store.set({
        selectedProjectId: 1,
        projects: await api.listProjects(),
      });
      reload();
    });
    headerEl.appendChild(delBtn);
  }

  toolbarEl.innerHTML = "";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Suchen…";
  search.value = store.state.searchQuery;
  search.addEventListener("input", () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      store.set({ searchQuery: search.value });
      reload();
    }, 300);
  });
  toolbarEl.appendChild(search);

  for (const tag of store.state.activeTagFilters) {
    const chip = document.createElement("span");
    chip.className = "tag-pill removable";
    chip.textContent = `#${tag}`;
    chip.addEventListener("click", () => {
      store.set({
        activeTagFilters: store.state.activeTagFilters.filter((x) => x !== tag),
      });
      reload();
    });
    toolbarEl.appendChild(chip);
  }

  const newBtn = document.createElement("button");
  newBtn.className = "btn-primary";
  newBtn.textContent = "+ Neue Aufnahme";
  newBtn.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("aria:open-generate-modal", { detail: {} }));
  });
  toolbarEl.appendChild(newBtn);
}

async function reload(): Promise<void> {
  const listEl = document.getElementById("recording-list") as HTMLElement;
  try {
    const recordings = await api.listRecordings({
      projectId: store.state.selectedProjectId,
      tags: store.state.activeTagFilters.length > 0 ? store.state.activeTagFilters : undefined,
      q: store.state.searchQuery || undefined,
    });
    store.set({ recordings });

    listEl.innerHTML = "";
    if (recordings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = store.state.searchQuery || store.state.activeTagFilters.length > 0
        ? "Keine Aufnahmen gefunden"
        : "Noch keine Aufnahmen in diesem Projekt";
      listEl.appendChild(empty);
      return;
    }

    for (const r of recordings) {
      listEl.appendChild(renderCard(r));
    }
  } catch (e) {
    console.error("Failed to load recordings:", e);
  }
}
```

- [ ] **Step 2: In `app.ts` einhängen**

In `src/public/app.ts` nach `initSidebar()`:

```typescript
import { initLibrary } from "./library";
// ...
initLibrary();
```

- [ ] **Step 3: Card-Stub erzeugen (vollständige Implementation in Task 22)**

`src/public/card.ts`:

```typescript
import type { Recording } from "./api";

export function renderCard(r: Recording): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-header"><div class="card-title">${escapeHtml(r.title)}</div></div>
    <div class="card-meta">${formatDate(r.created_at)} · ${r.voice} · ${r.model} · ${formatDuration(r.duration_ms)}</div>
    <div class="card-tags"></div>
    <div class="card-audio"><audio controls src="/api/recordings/${r.id}/audio"></audio></div>
  `;
  return card;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
```

- [ ] **Step 4: Build + manuelles Smoke-Testing**

Run: `npm run build && npm start`
- Im Browser: Sidebar zeigt Projekte. Klick auf Inbox → Hauptbereich zeigt "Noch keine Aufnahmen".
- Klick auf "+ Neue Aufnahme" → Konsole zeigt CustomEvent (Modal kommt erst in Task 23).

- [ ] **Step 5: Commit**

```bash
git add src/public/library.ts src/public/card.ts src/public/app.ts
git commit -m "Render recordings list with search and tag filtering"
```

---

## Task 22: Frontend — Aufnahme-Card-Interaktionen

**Files:**
- Modify: `src/public/card.ts`

Erweitert die Card um: Inline-Title-Edit, Tags-Editor, "…"-Menü (Verschieben, Vorlage, Löschen), Download-Button.

- [ ] **Step 1: Card erweitern**

`src/public/card.ts` ersetzen mit:

```typescript
import type { Recording } from "./api";
import { api } from "./api";
import { store } from "./state";

export function renderCard(r: Recording): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  card.appendChild(renderHeader(r));
  card.appendChild(renderMeta(r));
  card.appendChild(renderTags(r));
  card.appendChild(renderAudio(r));

  return card;
}

function renderHeader(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-header";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = r.title;
  title.contentEditable = "true";
  title.addEventListener("blur", async () => {
    const newTitle = (title.textContent ?? "").trim();
    if (newTitle && newTitle !== r.title) {
      try {
        await api.updateRecording(r.id, { title: newTitle });
        r.title = newTitle;
      } catch (e) {
        title.textContent = r.title;
        alert((e as Error).message);
      }
    } else {
      title.textContent = r.title;
    }
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });

  const menu = renderMenu(r);

  wrap.appendChild(title);
  wrap.appendChild(menu);
  return wrap;
}

function renderMenu(r: Recording): HTMLElement {
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown";
  dropdown.innerHTML = `<button class="btn-icon">…</button>`;
  const trigger = dropdown.querySelector("button") as HTMLButtonElement;

  const menu = document.createElement("div");
  menu.className = "dropdown-menu";
  menu.style.display = "none";

  // Verschieben
  const moveLabel = document.createElement("div");
  moveLabel.style.padding = "8px 12px";
  moveLabel.style.color = "#888";
  moveLabel.style.fontSize = "12px";
  moveLabel.textContent = "In Projekt verschieben:";
  menu.appendChild(moveLabel);
  for (const p of store.state.projects) {
    if (p.id === r.project_id) continue;
    const opt = document.createElement("button");
    opt.textContent = p.name;
    opt.addEventListener("click", async () => {
      await api.updateRecording(r.id, { project_id: p.id });
      const recs = await api.listRecordings({
        projectId: store.state.selectedProjectId,
        tags: store.state.activeTagFilters.length > 0 ? store.state.activeTagFilters : undefined,
        q: store.state.searchQuery || undefined,
      });
      store.set({ recordings: recs, projects: await api.listProjects() });
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    });
    menu.appendChild(opt);
  }

  const tplBtn = document.createElement("button");
  tplBtn.textContent = "Als Vorlage";
  tplBtn.addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("aria:open-generate-modal", {
        detail: {
          text: r.original_text,
          voice: r.voice,
          model: r.model,
          tags: r.tags.map((t) => t.name),
          title: "",
        },
      })
    );
  });
  menu.appendChild(tplBtn);

  const dlBtn = document.createElement("button");
  dlBtn.textContent = "Download";
  dlBtn.addEventListener("click", () => {
    window.location.href = `/api/recordings/${r.id}/download`;
  });
  menu.appendChild(dlBtn);

  const delBtn = document.createElement("button");
  delBtn.textContent = "Löschen";
  delBtn.style.color = "#c00";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Aufnahme "${r.title}" wirklich löschen?`)) return;
    await api.deleteRecording(r.id);
    document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    store.set({ tags: await api.listTags(), projects: await api.listProjects() });
  });
  menu.appendChild(delBtn);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  dropdown.appendChild(menu);
  return dropdown;
}

function renderMeta(r: Recording): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = `${formatDate(r.created_at)} · ${r.voice} · ${r.model} · ${formatDuration(r.duration_ms)}`;
  return meta;
}

function renderTags(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-tags";
  for (const t of r.tags) {
    const pill = document.createElement("span");
    pill.className = "tag-pill removable";
    pill.textContent = `#${t.name}`;
    pill.addEventListener("click", async () => {
      const newTags = r.tags.filter((x) => x.id !== t.id).map((x) => x.name);
      const updated = await api.updateRecording(r.id, { tags: newTags });
      r.tags = updated.tags;
      pill.remove();
      store.set({ tags: await api.listTags() });
    });
    wrap.appendChild(pill);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "btn-icon";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", async () => {
    const name = window.prompt("Tag hinzufügen:")?.trim();
    if (!name) return;
    const newTags = [...r.tags.map((x) => x.name), name];
    const updated = await api.updateRecording(r.id, { tags: newTags });
    r.tags = updated.tags;
    wrap.replaceWith(renderTags(r));
    store.set({ tags: await api.listTags() });
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function renderAudio(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-audio";
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = `/api/recordings/${r.id}/audio`;
  wrap.appendChild(audio);
  return wrap;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
```

- [ ] **Step 2: Manuell smoke-testen**

Run: `npm run build && npm start`

Im Browser:
- Title in einer Card anklicken → editierbar.
- "+"-Button bei Tags → prompt erscheint, neuer Tag erscheint nach Submit.
- "…"-Menu → öffnet Dropdown mit "Als Vorlage", "Download", "Löschen", und "In Projekt verschieben"-Optionen.

(Aufnahmen kommen erst in Task 23 rein, daher sind die Cards leer — visuell prüfen wir das nach Task 23.)

- [ ] **Step 3: Commit**

```bash
git add src/public/card.ts
git commit -m "Add inline edit, tag editor, and actions menu to card"
```

---

## Task 23: Frontend — Generate-Modal

**Files:**
- Create: `src/public/generate.ts`
- Modify: `src/public/app.ts`

- [ ] **Step 1: Modal-Implementation**

`src/public/generate.ts`:

```typescript
import { api } from "./api";
import { store } from "./state";

interface PrefilledFields {
  text?: string;
  voice?: string;
  model?: string;
  tags?: string[];
  title?: string;
}

export function initGenerateModal(): void {
  document.addEventListener("aria:open-generate-modal", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as PrefilledFields | undefined;
    open(detail ?? {});
  });
}

function open(prefilled: PrefilledFields): void {
  const root = document.getElementById("modal-root") as HTMLElement;
  root.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const modal = document.createElement("div");
  modal.className = "modal";

  modal.innerHTML = `
    <h2>Neue Aufnahme</h2>
    <div id="modal-error" class="error-banner" style="display:none"></div>
    <div class="form-group">
      <label>Text</label>
      <textarea id="gen-text"></textarea>
      <small id="gen-charcount" style="color:#888"></small>
    </div>
    <div class="form-group">
      <label>Optional: Titel</label>
      <input id="gen-title" type="text" placeholder="Wird automatisch aus Text generiert" />
    </div>
    <div class="form-group">
      <label>Stimme</label>
      <select id="gen-voice"></select>
    </div>
    <div class="form-group">
      <label>Modell</label>
      <select id="gen-model"></select>
    </div>
    <div class="form-group">
      <label>Projekt</label>
      <select id="gen-project"></select>
    </div>
    <div class="form-group">
      <label>Tags (Komma-getrennt)</label>
      <input id="gen-tags" type="text" placeholder="z.B. urgent, lernen" />
    </div>
    <div class="form-actions">
      <button id="gen-cancel" class="btn-ghost">Abbrechen</button>
      <button id="gen-submit" class="btn-primary">Generieren</button>
    </div>
  `;

  backdrop.appendChild(modal);
  root.appendChild(backdrop);

  const textEl = modal.querySelector("#gen-text") as HTMLTextAreaElement;
  const titleEl = modal.querySelector("#gen-title") as HTMLInputElement;
  const voiceEl = modal.querySelector("#gen-voice") as HTMLSelectElement;
  const modelEl = modal.querySelector("#gen-model") as HTMLSelectElement;
  const projectEl = modal.querySelector("#gen-project") as HTMLSelectElement;
  const tagsEl = modal.querySelector("#gen-tags") as HTMLInputElement;
  const charCountEl = modal.querySelector("#gen-charcount") as HTMLElement;
  const errorEl = modal.querySelector("#modal-error") as HTMLElement;
  const submitBtn = modal.querySelector("#gen-submit") as HTMLButtonElement;
  const cancelBtn = modal.querySelector("#gen-cancel") as HTMLButtonElement;

  for (const v of store.state.voices) {
    const opt = document.createElement("option");
    opt.value = v._id;
    opt.textContent = v.title;
    voiceEl.appendChild(opt);
  }
  for (const m of store.state.models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelEl.appendChild(opt);
  }
  for (const p of store.state.projects) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = p.name;
    projectEl.appendChild(opt);
  }

  textEl.value = prefilled.text ?? "";
  titleEl.value = prefilled.title ?? "";
  if (prefilled.voice) voiceEl.value = prefilled.voice;
  if (prefilled.model) modelEl.value = prefilled.model;
  projectEl.value = String(store.state.selectedProjectId);
  tagsEl.value = (prefilled.tags ?? []).join(", ");

  function updateCount() {
    charCountEl.textContent = `${textEl.value.length.toLocaleString("de-DE")} Zeichen`;
  }
  textEl.addEventListener("input", updateCount);
  updateCount();

  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  submitBtn.addEventListener("click", async () => {
    const text = textEl.value.trim();
    if (!text) {
      showError("Bitte Text eingeben.");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Wird generiert…";
    errorEl.style.display = "none";
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("voice", voiceEl.value);
      form.append("model", modelEl.value);
      form.append("project_id", projectEl.value);
      if (titleEl.value.trim()) form.append("title", titleEl.value.trim());
      const tags = tagsEl.value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      for (const t of tags) {
        form.append("tags[]", t);
      }
      await api.generateRecording(form);
      close();
      const [projects, tagsList] = await Promise.all([api.listProjects(), api.listTags()]);
      store.set({ projects, tags: tagsList });
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    } catch (e) {
      showError((e as Error).message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Generieren";
    }
  });

  function close() {
    root.innerHTML = "";
  }

  function showError(msg: string) {
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }
}
```

- [ ] **Step 2: In `app.ts` initialisieren**

In `src/public/app.ts`:

```typescript
import { initGenerateModal } from "./generate";
// ...
initGenerateModal();
```

- [ ] **Step 3: End-to-End-Smoke-Test**

Run: `npm run build && npm start`

Im Browser:
1. http://localhost:3000 öffnen.
2. "+ Neue Aufnahme" klicken → Modal öffnet.
3. Text eingeben, Voice + Modell wählen, optional Tags.
4. "Generieren" klicken → Modal schließt, neue Card erscheint.
5. Audio-Player abspielen.
6. Card-Title editieren → speichern → Reload → neuer Title bleibt.
7. Tag hinzufügen → erscheint in Sidebar.
8. Auf Tag in Sidebar klicken → Liste filtert.
9. Suche eintippen → Liste filtert nach Title/Text.
10. Neues Projekt anlegen → erscheint in Sidebar.
11. Aufnahme via "…"-Menu in anderes Projekt verschieben.
12. Aufnahme löschen → MP3-File ist auch weg (`ls data/audio/`).

- [ ] **Step 4: Commit**

```bash
git add src/public/generate.ts src/public/app.ts
git commit -m "Add generate modal with full TTS form"
```

---

## Task 24: README aktualisieren

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README anpassen**

Aktualisiere die Sektionen, die die alten Endpoints (`/api/tts`, `/api/download/:filename`) beschreiben. Ersetze mit der neuen API. Die wichtigsten Änderungen:

```markdown
## Features

- Persistente Speicherung aller Aufnahmen in SQLite + Filesystem
- Projekte zur Gruppierung mit Default-"Inbox"
- Tags für Cross-Cutting-Filter, case-insensitive
- Volltextsuche über Title und Original-Text via FTS5
- Inline-Player im Browser, Download optional
- Automatisches Chunking langer Texte (> 4000 Zeichen)

## API Dokumentation

### Projekte
- `GET /api/projects` — alle Projekte mit Aufnahmen-Count
- `POST /api/projects` — Body `{ name }`
- `PATCH /api/projects/:id` — Body `{ name }` (Inbox geschützt)
- `DELETE /api/projects/:id` — Aufnahmen → Inbox, Projekt löschen (Inbox geschützt)

### Aufnahmen
- `GET /api/recordings?project_id=&tag=&q=&limit=&offset=` — Liste mit Filtern
- `POST /api/recordings` — multipart oder JSON: `text`, `voice`, `model`, `project_id?`, `tags?`, `title?`, `file?`
- `GET /api/recordings/:id` — Detail inkl. Tags
- `PATCH /api/recordings/:id` — Body kann enthalten: `title`, `project_id`, `tags`
- `DELETE /api/recordings/:id` — Datei + DB-Eintrag
- `GET /api/recordings/:id/audio` — MP3 mit Range-Support für Inline-Player
- `GET /api/recordings/:id/download` — MP3 mit Content-Disposition

### Tags
- `GET /api/tags` — alle Tags mit Count

### Meta
- `GET /api/voices` — verfügbare Stimmen
- `GET /api/models` — zulässige Modelle
- `GET /health` — Healthcheck
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document library/projects/tags API in README"
```

---

## Task 25: Final Verification

- [ ] **Step 1: Alle Tests laufen lassen**

Run: `npm test`
Expected: alle Tests grün.

- [ ] **Step 2: Build verifizieren**

Run: `npm run build`
Expected: erfolgreich.

- [ ] **Step 3: Docker-Build**

Run: `docker compose build`
Expected: erfolgreich.

- [ ] **Step 4: End-to-End-Test in Docker**

Run:
```bash
docker compose up -d
open http://localhost:3000
```

Verifiziere:
- Aufnahme erstellen → MP3 abspielbar.
- Container neu starten → Aufnahme bleibt sichtbar.
- `docker compose down` + `docker compose up -d` → DB + Files persistent.

- [ ] **Step 5: Cleanup**

Falls vorhanden: alte `tmp/`-Logik im Code suchen und entfernen, falls Reste übrig.

```bash
grep -ri "tmp" src/ --include="*.ts" || echo "clean"
```

- [ ] **Step 6: Finaler Commit (falls noch was zu committen ist)**

```bash
git status
```

Falls dirty:
```bash
git add -A
git commit -m "Final cleanup"
```

---

## Self-Review Notes

- **Spec coverage**: alle Sections des Specs sind durch konkrete Tasks abgedeckt — Datenmodell (Task 1), Projekte-API (11), Recordings-API (13–15), Tags-API (12), TTS-Generation (9, 14), UI-Layout (18–23), Storage/Docker (17), Testing (alle Service- und Route-Tests).
- **Type-Konsistenz**: `Project`, `Tag`, `Recording`, `RecordingRow`, `Recording extends RecordingRow with tags` — durchgängig benutzt. `AppDeps` mit `db` + `dataRoot` ist überall identisch.
- **Method-Names konsistent**: `insertRecording`, `listRecordings`, `getRecording`, `updateRecording`, `deleteRecordingRow` (separates Naming weil `deleteRecording` im Router-Layer das Filesystem mit anfasst). `setTagsForRecording`, `resolveTags`, `listTagsWithCount`, `getTagsForRecording`. Sidebar `triggerReload`, Library `aria:reload-recordings` Event-Name.
- **Migration-Tasks fehlen nicht** — Schema läuft per `runMigrations` beim ersten Boot, idempotent.
- **Keine Placeholder** — alle Code-Blöcke sind komplett. Steps mit `<…>`-Markern wurden bewusst eindeutig gehalten.
- **Frontend-Bootstrap**: app.ts wird in mehreren Tasks erweitert. In Task 18 wird es zum Skeleton; in Task 19/20/21/23 wird inkrementell ergänzt. Imports werden je Task hinzugefügt — der finale Stand nach Task 23 enthält alle Init-Aufrufe.
