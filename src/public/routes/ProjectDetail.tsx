import { For, Show, createMemo, createSignal } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Header } from "../components/shell/Header";
import { RecordingRow } from "../components/tile/RecordingRow";
import { RecordingActionsSheet } from "../components/tile/RecordingActionsSheet";
import { IconButton } from "../components/common/IconButton";
import { libraryState } from "../stores/library";
import type { Recording } from "../lib/api";

export function ProjectDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const [actionsRec, setActionsRec] = createSignal<Recording | null>(null);
  const projectId = () => Number(params.id);
  const project = createMemo(() => libraryState.projects.find((p) => p.id === projectId()));
  const recordings = createMemo(() =>
    [...libraryState.recordings].filter((r) => r.project_id === projectId()).sort((a, b) => b.created_at.localeCompare(a.created_at))
  );

  return (
    <>
      <Header
        left={<IconButton icon="chevronLeft" label="Zurück" onClick={() => navigate("/projects")} />}
        title={<Show when={project()}>{(p) => <span>{p().name}</span>}</Show>}
      />
      <div class="proj-detail-meta caption" style={{ padding: "0 var(--space-4) var(--space-3)" }}>
        {project()?.recording_count ?? 0} Aufnahmen
      </div>
      <For each={recordings()}>{(r) => <RecordingRow recording={r} onMore={() => setActionsRec(r)} />}</For>
      <RecordingActionsSheet recording={actionsRec()} onClose={() => setActionsRec(null)} />
    </>
  );
}
