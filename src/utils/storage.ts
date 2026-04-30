import fs from "fs";
import path from "path";

const AUDIO_SUBDIR = "audio";

export function writeAudioFile(
  dataRoot: string,
  filename: string,
  buffer: Buffer
): string {
  const relative = path.join(AUDIO_SUBDIR, filename);
  const full = path.join(dataRoot, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return relative;
}

export function deleteAudioFile(dataRoot: string, relativePath: string): void {
  const full = path.join(dataRoot, relativePath);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
}

export function audioPathFor(dataRoot: string, relativePath: string): string {
  return path.join(dataRoot, relativePath);
}
