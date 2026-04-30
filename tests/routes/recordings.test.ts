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
