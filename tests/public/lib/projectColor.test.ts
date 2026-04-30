import { describe, it, expect } from "vitest";
import { projectColor, PROJECT_PALETTE } from "../../../src/public/lib/projectColor";

describe("projectColor", () => {
  it("returns muted color for inbox (id 1)", () => {
    expect(projectColor({ id: 1, is_system: 1, color: null })).toBe("var(--text-muted)");
  });
  it("returns explicit color when set", () => {
    expect(projectColor({ id: 5, is_system: 0, color: "#abc123" })).toBe("#abc123");
  });
  it("returns a palette color deterministically by id", () => {
    const c1 = projectColor({ id: 5, is_system: 0, color: null });
    const c2 = projectColor({ id: 5, is_system: 0, color: null });
    expect(c1).toBe(c2);
    expect(PROJECT_PALETTE).toContain(c1);
  });
});
