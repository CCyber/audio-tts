import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { measureDurationMs } from "../../src/utils/audio";

describe("measureDurationMs", () => {
  it("returns duration in milliseconds for an MP3 buffer", async () => {
    const fixture = fs.readFileSync(path.join(__dirname, "../fixtures/silence.mp3"));
    const ms = await measureDurationMs(fixture);
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThan(2000);
  });

  it("returns 0 if buffer is not parseable", async () => {
    const ms = await measureDurationMs(Buffer.from("not an mp3"));
    expect(ms).toBe(0);
  });
});
