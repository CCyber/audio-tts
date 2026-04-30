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
