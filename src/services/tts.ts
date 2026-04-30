import { ApiError } from "../utils/errors";

const OPENAI_API_BASE = "https://api.openai.com";
const CHUNK_SIZE = 4000;

export const ALLOWED_MODELS = ["tts-1", "gpt-4o-mini-tts"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const VOICES = [
  { id: "alloy", title: "Alloy" },
  { id: "echo", title: "Echo" },
  { id: "fable", title: "Fable" },
  { id: "onyx", title: "Onyx" },
  { id: "nova", title: "Nova" },
  { id: "shimmer", title: "Shimmer" },
];

export interface GenerateInput {
  text: string;
  voice: string;
  model: string;
}

export async function generateTtsBuffer(input: GenerateInput): Promise<Buffer> {
  const text = input.text.trim();
  if (!text) {
    throw new ApiError(400, "No text provided");
  }
  if (!VOICES.some((v) => v.id === input.voice)) {
    throw new ApiError(400, `Unknown voice: ${input.voice}`);
  }
  if (!isAllowedModel(input.model)) {
    throw new ApiError(
      400,
      `Unknown model: ${input.model}. Allowed: ${ALLOWED_MODELS.join(", ")}`
    );
  }

  const apiKey = getApiKey();
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await callOpenAi(apiKey, chunk, input.voice, input.model));
  }
  return Buffer.concat(buffers);
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new ApiError(500, "OPENAI_API_KEY is not configured");
  }
  return key;
}

function isAllowedModel(model: string): model is AllowedModel {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}

async function callOpenAi(
  apiKey: string,
  text: string,
  voice: string,
  model: string
): Promise<Buffer> {
  const response = await fetch(`${OPENAI_API_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(
      502,
      `OpenAI API error: ${response.status} ${response.statusText} – ${body}`
    );
  }
  const arrayBuf = await response.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function splitTextIntoChunks(text: string, maxLen: number): string[] {
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
    const segment = remaining.substring(0, maxLen);
    let splitIndex = maxLen;
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
