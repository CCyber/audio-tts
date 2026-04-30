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

describe("recordings status fields", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
  });

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
    const r = db
      .prepare(
        `INSERT INTO recordings (project_id, title, original_text, voice, model,
                                 status, progress_total, progress_done)
         VALUES (1, 'P', 'hi', 'alloy', 'tts-1', 'generating', 5, 0)`
      )
      .run();
    const fetched = getRecording(db, Number(r.lastInsertRowid));
    expect(fetched.status).toBe("generating");
    expect(fetched.file_path).toBeNull();
  });
});
