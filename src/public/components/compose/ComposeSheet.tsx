import { For, Show, createSignal, createResource, createEffect } from "solid-js";
import { Sheet } from "../common/Sheet";
import { Button } from "../common/Button";
import { Chip } from "../common/Chip";
import { uiState, closeCompose } from "../../stores/ui";
import { libraryState, upsertRecording } from "../../stores/library";
import { api } from "../../lib/api";

const VOICE_VAR: Record<string, string> = {
  alloy: "var(--voice-alloy)", echo: "var(--voice-echo)", fable: "var(--voice-fable)",
  onyx: "var(--voice-onyx)", nova: "var(--voice-nova)", shimmer: "var(--voice-shimmer)",
};

export function ComposeSheet() {
  const [text, setText] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [voice, setVoice] = createSignal("alloy");
  const [model, setModel] = createSignal("tts-1");
  const [projectId, setProjectId] = createSignal<number | null>(null);
  const [tagInput, setTagInput] = createSignal("");
  const [tags, setTags] = createSignal<string[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [voices] = createResource(api.listVoices);
  const [models] = createResource(api.listModels);

  createEffect(() => {
    if (projectId() === null && libraryState.projects.length > 0) {
      const inbox = libraryState.projects.find((p) => p.is_system) ?? libraryState.projects[0];
      setProjectId(inbox.id);
    }
  });

  const reset = () => {
    setText(""); setTitle(""); setVoice("alloy"); setModel("tts-1");
    setTagInput(""); setTags([]); setError(null);
  };

  const addTag = () => {
    const t = tagInput().trim().toLowerCase();
    if (t && !tags().includes(t)) setTags([...tags(), t]);
    setTagInput("");
  };

  const submit = async () => {
    if (!text().trim()) { setError("Text darf nicht leer sein"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("text", text());
      form.append("voice", voice());
      form.append("model", model());
      if (title().trim()) form.append("title", title().trim());
      if (projectId() !== null) form.append("project_id", String(projectId()));
      tags().forEach((t) => form.append("tags", t));

      const recording = await api.generateRecording(form);
      upsertRecording(recording);
      reset();
      closeCompose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={uiState.composeOpen} onClose={closeCompose} title="Neue Aufnahme">
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>

      <textarea
        class="form-input compose-textarea"
        placeholder="Text eingeben oder einfügen…"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
      />

      <label class="form-label">Titel (optional)</label>
      <input class="form-input" type="text" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />

      <label class="form-label">Stimme</label>
      <div class="voice-grid">
        <For each={voices() ?? []}>{(v) => (
          <button
            class={`voice-chip ${voice() === v._id ? "voice-chip-active" : ""}`}
            style={{ background: VOICE_VAR[v._id] ?? "var(--voice-alloy)" }}
            onClick={() => setVoice(v._id)}
          >{v.title}</button>
        )}</For>
      </div>

      <label class="form-label">Modell</label>
      <div class="radio-row">
        <For each={models() ?? []}>{(m) => (
          <label class="radio-label">
            <input type="radio" name="model" value={m} checked={model() === m} onChange={() => setModel(m)} />
            <span>{m}</span>
          </label>
        )}</For>
      </div>

      <label class="form-label">Projekt</label>
      <select
        class="form-input"
        value={projectId() ?? ""}
        onChange={(e) => setProjectId(Number(e.currentTarget.value))}
      >
        <For each={libraryState.projects}>{(p) => (
          <option value={p.id}>{p.name}</option>
        )}</For>
      </select>

      <label class="form-label">Tags</label>
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
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          onBlur={addTag}
        />
      </div>

      <div class="form-actions">
        <Button variant="ghost" onClick={closeCompose} disabled={submitting()}>Abbrechen</Button>
        <Button onClick={submit} disabled={submitting()}>
          {submitting() ? "Erstelle…" : "Generieren"}
        </Button>
      </div>
    </Sheet>
  );
}
