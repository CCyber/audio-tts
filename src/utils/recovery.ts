import fs from "fs";
import path from "path";
import type { DB } from "../db";

const CRASH_MESSAGE = "Server wurde während der Generierung neugestartet";

export function reconcileOnStartup(db: DB, dataRoot: string): void {
  // 1. generating -> failed
  db.prepare(
    `UPDATE recordings
        SET status = 'failed', error = ?
      WHERE status = 'generating'`
  ).run(CRASH_MESSAGE);

  // 2. demote 'done' chunks whose file is missing
  const doneChunks = db
    .prepare(
      "SELECT recording_id, idx, file_path FROM recording_chunks WHERE status = 'done'"
    )
    .all() as Array<{ recording_id: number; idx: number; file_path: string | null }>;
  for (const c of doneChunks) {
    if (!c.file_path) continue;
    const abs = path.join(dataRoot, c.file_path);
    if (!fs.existsSync(abs)) {
      db.prepare(
        `UPDATE recording_chunks
            SET status = 'pending', file_path = NULL, byte_size = NULL, error = NULL
          WHERE recording_id = ? AND idx = ?`
      ).run(c.recording_id, c.idx);
    }
  }

  // 3. orphan chunk-dir cleanup
  const chunksRoot = path.join(dataRoot, "audio", "chunks");
  if (!fs.existsSync(chunksRoot)) return;
  const knownIds = new Set(
    (db.prepare("SELECT id FROM recordings").all() as Array<{ id: number }>).map((r) => r.id)
  );
  for (const entry of fs.readdirSync(chunksRoot)) {
    const id = Number(entry);
    if (!Number.isFinite(id) || !knownIds.has(id)) {
      fs.rmSync(path.join(chunksRoot, entry), { recursive: true, force: true });
    }
  }
}
