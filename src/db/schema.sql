CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  original_text TEXT NOT NULL,
  voice TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  file_path TEXT UNIQUE,
  file_size INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recordings_project ON recordings(project_id);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);

CREATE TABLE IF NOT EXISTS recording_chunks (
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  text         TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  file_path    TEXT,
  byte_size    INTEGER,
  error        TEXT,
  PRIMARY KEY (recording_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_recording_chunks_status ON recording_chunks(recording_id, status);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS recording_tags (
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, tag_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS recordings_fts USING fts5(
  title,
  original_text,
  content='recordings',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS recordings_ai AFTER INSERT ON recordings BEGIN
  INSERT INTO recordings_fts(rowid, title, original_text)
  VALUES (new.id, new.title, new.original_text);
END;

CREATE TRIGGER IF NOT EXISTS recordings_ad AFTER DELETE ON recordings BEGIN
  INSERT INTO recordings_fts(recordings_fts, rowid, title, original_text)
  VALUES('delete', old.id, old.title, old.original_text);
END;

CREATE TRIGGER IF NOT EXISTS recordings_au AFTER UPDATE ON recordings BEGIN
  INSERT INTO recordings_fts(recordings_fts, rowid, title, original_text)
  VALUES('delete', old.id, old.title, old.original_text);
  INSERT INTO recordings_fts(rowid, title, original_text)
  VALUES (new.id, new.title, new.original_text);
END;
