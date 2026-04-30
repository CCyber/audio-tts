import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type DB = Database.Database;

const SCHEMA_VERSION = 1;
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export function openDb(filename: string): DB {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  seedInbox(db);

  return db;
}

function runMigrations(db: DB): void {
  const currentVersion = (db.pragma("user_version", { simple: true }) as number) ?? 0;
  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function seedInbox(db: DB): void {
  const existing = db.prepare("SELECT id FROM projects WHERE id = 1").get();
  if (existing) {
    return;
  }
  db.prepare(
    "INSERT INTO projects (id, name, is_system) VALUES (1, 'Inbox', 1)"
  ).run();
}
