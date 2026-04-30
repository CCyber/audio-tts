import { For, Show, createSignal } from "solid-js";
import { Recording, api } from "../../lib/api";
import { libraryState, upsertRecording, removeRecording } from "../../stores/library";
import { Sheet } from "../common/Sheet";
import { Button } from "../common/Button";
import { Chip } from "../common/Chip";

type Mode = "menu" | "title" | "project" | "tags";

export function RecordingActionsSheet(props: { recording: Recording | null; onClose: () => void }) {
  const [mode, setMode] = createSignal<Mode>("menu");
  const [title, setTitle] = createSignal("");
  const [projectId, setProjectId] = createSignal<number | null>(null);
  const [tags, setTags] = createSignal<string[]>([]);
  const [tagInput, setTagInput] = createSignal("");

  const reset = () => {
    setMode("menu");
    setTitle(props.recording?.title ?? "");
    setProjectId(props.recording?.project_id ?? null);
    setTags(props.recording?.tags.map((t) => t.name) ?? []);
    setTagInput("");
  };

  let lastId: number | null = null;
  const ensureSync = () => {
    if (props.recording?.id !== lastId) {
      lastId = props.recording?.id ?? null;
      if (props.recording) reset();
    }
  };

  const save = async (patch: { title?: string; project_id?: number; tags?: string[] }) => {
    if (!props.recording) return;
    const fresh = await api.updateRecording(props.recording.id, patch);
    upsertRecording(fresh);
    props.onClose();
  };

  const onDelete = async () => {
    if (!props.recording) return;
    if (!confirm("Aufnahme wirklich löschen?")) return;
    await api.deleteRecording(props.recording.id);
    removeRecording(props.recording.id);
    props.onClose();
  };

  return (
    <Sheet open={!!props.recording} onClose={props.onClose} title={props.recording?.title ?? ""}>
      {ensureSync()}
      <Show when={mode() === "menu"}>
        <div class="action-list">
          <button class="action-item" onClick={() => setMode("title")}>Titel ändern</button>
          <button class="action-item" onClick={() => setMode("project")}>Projekt ändern</button>
          <button class="action-item" onClick={() => setMode("tags")}>Tags bearbeiten</button>
          <button class="action-item action-destructive" onClick={onDelete}>Löschen</button>
        </div>
      </Show>

      <Show when={mode() === "title"}>
        <input class="form-input" type="text" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
        <div class="form-actions">
          <Button variant="ghost" onClick={() => setMode("menu")}>Zurück</Button>
          <Button onClick={() => save({ title: title() })}>Speichern</Button>
        </div>
      </Show>

      <Show when={mode() === "project"}>
        <select class="form-input" value={projectId() ?? ""} onChange={(e) => setProjectId(Number(e.currentTarget.value))}>
          <For each={libraryState.projects}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <div class="form-actions">
          <Button variant="ghost" onClick={() => setMode("menu")}>Zurück</Button>
          <Button onClick={() => save({ project_id: projectId() ?? undefined })}>Speichern</Button>
        </div>
      </Show>

      <Show when={mode() === "tags"}>
        <div class="tag-editor">
          <For each={tags()}>{(t) => (
            <Chip removable onRemove={() => setTags(tags().filter((x) => x !== t))}>#{t}</Chip>
          )}</For>
          <input
            class="form-input tag-editor-input"
            type="text"
            placeholder="Tag hinzufügen"
            value={tagInput()}
            onInput={(e) => setTagInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = tagInput().trim().toLowerCase();
                if (v && !tags().includes(v)) setTags([...tags(), v]);
                setTagInput("");
              }
            }}
          />
        </div>
        <div class="form-actions">
          <Button variant="ghost" onClick={() => setMode("menu")}>Zurück</Button>
          <Button onClick={() => save({ tags: tags() })}>Speichern</Button>
        </div>
      </Show>
    </Sheet>
  );
}
