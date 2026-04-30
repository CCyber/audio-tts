import { Show, createSignal } from "solid-js";
import { Project, api } from "../../lib/api";
import { upsertProject, removeProject } from "../../stores/library";
import { Sheet } from "../common/Sheet";
import { Button } from "../common/Button";

type Mode = "menu" | "rename";

export function ProjectActionsSheet(props: { project: Project | null; onClose: () => void }) {
  const [mode, setMode] = createSignal<Mode>("menu");
  const [name, setName] = createSignal("");

  let lastId: number | null = null;
  const ensureSync = () => {
    if (props.project && props.project.id !== lastId) {
      lastId = props.project.id;
      setMode("menu");
      setName(props.project.name);
    }
  };

  const onRename = async () => {
    if (!props.project) return;
    const updated = await api.renameProject(props.project.id, name());
    upsertProject(updated);
    props.onClose();
  };

  const onDelete = async () => {
    if (!props.project) return;
    if (!confirm(`Projekt „${props.project.name}" löschen? Aufnahmen werden in die Inbox verschoben.`)) return;
    await api.deleteProject(props.project.id);
    removeProject(props.project.id);
    props.onClose();
  };

  const isInbox = () => props.project?.is_system === 1;

  return (
    <Sheet open={!!props.project} onClose={props.onClose} title={props.project?.name ?? ""}>
      {ensureSync()}
      <Show when={mode() === "menu"}>
        <div class="action-list">
          <button class="action-item" disabled={isInbox()} onClick={() => setMode("rename")}>Umbenennen</button>
          <button class="action-item action-destructive" disabled={isInbox()} onClick={onDelete}>Löschen</button>
        </div>
        <Show when={isInbox()}>
          <p class="caption" style={{ padding: "var(--space-2) 0" }}>Inbox kann nicht geändert werden.</p>
        </Show>
      </Show>

      <Show when={mode() === "rename"}>
        <input class="form-input" type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        <div class="form-actions">
          <Button variant="ghost" onClick={() => setMode("menu")}>Zurück</Button>
          <Button onClick={onRename}>Speichern</Button>
        </div>
      </Show>
    </Sheet>
  );
}
