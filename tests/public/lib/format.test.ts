import { describe, it, expect } from "vitest";
import { formatDuration, formatRelative, voiceInitial, abbreviateProject } from "../../../src/public/lib/format";

describe("formatDuration", () => {
  it("formats short clips as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(154_000)).toBe("2:34");
  });
  it("returns dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatRelative", () => {
  it("returns 'gerade eben' under one minute", () => {
    const now = new Date();
    expect(formatRelative(now.toISOString())).toBe("gerade eben");
  });
});

describe("voiceInitial", () => {
  it("uppercases the first character", () => {
    expect(voiceInitial("alloy")).toBe("A");
    expect(voiceInitial("nova")).toBe("N");
  });
});

describe("abbreviateProject", () => {
  it("truncates to 8 chars with ellipsis", () => {
    expect(abbreviateProject("Inbox")).toBe("Inbox");
    expect(abbreviateProject("Very long project name")).toBe("Very lo…");
  });
});
