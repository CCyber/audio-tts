import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateTtsBuffer,
  ALLOWED_MODELS,
  VOICES,
  generateChunkBuffer,
  splitTextIntoChunks,
} from "../../src/services/tts";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOk(body: ArrayBuffer) {
  globalThis.fetch = vi.fn(async () =>
    new Response(body, { status: 200, headers: { "Content-Type": "audio/mpeg" } })
  );
}

describe("generateTtsBuffer", () => {
  it("rejects unknown voice", async () => {
    await expect(
      generateTtsBuffer({ text: "x", voice: "bogus", model: "tts-1" })
    ).rejects.toThrow(/voice/i);
  });

  it("rejects unknown model", async () => {
    await expect(
      generateTtsBuffer({ text: "x", voice: "alloy", model: "bogus" })
    ).rejects.toThrow(/model/i);
  });

  it("rejects empty text", async () => {
    await expect(
      generateTtsBuffer({ text: "   ", voice: "alloy", model: "tts-1" })
    ).rejects.toThrow(/text/i);
  });

  it("calls OpenAI once for short text and concatenates buffers", async () => {
    mockFetchOk(new TextEncoder().encode("FAKE_MP3_BYTES").buffer);
    const buf = await generateTtsBuffer({
      text: "Hallo Welt",
      voice: "alloy",
      model: "tts-1",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(buf.toString()).toBe("FAKE_MP3_BYTES");
  });

  it("chunks long text", async () => {
    mockFetchOk(new TextEncoder().encode("X").buffer);
    const longText = "Aaa. ".repeat(2000); // ~10000 chars
    await generateTtsBuffer({ text: longText, voice: "alloy", model: "tts-1" });
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(1);
  });

  it("exposes ALLOWED_MODELS and VOICES", () => {
    expect(ALLOWED_MODELS).toEqual(["tts-1", "gpt-4o-mini-tts"]);
    expect(VOICES.length).toBeGreaterThan(0);
  });
});

describe("splitTextIntoChunks (now exported)", () => {
  it("splits long text into <= 4000-char chunks", () => {
    const text = "a".repeat(10_000);
    const chunks = splitTextIntoChunks(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
  });
});

describe("generateChunkBuffer auto-retry", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test";
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(Buffer.from([1, 2, 3]), { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const buf = await generateChunkBuffer({
      text: "hi", voice: "alloy", model: "tts-1",
    }, { backoffMs: () => 0 });

    expect(buf.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 attempts on persistent 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 429 }));
    globalThis.fetch = fetchMock as any;

    await expect(
      generateChunkBuffer({ text: "hi", voice: "alloy", model: "tts-1" },
                         { backoffMs: () => 0 })
    ).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 4xx (other)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    globalThis.fetch = fetchMock as any;

    await expect(
      generateChunkBuffer({ text: "hi", voice: "alloy", model: "tts-1" },
                         { backoffMs: () => 0 })
    ).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
