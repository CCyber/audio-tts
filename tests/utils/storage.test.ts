import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { writeAudioFile, deleteAudioFile, audioPathFor } from "../../src/utils/storage";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-store-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("storage", () => {
  it("writeAudioFile writes buffer to <root>/audio/<filename> and returns relative path", () => {
    const buf = Buffer.from("hello");
    const rel = writeAudioFile(tmpRoot, "abc.mp3", buf);
    expect(rel).toBe("audio/abc.mp3");
    const full = path.join(tmpRoot, rel);
    expect(fs.existsSync(full)).toBe(true);
    expect(fs.readFileSync(full).toString()).toBe("hello");
  });

  it("deleteAudioFile removes the file", () => {
    const rel = writeAudioFile(tmpRoot, "abc.mp3", Buffer.from("x"));
    deleteAudioFile(tmpRoot, rel);
    expect(fs.existsSync(path.join(tmpRoot, rel))).toBe(false);
  });

  it("deleteAudioFile is silent when file is missing", () => {
    expect(() => deleteAudioFile(tmpRoot, "audio/missing.mp3")).not.toThrow();
  });

  it("audioPathFor joins root and relative path", () => {
    expect(audioPathFor(tmpRoot, "audio/x.mp3")).toBe(path.join(tmpRoot, "audio/x.mp3"));
  });
});
