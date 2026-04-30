import { For, createMemo, createEffect, createSignal, on } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { Header } from "../components/shell/Header";
import { RecordingRow } from "../components/tile/RecordingRow";
import { RecordingActionsSheet } from "../components/tile/RecordingActionsSheet";
import { Chip } from "../components/common/Chip";
import { libraryState } from "../stores/library";
import { uiState, setLibraryFilter } from "../stores/ui";
import type { Recording } from "../lib/api";

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionsRec, setActionsRec] = createSignal<Recording | null>(null);

  createEffect(on(() => searchParams.tag, (tag) => {
    setLibraryFilter({ tag: typeof tag === "string" ? tag : undefined });
  }));

  const filtered = createMemo(() => {
    const f = uiState.libraryFilter;
    let recs = [...libraryState.recordings];
    if (f.tag) recs = recs.filter((r) => r.tags.some((t) => t.name === f.tag));
    if (f.sort === "newest") recs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (f.sort === "oldest") recs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (f.sort === "title") recs.sort((a, b) => a.title.localeCompare(b.title));
    return recs;
  });

  const setTag = (tag: string | undefined) => {
    setSearchParams({ tag: tag ?? null });
  };

  return (
    <>
      <Header title={<span>Library</span>} />
      <div class="scroll-snap-x" style={{ padding: "var(--space-3) var(--space-4) var(--space-2)" }}>
        <Chip active={!uiState.libraryFilter.tag} onClick={() => setTag(undefined)}>Alle</Chip>
        <For each={libraryState.tags}>{(t) => (
          <Chip active={uiState.libraryFilter.tag === t.name} onClick={() => setTag(t.name)}>#{t.name}</Chip>
        )}</For>
      </div>
      <div style={{ padding: "0 var(--space-4) var(--space-2)" }}>
        <select
          class="form-input"
          value={uiState.libraryFilter.sort}
          onChange={(e) => setLibraryFilter({ sort: e.currentTarget.value as any })}
          style={{ width: "auto" }}
        >
          <option value="newest">Neueste</option>
          <option value="oldest">Älteste</option>
          <option value="title">Titel A–Z</option>
        </select>
      </div>
      <For each={filtered()}>{(r) => <RecordingRow recording={r} showProject={true} onMore={() => setActionsRec(r)} />}</For>
      <RecordingActionsSheet recording={actionsRec()} onClose={() => setActionsRec(null)} />
    </>
  );
}
