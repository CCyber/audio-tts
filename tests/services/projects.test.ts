import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/db";
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
} from "../../src/services/projects";
import { ApiError } from "../../src/utils/errors";

let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("projects service", () => {
  it("listProjects returns Inbox first, then alphabetical, with recording counts", () => {
    db.prepare("INSERT INTO projects (name) VALUES ('Zett')").run();
    db.prepare("INSERT INTO projects (name) VALUES ('Alpha')").run();
    const rows = listProjects(db);
    expect(rows.map((r) => r.name)).toEqual(["Inbox", "Alpha", "Zett"]);
    expect(rows[0].recording_count).toBe(0);
  });

  it("createProject inserts and returns the new project", () => {
    const p = createProject(db, "Hörbücher");
    expect(p.id).toBeGreaterThan(1);
    expect(p.name).toBe("Hörbücher");
    expect(p.is_system).toBe(0);
  });

  it("renameProject updates name", () => {
    const p = createProject(db, "Old");
    renameProject(db, p.id, "New");
    const refetched = listProjects(db).find((x) => x.id === p.id);
    expect(refetched?.name).toBe("New");
  });

  it("renameProject throws 400 for Inbox", () => {
    expect(() => renameProject(db, 1, "Anything")).toThrowError(ApiError);
  });

  it("deleteProject moves recordings into Inbox and removes the project", () => {
    const p = createProject(db, "Tmp");
    db.prepare(
      "INSERT INTO recordings (project_id, title, original_text, voice, model, file_path, file_size, duration_ms) VALUES (?, 'T', 'X', 'alloy', 'tts-1', 'audio/x.mp3', 1, 1000)"
    ).run(p.id);
    deleteProject(db, p.id);
    const remainingProjects = db.prepare("SELECT id FROM projects").all();
    expect(remainingProjects).toHaveLength(1);
    const recProjectId = (db
      .prepare("SELECT project_id AS pid FROM recordings")
      .get() as { pid: number }).pid;
    expect(recProjectId).toBe(1);
  });

  it("deleteProject throws 400 for Inbox", () => {
    expect(() => deleteProject(db, 1)).toThrowError(ApiError);
  });
});
