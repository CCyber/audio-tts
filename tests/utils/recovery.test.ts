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
