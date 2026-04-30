import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { concatFiles } from "../../src/utils/concat";

let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "concat-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("concatFiles", () => {
  it("concatenates byte streams in order", async () => {
    const a = path.join(dir, "a"); fs.writeFileSync(a, Buffer.from([1, 2, 3]));
    const b = path.join(dir, "b"); fs.writeFileSync(b, Buffer.from([4, 5]));
    const out = path.join(dir, "out");

    await concatFiles([a, b], out);

    expect(Array.from(fs.readFileSync(out))).toEqual([1, 2, 3, 4, 5]);
  });

  it("creates parent directories", async () => {
    const a = path.join(dir, "a"); fs.writeFileSync(a, Buffer.from([1]));
    const out = path.join(dir, "nested", "deep", "out.mp3");

    await concatFiles([a], out);

    expect(fs.existsSync(out)).toBe(true);
  });

  it("rejects when an input file is missing", async () => {
    const out = path.join(dir, "out");
    await expect(concatFiles([path.join(dir, "missing")], out)).rejects.toBeTruthy();
  });
});
