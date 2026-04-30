import type { DB } from "../db";

export interface Tag {
  id: number;
  name: string;
}

export interface TagWithCount extends Tag {
  count: number;
}

export function resolveTags(db: DB, names: string[]): Tag[] {
  const cleaned = Array.from(
    new Set(
      names
        .map((n) => n.trim())
        .filter((n) => n.length > 0)
        .map((n) => n.toLowerCase())
    )
  );
  if (cleaned.length === 0) {
    return [];
  }
  const tx = db.transaction(() => {
    const result: Tag[] = [];
    const findStmt = db.prepare("SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE");
    const insertStmt = db.prepare("INSERT INTO tags (name) VALUES (?)");
    for (const name of cleaned) {
      const existing = findStmt.get(name) as Tag | undefined;
      if (existing) {
        result.push(existing);
      } else {
        const r = insertStmt.run(name);
        result.push({ id: Number(r.lastInsertRowid), name });
      }
    }
    return result;
  });
  return tx();
}

export function setTagsForRecording(db: DB, recordingId: number, names: string[]): void {
  const tags = resolveTags(db, names);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM recording_tags WHERE recording_id = ?").run(recordingId);
    const ins = db.prepare(
      "INSERT INTO recording_tags (recording_id, tag_id) VALUES (?, ?)"
    );
    for (const t of tags) {
      ins.run(recordingId, t.id);
    }
  });
  tx();
}

export function listTagsWithCount(db: DB): TagWithCount[] {
  return db
    .prepare(
      `SELECT t.id, t.name, COUNT(rt.recording_id) AS count
       FROM tags t
       INNER JOIN recording_tags rt ON rt.tag_id = t.id
       GROUP BY t.id, t.name
       HAVING count > 0
       ORDER BY count DESC, t.name COLLATE NOCASE ASC`
    )
    .all() as TagWithCount[];
}

export function getTagsForRecording(db: DB, recordingId: number): Tag[] {
  return db
    .prepare(
      `SELECT t.id, t.name
       FROM tags t
       JOIN recording_tags rt ON rt.tag_id = t.id
       WHERE rt.recording_id = ?
       ORDER BY t.name COLLATE NOCASE`
    )
    .all(recordingId) as Tag[];
}
