import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db";
import { createApp } from "../../src/app";
import { createWorker } from "../../src/services/worker";

function makeApp() {
  const db = openDb(":memory:");
  const worker = createWorker({ db, dataRoot: "/tmp", retryBackoffMs: () => 0 });
  const app = createApp({ db, dataRoot: "/tmp", worker });
  return { app, worker };
}

describe("/api/voices and /api/models", () => {
  it("returns voices", async () => {
    const { app, worker } = makeApp();
    try {
      const res = await request(app).get("/api/voices");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    } finally {
      worker.shutdown();
    }
  });

  it("returns models", async () => {
    const { app, worker } = makeApp();
    try {
      const res = await request(app).get("/api/models");
      expect(res.status).toBe(200);
      expect(res.body.items).toContain("tts-1");
    } finally {
      worker.shutdown();
    }
  });
});
