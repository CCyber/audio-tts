// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { MiniPlayer } from "../../../src/public/components/player/MiniPlayer";
import { playRecording, closePlayer } from "../../../src/public/stores/player";
import type { Recording } from "../../../src/public/lib/api";

class FakeAudio {
  src = "";
  currentTime = 0;
  duration = 60;
  playbackRate = 1;
  volume = 1;
  paused = true;
  load = vi.fn();
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

const fakeRec: Recording = {
  id: 1, project_id: 1, title: "Hello", original_text: "",
  voice: "alloy", model: "tts-1", file_path: "x.mp3", file_size: 1, duration_ms: 1000,
  created_at: new Date().toISOString(), status: "done", progress_done: 0, progress_total: 0,
  error: null, tags: [],
};

describe("MiniPlayer", () => {
  beforeEach(() => {
    closePlayer();
    // @ts-expect-error: replace global Audio for tests
    globalThis.Audio = FakeAudio;
  });

  it("renders nothing when no recording", () => {
    const { container } = render(() => <MiniPlayer />);
    expect(container.querySelector(".mini-player")).toBeNull();
  });

  it("shows the title when a recording is playing", async () => {
    await playRecording(fakeRec);
    const { getByText } = render(() => <MiniPlayer />);
    expect(getByText("Hello")).toBeTruthy();
  });
});
