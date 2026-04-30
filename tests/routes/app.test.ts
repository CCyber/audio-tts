import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db";
import { createApp } from "../../src/app";
import { createWorker } from "../../src/services/worker";

describe("app health", () => {
  it("returns 200 for /health", async () => {
    const db = openDb(":memory:");
    const worker = createWorker({ db, dataRoot: "/tmp", retryBackoffMs: () => 0 });
    try {
      const app = createApp({ db, dataRoot: "/tmp", worker });
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    } finally {
      worker.shutdown();
    }
  });
});
