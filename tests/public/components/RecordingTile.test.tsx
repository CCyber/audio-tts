// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { RecordingTile } from "../../../src/public/components/tile/RecordingTile";
import { Recording } from "../../../src/public/lib/api";

const rec: Recording = {
  id: 1,
  project_id: 1,
  title: "Hello",
  original_text: "",
  voice: "nova",
  model: "tts-1",
  file_path: "x.mp3",
  file_size: 1,
  duration_ms: 1000,
  created_at: new Date().toISOString(),
  status: "done",
  progress_done: 0,
  progress_total: 0,
  error: null,
  tags: [],
};

describe("RecordingTile", () => {
  it("renders the voice initial", () => {
    const { getByLabelText } = render(() => <RecordingTile recording={rec} />);
    const tile = getByLabelText("Abspielen: Hello");
    expect(tile.textContent).toContain("N");
  });

  it("uses the voice color background", () => {
    const { getByLabelText } = render(() => <RecordingTile recording={rec} />);
    const tile = getByLabelText("Abspielen: Hello") as HTMLElement;
    expect(tile.style.background).toContain("var(--voice-nova)");
  });
});
