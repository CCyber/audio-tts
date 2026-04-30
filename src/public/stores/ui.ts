import { createStore } from "solid-js/store";

export type LibrarySort = "newest" | "oldest" | "title";

export interface LibraryFilter {
  tag?: string;
  project?: number;
  sort: LibrarySort;
}

export interface UiState {
  composeOpen: boolean;
  fullScreenPlayerOpen: boolean;
  libraryFilter: LibraryFilter;
  searchQuery: string;
  recentSearches: string[];
}

const STORAGE_KEY = "aria.recentSearches";
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

const [uiState, setUiState] = createStore<UiState>({
  composeOpen: false,
  fullScreenPlayerOpen: false,
  libraryFilter: { sort: "newest" },
  searchQuery: "",
  recentSearches: loadRecent(),
});

export { uiState };

export const openCompose = () => setUiState("composeOpen", true);
export const closeCompose = () => setUiState("composeOpen", false);

export const openFullScreenPlayer = () => setUiState("fullScreenPlayerOpen", true);
export const closeFullScreenPlayer = () => setUiState("fullScreenPlayerOpen", false);

export const setLibraryFilter = (patch: Partial<LibraryFilter>) =>
  setUiState("libraryFilter", { ...uiState.libraryFilter, ...patch });

export const setSearchQuery = (q: string) => setUiState("searchQuery", q);

export const addRecentSearch = (q: string) => {
  const trimmed = q.trim();
  if (!trimmed) return;
  const next = [trimmed, ...uiState.recentSearches.filter((r) => r !== trimmed)].slice(0, MAX_RECENT);
  setUiState("recentSearches", next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
};
