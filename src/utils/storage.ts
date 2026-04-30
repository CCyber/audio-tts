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

const CHUNKS_SUBDIR = path.join(AUDIO_SUBDIR, "chunks");

export function chunkDirFor(dataRoot: string, recordingId: number): string {
  return path.join(dataRoot, CHUNKS_SUBDIR, String(recordingId));
}

export function chunkPathFor(dataRoot: string, recordingId: number, idx: number): string {
  return path.join(chunkDirFor(dataRoot, recordingId), `${idx}.mp3`);
}

export function writeChunkFile(
  dataRoot: string,
  recordingId: number,
  idx: number,
  buffer: Buffer
): string {
  const relative = path.join(CHUNKS_SUBDIR, String(recordingId), `${idx}.mp3`);
  const full = path.join(dataRoot, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return relative;
}

export function deleteChunkDir(dataRoot: string, recordingId: number): void {
  const dir = chunkDirFor(dataRoot, recordingId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
