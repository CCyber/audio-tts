import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../../src/db";
import { createApp } from "../../src/app";

describe("app health", () => {
  it("returns 200 for /health", async () => {
    const db = openDb(":memory:");
    const app = createApp({ db, dataRoot: "/tmp" });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
