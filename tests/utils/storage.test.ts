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

import {
  writeChunkFile,
  chunkPathFor,
  deleteChunkDir,
  chunkDirFor,
} from "../../src/utils/storage";

let dataRoot: string;
beforeEach(() => { dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-storage-")); });
afterEach(() => { fs.rmSync(dataRoot, { recursive: true, force: true }); });

describe("chunk storage helpers", () => {
  it("writeChunkFile returns a relative path under audio/chunks/<id>/", () => {
    const rel = writeChunkFile(dataRoot, 42, 3, Buffer.from([9, 9]));
    expect(rel).toBe(path.join("audio", "chunks", "42", "3.mp3"));
    const abs = path.join(dataRoot, rel);
    expect(fs.readFileSync(abs)[0]).toBe(9);
  });

  it("deleteChunkDir removes the whole recording chunk dir", () => {
    writeChunkFile(dataRoot, 7, 0, Buffer.from([1]));
    writeChunkFile(dataRoot, 7, 1, Buffer.from([2]));
    deleteChunkDir(dataRoot, 7);
    expect(fs.existsSync(chunkDirFor(dataRoot, 7))).toBe(false);
  });
});
