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
let originalFetch: typeof fetch;

beforeEach(() => {
  db = openDb(":memory:");
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-worker-"));
  process.env.OPENAI_API_KEY = "test";
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  worker?.shutdown();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
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
