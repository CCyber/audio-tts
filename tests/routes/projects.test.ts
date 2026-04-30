import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { openDb, type DB } from "../../src/db";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp({ db, dataRoot: "/tmp" });
});

describe("/api/projects", () => {
  it("GET returns Inbox initially", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe("Inbox");
  });

  it("POST creates a project", async () => {
    const res = await request(app).post("/api/projects").send({ name: "Hörbücher" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(1);
    expect(res.body.name).toBe("Hörbücher");
  });

  it("PATCH renames a project", async () => {
    const created = (
      await request(app).post("/api/projects").send({ name: "Old" })
    ).body;
    const res = await request(app)
      .patch(`/api/projects/${created.id}`)
      .send({ name: "New" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New");
  });

  it("PATCH refuses to rename Inbox", async () => {
    const res = await request(app).patch("/api/projects/1").send({ name: "X" });
    expect(res.status).toBe(400);
  });

  it("DELETE removes a project", async () => {
    const created = (
      await request(app).post("/api/projects").send({ name: "Tmp" })
    ).body;
    const res = await request(app).delete(`/api/projects/${created.id}`);
    expect(res.status).toBe(204);
  });

  it("DELETE refuses to delete Inbox", async () => {
    const res = await request(app).delete("/api/projects/1");
    expect(res.status).toBe(400);
  });
});
