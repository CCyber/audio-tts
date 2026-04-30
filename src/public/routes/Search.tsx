import { For, Show, createSignal, createResource } from "solid-js";
import { useSearchParams, useNavigate } from "@solidjs/router";
import { Header } from "../components/shell/Header";
import { RecordingRow } from "../components/tile/RecordingRow";
import { libraryState } from "../stores/library";
import { uiState, addRecentSearch } from "../stores/ui";
import { api, Recording } from "../lib/api";

export function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = typeof searchParams.q === "string" ? searchParams.q : "";
  const [query, setQuery] = createSignal(initialQ);
  let inputEl!: HTMLInputElement;

  setTimeout(() => inputEl?.focus(), 0);

  const [results] = createResource(query, async (q): Promise<Recording[]> => {
    const trimmed = q.trim();
    if (!trimmed) return [];
    await new Promise((r) => setTimeout(r, 200));
    if (q !== query()) return [];
    addRecentSearch(trimmed);
    return api.listRecordings({ q: trimmed });
  });

  const matchingProjects = () => {
    const q = query().toLowerCase().trim();
    if (!q) return [];
    return libraryState.projects.filter((p) => p.name.toLowerCase().includes(q));
  };
  const matchingTags = () => {
    const q = query().toLowerCase().trim();
    if (!q) return [];
    return libraryState.tags.filter((t) => t.name.toLowerCase().includes(q));
  };

  return (
    <>
      <Header title={<span>Suche</span>} />
      <div style={{ padding: "var(--space-3) var(--space-4)" }}>
        <input
          ref={inputEl}
          class="form-input"
          type="search"
          placeholder="Suche…"
          value={query()}
          onInput={(e) => { setQuery(e.currentTarget.value); setSearchParams({ q: e.currentTarget.value || null }); }}
        />
      </div>

      <Show when={!query().trim()}>
        <Show when={uiState.recentSearches.length > 0}>
          <h3 class="section-title" style={{ padding: "0 var(--space-4)" }}>Letzte Suchen</h3>
          <For each={uiState.recentSearches}>{(q) => (
            <button class="search-recent" onClick={() => setQuery(q)}>{q}</button>
          )}</For>
        </Show>
      </Show>

      <Show when={query().trim()}>
        <Show when={results()?.length}>
          <h3 class="section-title" style={{ padding: "var(--space-3) var(--space-4) 0" }}>Aufnahmen</h3>
          <For each={results()}>{(r) => <RecordingRow recording={r} showProject={true} />}</For>
        </Show>

        <Show when={matchingProjects().length}>
          <h3 class="section-title" style={{ padding: "var(--space-3) var(--space-4) 0" }}>Projekte</h3>
          <For each={matchingProjects()}>{(p) => (
            <button class="search-recent" onClick={() => navigate(`/projects/${p.id}`)}>📁 {p.name}</button>
          )}</For>
        </Show>

        <Show when={matchingTags().length}>
          <h3 class="section-title" style={{ padding: "var(--space-3) var(--space-4) 0" }}>Tags</h3>
          <For each={matchingTags()}>{(t) => (
            <button class="search-recent" onClick={() => navigate(`/library?tag=${encodeURIComponent(t.name)}`)}>#{t.name}</button>
          )}</For>
        </Show>
      </Show>
    </>
  );
}
