import { parseBuffer } from "music-metadata";

export async function measureDurationMs(buffer: Buffer): Promise<number> {
  try {
    const metadata = await parseBuffer(buffer, { mimeType: "audio/mpeg" });
    const seconds = metadata.format.duration ?? 0;
    return Math.round(seconds * 1000);
  } catch {
    return 0;
  }
}
