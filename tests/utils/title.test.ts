import { describe, it, expect } from "vitest";
import { deriveTitle } from "../../src/utils/title";

describe("deriveTitle", () => {
  it("returns full text when shorter than max", () => {
    expect(deriveTitle("Hallo Welt", 50)).toBe("Hallo Welt");
  });

  it("truncates at word boundary and adds ellipsis", () => {
    const text = "Karl der Große war ein bedeutender Herrscher des Mittelalters";
    expect(deriveTitle(text, 30)).toBe("Karl der Große war ein…");
  });

  it("collapses whitespace and trims", () => {
    expect(deriveTitle("  Hallo\n\n  Welt  ", 50)).toBe("Hallo Welt");
  });

  it("falls back to hard truncation when no space within window", () => {
    expect(deriveTitle("Loooooooooooooooooooooooong", 10)).toBe("Loooooooo…");
  });

  it("returns 'Untitled' for empty input", () => {
    expect(deriveTitle("", 50)).toBe("Untitled");
    expect(deriveTitle("   ", 50)).toBe("Untitled");
  });
});
