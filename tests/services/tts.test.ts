import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTtsBuffer, ALLOWED_MODELS, VOICES } from "../../src/services/tts";

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
