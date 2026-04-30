import path from "path";
import fs from "fs";
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
  writeAudioFile,
} from "../utils/storage";
import { measureDurationMs } from "../utils/audio";

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
          try {
            markRecordingFailed(opts.db, id, "Internal worker error");
          } catch {
            // best-effort; if even this fails, the recovery hook on next start will catch it.
          }
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

    // Check cancel one final time after the last chunk's OpenAI call completes,
    // before we commit the concat. Spec: "User clicks Cancel during last chunk:
    // Worker still finishes that chunk's OpenAI call, then sees flag, then deletes everything."
    if (cancelFlags.has(recordingId)) {
      cancelFlags.delete(recordingId);
      return;
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
    let tempBuf: Buffer;
    try {
      // Concat first into a temp file under audio/, then rename.
      tempBuf = Buffer.concat(
        inputAbs.map((p) => fs.readFileSync(p))
      ); // small enough — true streaming concat used for production volume comes via concatFiles in next refactor (Task 14).
      finalRel = writeAudioFile(opts.dataRoot, finalName, tempBuf);
    } catch (e) {
      const msg = "Datei konnte nicht gespeichert werden";
      markRecordingFailed(opts.db, recordingId, msg);
      console.error(`worker: recording ${recordingId} concat failed`, e);
      return;
    }

    let durationMs = 0;
    try {
      durationMs = await measureDurationMs(tempBuf);
    } catch {
      // measureDurationMs failures are non-fatal — leave duration at 0.
    }

    opts.db.transaction(() => {
      markRecordingDone(opts.db, recordingId, {
        file_path: finalRel,
        file_size: tempBuf.length,
        duration_ms: durationMs,
      });
      opts.db
        .prepare("DELETE FROM recording_chunks WHERE recording_id = ?")
        .run(recordingId);
    })();
    deleteChunkDir(opts.dataRoot, recordingId);
    cancelFlags.delete(recordingId);
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
