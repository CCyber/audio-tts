import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import os from "os";
import fs from "fs";
import path from "path";
import { openDb, type DB } from "../../src/db";
import { createApp } from "../../src/app";
import { insertRecording } from "../../src/services/recordings";
import { setTagsForRecording } from "../../src/services/tags";
import { createWorker, type Worker } from "../../src/services/worker";

let app: ReturnType<typeof createApp>;
let db: DB;
let dataRoot: string;
let worker: Worker;
let originalFetch: typeof fetch;

beforeEach(() => {
  db = openDb(":memory:");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-test-"));
  worker = createWorker({ db, dataRoot, retryBackoffMs: () => 0 });
  app = createApp({ db, dataRoot, worker });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  worker.shutdown();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
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

describe("POST /api/recordings", () => {
  it("submits a recording and worker finishes it asynchronously", async () => {
    const fakeMp3 = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    ) as any;

    const res = await request(app)
      .post("/api/recordings")
      .field("text", "Hallo Welt")
      .field("voice", "alloy")
      .field("model", "tts-1")
      .field("tags[]", "hello")
      .field("tags[]", "test");

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("generating");
    expect(res.body.progress_total).toBeGreaterThanOrEqual(1);
    expect(res.body.file_path).toBeNull();
    expect(res.body.title).toBe("Hallo Welt");

    await worker.enqueueAndAwait(res.body.id);

    const after = await request(app).get(`/api/recordings/${res.body.id}`);
    expect(after.body.status).toBe("done");
    expect(after.body.duration_ms).toBeGreaterThan(0);
    expect(after.body.tags.map((t: any) => t.name).sort()).toEqual(["hello", "test"]);
  });
});

describe("audio + download", () => {
  it("GET /:id/audio streams the file", async () => {
    const fakeMp3 = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    ) as any;
    const created = (
      await request(app)
        .post("/api/recordings")
        .field("text", "x")
        .field("voice", "alloy")
        .field("model", "tts-1")
    ).body;
    await worker.enqueueAndAwait(created.id);

    const res = await request(app).get(`/api/recordings/${created.id}/audio`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
  });

  it("GET /:id/download sets Content-Disposition", async () => {
    const fakeMp3 = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    ) as any;
    const created = (
      await request(app)
        .post("/api/recordings")
        .field("text", "x")
        .field("voice", "alloy")
        .field("model", "tts-1")
    ).body;
    await worker.enqueueAndAwait(created.id);

    const res = await request(app).get(`/api/recordings/${created.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  it("GET /:id/audio honors Range requests with 206 Partial Content", async () => {
    const fakeMp3 = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
    globalThis.fetch = vi.fn(async () =>
      new Response(fakeMp3, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
    ) as any;
    const created = (
      await request(app)
        .post("/api/recordings")
        .field("text", "x")
        .field("voice", "alloy")
        .field("model", "tts-1")
    ).body;
    await worker.enqueueAndAwait(created.id);

    const res = await request(app)
      .get(`/api/recordings/${created.id}/audio`)
      .set("Range", "bytes=0-99");
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toMatch(/^bytes 0-99\//);
  });

  it("POST /api/recordings rejects unknown project_id before calling OpenAI", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const res = await request(app)
      .post("/api/recordings")
      .field("text", "x")
      .field("voice", "alloy")
      .field("model", "tts-1")
      .field("project_id", "999");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

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
    const retryFetch = vi.fn(async () =>
      new Response(Buffer.from([1, 2]), { status: 200 })
    );
    globalThis.fetch = retryFetch as any;

    const retry = await request(app).post(`/api/recordings/${created.id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe("generating");

    await worker.enqueueAndAwait(created.id);
    expect((await request(app).get(`/api/recordings/${created.id}`)).body.status).toBe("done");
    // Resume contract: only the failed chunk (idx 1) should be re-fetched.
    expect(retryFetch).toHaveBeenCalledTimes(1);
  });

  it("POST /:id/retry returns 409 if not failed", async () => {
    const r = seed();
    const res = await request(app).post(`/api/recordings/${r.id}/retry`);
    expect(res.status).toBe(409);
  });
});
