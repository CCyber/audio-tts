import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const router = Router();

const FISH_API_BASE = "https://api.fish.audio";
const CHUNK_SIZE = 2000;

// Multer config for .txt file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "text/plain" ||
      path.extname(file.originalname).toLowerCase() === ".txt"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .txt files are allowed"));
    }
  },
});

function getApiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) {
    throw new Error("FISH_AUDIO_API_KEY is not configured");
  }
  return key;
}

/**
 * Split text into chunks of roughly `maxLen` characters,
 * preferring to break at sentence boundaries.
 */
function splitTextIntoChunks(text: string, maxLen: number = CHUNK_SIZE): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining.trim());
      break;
    }

    let splitIndex = maxLen;

    // Try to split at the last sentence boundary within maxLen
    const segment = remaining.substring(0, maxLen);
    const lastSentenceEnd = Math.max(
      segment.lastIndexOf(". "),
      segment.lastIndexOf("! "),
      segment.lastIndexOf("? "),
      segment.lastIndexOf(".\n"),
      segment.lastIndexOf("!\n"),
      segment.lastIndexOf("?\n")
    );

    if (lastSentenceEnd > maxLen * 0.3) {
      splitIndex = lastSentenceEnd + 1;
    } else {
      // Fall back to last space
      const lastSpace = segment.lastIndexOf(" ");
      if (lastSpace > maxLen * 0.3) {
        splitIndex = lastSpace;
      }
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Call Fish Audio TTS API for a single text chunk.
 * Returns the audio data as a Buffer.
 */
async function generateTTSChunk(
  text: string,
  referenceId: string,
  model: string
): Promise<Buffer> {
  const apiKey = getApiKey();

  const payload = {
    text,
    format: "mp3",
    mp3_bitrate: 128,
    reference_id: referenceId,
    ...(model && { model }),
  };

  const response = await fetch(`${FISH_API_BASE}/v1/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = `Fish Audio API error: ${response.status} ${response.statusText}`;
    try {
      const errorBody = await response.text();
      errorMessage += ` – ${errorBody}`;
    } catch {
      // ignore parse error
    }
    throw new Error(errorMessage);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── GET /api/voices ────────────────────────────────────────────────

router.get("/voices", async (_req: Request, res: Response) => {
  try {
    const apiKey = getApiKey();

    const response = await fetch(
      `${FISH_API_BASE}/model?self=true&page_size=50`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      res.status(response.status).json({
        error: `Failed to fetch voices: ${response.statusText}`,
        details: body,
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Error fetching voices:", message);
    res.status(500).json({ error: message });
  }
});

// ─── POST /api/tts ──────────────────────────────────────────────────

router.post(
  "/tts",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      // Extract text from body or uploaded file
      let text: string = req.body.text || "";
      const referenceId: string = req.body.reference_id || "";
      const model: string = req.body.model || "fish-speech-1.5";

      if (req.file) {
        text = req.file.buffer.toString("utf-8");
      }

      text = text.trim();

      if (!text) {
        res.status(400).json({ error: "No text provided. Enter text or upload a .txt file." });
        return;
      }

      if (!referenceId) {
        res.status(400).json({ error: "No voice selected (reference_id is required)." });
        return;
      }

      // Split long texts into chunks
      const chunks = splitTextIntoChunks(text);
      console.log(
        `Processing TTS request: ${text.length} chars, ${chunks.length} chunk(s), model=${model}`
      );

      // Generate audio for each chunk
      const audioBuffers: Buffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(
          `  Generating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`
        );
        const buffer = await generateTTSChunk(chunks[i], referenceId, model);
        audioBuffers.push(buffer);
      }

      // Concatenate all MP3 buffers
      const finalBuffer = Buffer.concat(audioBuffers);

      // Save to temp file
      const tmpDir = path.join(__dirname, "..", "..", "tmp");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      const filename = `tts-${uuidv4()}.mp3`;
      const filepath = path.join(tmpDir, filename);
      fs.writeFileSync(filepath, finalBuffer);

      // Schedule cleanup after 5 minutes
      setTimeout(() => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          console.log(`Cleaned up temp file: ${filename}`);
        }
      }, 5 * 60 * 1000);

      res.json({
        success: true,
        filename,
        size: finalBuffer.length,
        chunks: chunks.length,
        download_url: `/api/download/${filename}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("TTS generation error:", message);
      res.status(500).json({ error: message });
    }
  }
);

// ─── GET /api/download/:filename ────────────────────────────────────

router.get("/download/:filename", (req: Request, res: Response) => {
  const { filename } = req.params;

  // Sanitize filename to prevent directory traversal
  if (!filename.match(/^tts-[\w-]+\.mp3$/)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filepath = path.join(__dirname, "..", "..", "tmp", filename);

  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: "File not found or already expired" });
    return;
  }

  res.download(filepath, "speech.mp3", (err) => {
    if (err) {
      console.error("Download error:", err);
    }
    // Delete file after download
    setTimeout(() => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Cleaned up after download: ${filename}`);
      }
    }, 1000);
  });
});

export { router as ttsRouter };
