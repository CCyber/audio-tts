import { For, createSignal } from "solid-js";
import { Header } from "../components/shell/Header";
import { ProjectTile } from "../components/tile/ProjectTile";
import { ProjectActionsSheet } from "../components/tile/ProjectActionsSheet";
import { Sheet } from "../components/common/Sheet";
import { Button } from "../components/common/Button";
import { IconButton } from "../components/common/IconButton";
import { libraryState, upsertProject } from "../stores/library";
import { api } from "../lib/api";
import type { Project } from "../lib/api";

export function Projects() {
  const [creating, setCreating] = createSignal(false);
  const [name, setName] = createSignal("");
  const [actionsProj, setActionsProj] = createSignal<Project | null>(null);

  const submit = async () => {
    const trimmed = name().trim();
    if (!trimmed) return;
    const project = await api.createProject(trimmed);
    upsertProject(project);
    setName("");
    setCreating(false);
  };

  return (
    <>
      <Header
        title={<span>Projekte</span>}
        right={<IconButton icon="grid" label="Neu" onClick={() => setCreating(true)} />}
      />
      <div class="proj-grid">
        <For each={libraryState.projects}>{(p) => <ProjectTile project={p} size={160} onMore={() => setActionsProj(p)} />}</For>
      </div>

      <ProjectActionsSheet project={actionsProj()} onClose={() => setActionsProj(null)} />
      <Sheet open={creating()} onClose={() => setCreating(false)} title="Neues Projekt">
        <input
          type="text"
          class="form-input"
          placeholder="Projektname"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "var(--space-2)", "margin-top": "var(--space-3)" }}>
          <Button variant="ghost" onClick={() => setCreating(false)}>Abbrechen</Button>
          <Button onClick={submit}>Erstellen</Button>
        </div>
      </Sheet>
    </>
  );
}
