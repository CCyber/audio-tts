// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { uiState, openCompose, closeCompose, setLibraryFilter, addRecentSearch } from "../../../src/public/stores/ui";

beforeEach(() => {
  closeCompose();
  setLibraryFilter({ tag: undefined, project: undefined, sort: "newest" });
  localStorage.clear();
});

describe("ui store", () => {
  it("toggles compose sheet", () => {
    expect(uiState.composeOpen).toBe(false);
    openCompose();
    expect(uiState.composeOpen).toBe(true);
    closeCompose();
    expect(uiState.composeOpen).toBe(false);
  });

  it("updates library filter", () => {
    setLibraryFilter({ tag: "news", sort: "title" });
    expect(uiState.libraryFilter.tag).toBe("news");
    expect(uiState.libraryFilter.sort).toBe("title");
  });

  it("persists recent searches in localStorage, max 5, no duplicates", () => {
    addRecentSearch("hello");
    addRecentSearch("world");
    addRecentSearch("hello"); // dedupe + move to front
    addRecentSearch("a");
    addRecentSearch("b");
    addRecentSearch("c");
    addRecentSearch("d"); // exceeds 5
    expect(uiState.recentSearches).toEqual(["d", "c", "b", "a", "hello"]);
    const stored = JSON.parse(localStorage.getItem("aria.recentSearches") ?? "[]");
    expect(stored).toEqual(["d", "c", "b", "a", "hello"]);
  });
});
