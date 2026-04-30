import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const router = Router();

const OPENAI_API_BASE = "https://api.openai.com";
const CHUNK_SIZE = 4000;

const ALLOWED_MODELS = ["tts-1", "gpt-4o-mini-tts"] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

const VOICES = [
  { id: "alloy", title: "Alloy" },
  { id: "echo", title: "Echo" },
  { id: "fable", title: "Fable" },
  { id: "onyx", title: "Onyx" },
  { id: "nova", title: "Nova" },
  { id: "shimmer", title: "Shimmer" },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return key;
}

function isAllowedModel(model: string): model is AllowedModel {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}

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

async function generateTTSChunk(
  text: string,
  voice: string,
  model: AllowedModel
): Promise<Buffer> {
  const apiKey = getApiKey();

  const payload = {
    model,
    voice,
    input: text,
    response_format: "mp3",
  };

  const response = await fetch(`${OPENAI_API_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = `OpenAI API error: ${response.status} ${response.statusText}`;
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

router.get("/voices", (_req: Request, res: Response) => {
  res.json({
    items: VOICES.map((v) => ({ _id: v.id, title: v.title })),
  });
});

// ─── GET /api/models ────────────────────────────────────────────────

router.get("/models", (_req: Request, res: Response) => {
  res.json({ items: ALLOWED_MODELS });
});

// ─── POST /api/tts ──────────────────────────────────────────────────

router.post(
  "/tts",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      let text: string = req.body.text || "";
      const voice: string = req.body.reference_id || req.body.voice || "";
      const model: string = req.body.model || "tts-1";

      if (req.file) {
        text = req.file.buffer.toString("utf-8");
      }

      text = text.trim();

      if (!text) {
        res.status(400).json({ error: "No text provided. Enter text or upload a .txt file." });
        return;
      }

      if (!voice) {
        res.status(400).json({ error: "No voice selected." });
        return;
      }

      if (!VOICES.some((v) => v.id === voice)) {
        res.status(400).json({ error: `Unknown voice: ${voice}` });
        return;
      }

      if (!isAllowedModel(model)) {
        res.status(400).json({
          error: `Unknown model: ${model}. Allowed: ${ALLOWED_MODELS.join(", ")}`,
        });
        return;
      }

      const chunks = splitTextIntoChunks(text);
      console.log(
        `Processing TTS request: ${text.length} chars, ${chunks.length} chunk(s), model=${model}, voice=${voice}`
      );

      const audioBuffers: Buffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(
          `  Generating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`
        );
        const buffer = await generateTTSChunk(chunks[i], voice, model);
        audioBuffers.push(buffer);
      }

      const finalBuffer = Buffer.concat(audioBuffers);

      const tmpDir = path.join(__dirname, "..", "..", "tmp");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      const filename = `tts-${uuidv4()}.mp3`;
      const filepath = path.join(tmpDir, filename);
      fs.writeFileSync(filepath, finalBuffer);

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
    setTimeout(() => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Cleaned up after download: ${filename}`);
      }
    }, 1000);
  });
});

export { router as ttsRouter };
