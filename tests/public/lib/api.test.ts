import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../../../src/public/lib/api";

describe("api client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("listProjects unwraps items", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: 1, name: "Inbox", is_system: 1, recording_count: 0 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const projects = await api.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Inbox");
  });

  it("cancelRecording posts to the cancel endpoint", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    await api.cancelRecording(42);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/recordings/42/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws with server-provided error message", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "no good" }), { status: 400 })
    );
    await expect(api.listProjects()).rejects.toThrow("no good");
  });
});
