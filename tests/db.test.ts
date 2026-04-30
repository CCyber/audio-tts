import { describe, it, expect } from "vitest";
import { openDb } from "../src/db";

describe("db", () => {
  it("creates schema on first open and seeds Inbox", () => {
    const db = openDb(":memory:");
    const projects = db.prepare("SELECT * FROM projects").all() as Array<{
      id: number;
      name: string;
      is_system: number;
    }>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: 1, name: "Inbox", is_system: 1 });
  });

  it("creates recordings_fts virtual table", () => {
    const db = openDb(":memory:");
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recordings_fts'")
      .get();
    expect(row).toBeDefined();
  });

  it("re-opening does not duplicate Inbox", () => {
    const db = openDb(":memory:");
    openDb(":memory:");
    const count = (db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number }).c;
    expect(count).toBe(1);
  });
});
