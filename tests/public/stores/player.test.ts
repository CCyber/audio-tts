// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { playerState, playRecording, togglePlay, seek, setSpeed, closePlayer } from "../../../src/public/stores/player";
import { Recording } from "../../../src/public/lib/api";

const fakeRec = (id: number): Recording => ({
  id,
  project_id: 1,
  title: `T${id}`,
  original_text: "",
  voice: "alloy",
  model: "tts-1",
  file_path: "f.mp3",
  file_size: 1,
  duration_ms: 60000,
  created_at: new Date().toISOString(),
  status: "done",
  progress_done: 0,
  progress_total: 0,
  error: null,
  tags: [],
});

class FakeAudio {
  src = "";
  currentTime = 0;
  duration = 60;
  playbackRate = 1;
  volume = 1;
  paused = true;
  played = false;
  load = vi.fn();
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

beforeEach(() => {
  closePlayer();
  // @ts-expect-error: replace global Audio for tests
  globalThis.Audio = FakeAudio;
});

describe("player store", () => {
  it("playRecording sets the current recording and starts playback", async () => {
    await playRecording(fakeRec(5));
    expect(playerState.recording?.id).toBe(5);
    expect(playerState.isPlaying).toBe(true);
  });

  it("togglePlay flips paused state", async () => {
    await playRecording(fakeRec(5));
    togglePlay();
    expect(playerState.isPlaying).toBe(false);
    togglePlay();
    expect(playerState.isPlaying).toBe(true);
  });

  it("setSpeed cycles 1 → 1.25 → 1.5 → 2 → 0.75 → 1", () => {
    setSpeed(1);
    expect(playerState.speed).toBe(1);
    setSpeed(1.25); expect(playerState.speed).toBe(1.25);
    setSpeed(1.5);  expect(playerState.speed).toBe(1.5);
    setSpeed(2);    expect(playerState.speed).toBe(2);
    setSpeed(0.75); expect(playerState.speed).toBe(0.75);
  });

  it("seek updates position", async () => {
    await playRecording(fakeRec(5));
    seek(20);
    expect(playerState.position).toBe(20);
  });
});
