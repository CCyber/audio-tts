import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export async function concatFiles(inputs: string[], output: string): Promise<void> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const out = fs.createWriteStream(output);
  try {
    for (const input of inputs) {
      const src = fs.createReadStream(input);
      await pipeline(src, out, { end: false });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  }
}
