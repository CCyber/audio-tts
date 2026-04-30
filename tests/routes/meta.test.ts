import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db";
import { createApp } from "../../src/app";

describe("/api/voices and /api/models", () => {
  it("returns voices", async () => {
    const app = createApp({ db: openDb(":memory:"), dataRoot: "/tmp" });
    const res = await request(app).get("/api/voices");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("returns models", async () => {
    const app = createApp({ db: openDb(":memory:"), dataRoot: "/tmp" });
    const res = await request(app).get("/api/models");
    expect(res.status).toBe(200);
    expect(res.body.items).toContain("tts-1");
  });
});
