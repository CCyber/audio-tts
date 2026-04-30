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
