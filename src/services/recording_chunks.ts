import type { DB } from "../db";

export type ChunkStatus = "pending" | "done" | "failed";

export interface ChunkRow {
  recording_id: number;
  idx: number;
  text: string;
  status: ChunkStatus;
  file_path: string | null;
  byte_size: number | null;
  error: string | null;
}

export function insertChunks(db: DB, recordingId: number, texts: string[]): void {
  const stmt = db.prepare(
    `INSERT INTO recording_chunks (recording_id, idx, text, status)
     VALUES (?, ?, ?, 'pending')`
  );
  const tx = db.transaction((items: string[]) => {
    items.forEach((text, idx) => stmt.run(recordingId, idx, text));
  });
  tx(texts);
}

export function listChunks(db: DB, recordingId: number): ChunkRow[] {
  return db
    .prepare(
      "SELECT * FROM recording_chunks WHERE recording_id = ? ORDER BY idx ASC"
    )
    .all(recordingId) as ChunkRow[];
}

export function listPendingChunks(db: DB, recordingId: number): ChunkRow[] {
  return db
    .prepare(
      `SELECT * FROM recording_chunks
        WHERE recording_id = ? AND status = 'pending'
        ORDER BY idx ASC`
    )
    .all(recordingId) as ChunkRow[];
}

export function markChunkDone(
  db: DB,
  recordingId: number,
  idx: number,
  filePath: string,
  byteSize: number
): void {
  db.prepare(
    `UPDATE recording_chunks
        SET status = 'done',
            file_path = ?,
            byte_size = ?,
            error = NULL
      WHERE recording_id = ? AND idx = ?`
  ).run(filePath, byteSize, recordingId, idx);
}

export function markChunkFailed(
  db: DB,
  recordingId: number,
  idx: number,
  message: string
): void {
  db.prepare(
    `UPDATE recording_chunks
        SET status = 'failed',
            error = ?
      WHERE recording_id = ? AND idx = ?`
  ).run(message, recordingId, idx);
}

export function resetFailedChunks(db: DB, recordingId: number): number {
  const r = db
    .prepare(
      `UPDATE recording_chunks
          SET status = 'pending',
              error = NULL
        WHERE recording_id = ? AND status = 'failed'`
    )
    .run(recordingId);
  return r.changes;
}

export function countDoneChunks(db: DB, recordingId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM recording_chunks
        WHERE recording_id = ? AND status = 'done'`
    )
    .get(recordingId) as { n: number };
  return row.n;
}
