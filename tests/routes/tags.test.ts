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
