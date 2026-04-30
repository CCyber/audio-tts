// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { libraryState, loadAll, upsertRecording, removeRecording } from "../../../src/public/stores/library";
import { api, Recording } from "../../../src/public/lib/api";

const makeRec = (id: number, status: Recording["status"] = "done"): Recording => ({
  id,
  project_id: 1,
  title: `T${id}`,
  original_text: "",
  voice: "alloy",
  model: "tts-1",
  file_path: "f.mp3",
  file_size: 1,
  duration_ms: 1000,
  created_at: new Date().toISOString(),
  status,
  progress_done: 0,
  progress_total: 0,
  error: null,
  tags: [],
});

beforeEach(() => {
  vi.spyOn(api, "listProjects").mockResolvedValue([
    { id: 1, name: "Inbox", is_system: 1, recording_count: 0 },
  ]);
  vi.spyOn(api, "listTags").mockResolvedValue([]);
  vi.spyOn(api, "listRecordings").mockResolvedValue([makeRec(1), makeRec(2)]);
});

describe("library store", () => {
  it("loadAll populates projects, recordings, tags", async () => {
    await loadAll();
    expect(libraryState.recordings).toHaveLength(2);
    expect(libraryState.projects).toHaveLength(1);
    expect(libraryState.loading).toBe(false);
  });

  it("upsertRecording prepends new and updates existing", () => {
    upsertRecording(makeRec(99));
    expect(libraryState.recordings[0].id).toBe(99);

    upsertRecording({ ...makeRec(99), title: "renamed" });
    expect(libraryState.recordings.filter((r) => r.id === 99)).toHaveLength(1);
    expect(libraryState.recordings.find((r) => r.id === 99)?.title).toBe("renamed");
  });

  it("removeRecording deletes by id", () => {
    upsertRecording(makeRec(7));
    removeRecording(7);
    expect(libraryState.recordings.find((r) => r.id === 7)).toBeUndefined();
  });
});
