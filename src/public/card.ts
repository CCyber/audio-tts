import type { Recording } from "./api.js";
import { api } from "./api.js";
import { store } from "./state.js";
import { register as registerPolling } from "./polling.js";

export function renderCard(r: Recording): HTMLElement {
  const card = document.createElement("div");
  card.className = `card card-status-${r.status}`;
  card.dataset.recordingId = String(r.id);

  if (r.status === "generating") {
    card.appendChild(renderHeader(r));
    card.appendChild(renderGeneratingBody(r));
    registerPolling(r.id);
    return card;
  }
  if (r.status === "failed") {
    card.appendChild(renderHeader(r));
    card.appendChild(renderFailedBody(r));
    return card;
  }
  // done
  card.appendChild(renderHeader(r));
  card.appendChild(renderMeta(r));
  card.appendChild(renderTags(r));
  card.appendChild(renderAudio(r));
  return card;
}

function renderGeneratingBody(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-generating";

  const bar = document.createElement("progress");
  bar.value = r.progress_done;
  bar.max = r.progress_total || 1;
  bar.className = "progress-bar";
  wrap.appendChild(bar);

  const status = document.createElement("div");
  status.className = "card-progress-status";
  status.textContent = "Vertonung läuft…";
  wrap.appendChild(status);

  const detail = document.createElement("div");
  detail.className = "card-progress-detail";
  detail.textContent = formatProgressDetail(r);
  wrap.appendChild(detail);

  const cancel = document.createElement("button");
  cancel.className = "btn-ghost";
  cancel.textContent = "Abbrechen";
  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    cancel.textContent = "Wird abgebrochen…";
    try {
      await api.cancelRecording(r.id);
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    } catch (e) {
      cancel.disabled = false;
      cancel.textContent = "Abbrechen";
      alert((e as Error).message);
    }
  });
  wrap.appendChild(cancel);

  return wrap;
}

function renderFailedBody(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-failed";

  const banner = document.createElement("div");
  banner.className = "fail-banner";
  banner.textContent = r.error ?? "Vertonung fehlgeschlagen";
  wrap.appendChild(banner);

  const actions = document.createElement("div");
  actions.className = "card-failed-actions";

  const retry = document.createElement("button");
  retry.className = "btn-primary";
  retry.textContent = "Erneut versuchen";
  retry.addEventListener("click", async () => {
    retry.disabled = true;
    try {
      const updated = await api.retryRecording(r.id);
      registerPolling(updated.id);
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    } catch (e) {
      retry.disabled = false;
      alert((e as Error).message);
    }
  });
  actions.appendChild(retry);

  const del = document.createElement("button");
  del.className = "btn-ghost";
  del.textContent = "Löschen";
  del.addEventListener("click", async () => {
    if (!confirm(`Aufnahme "${r.title}" wirklich löschen?`)) return;
    await api.deleteRecording(r.id);
    document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
  });
  actions.appendChild(del);

  wrap.appendChild(actions);
  return wrap;
}

function formatProgressDetail(r: Recording): string {
  // "Abschnitt 3 von 8" — 1-based, the chunk currently being worked on.
  const current = Math.min(r.progress_done + 1, r.progress_total);
  return `Abschnitt ${current} von ${r.progress_total}`;
}

export function applyRecordingUpdate(r: Recording): void {
  const el = document.querySelector<HTMLElement>(
    `.card[data-recording-id="${r.id}"]`
  );
  if (!el) return;

  if (el.classList.contains(`card-status-${r.status}`)) {
    // Same status, just update progress bar + detail.
    if (r.status === "generating") {
      const bar = el.querySelector<HTMLProgressElement>("progress.progress-bar");
      const detail = el.querySelector<HTMLElement>(".card-progress-detail");
      if (bar) {
        bar.value = r.progress_done;
        bar.max = r.progress_total || 1;
      }
      if (detail) detail.textContent = formatProgressDetail(r);
    }
    return;
  }
  // Status changed — replace the card entirely.
  const fresh = renderCard(r);
  el.replaceWith(fresh);
}

function renderHeader(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-header";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = r.title;
  title.contentEditable = "true";
  title.addEventListener("blur", async () => {
    const newTitle = (title.textContent ?? "").trim();
    if (newTitle && newTitle !== r.title) {
      try {
        await api.updateRecording(r.id, { title: newTitle });
        r.title = newTitle;
      } catch (e) {
        title.textContent = r.title;
        alert((e as Error).message);
      }
    } else {
      title.textContent = r.title;
    }
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    }
  });

  const menu = renderMenu(r);

  wrap.appendChild(title);
  wrap.appendChild(menu);
  return wrap;
}

function renderMenu(r: Recording): HTMLElement {
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown";
  dropdown.innerHTML = `<button class="btn-icon">…</button>`;
  const trigger = dropdown.querySelector("button") as HTMLButtonElement;

  const menu = document.createElement("div");
  menu.className = "dropdown-menu";
  menu.style.display = "none";

  // Verschieben
  const moveLabel = document.createElement("div");
  moveLabel.style.padding = "8px 12px";
  moveLabel.style.color = "#888";
  moveLabel.style.fontSize = "12px";
  moveLabel.textContent = "In Projekt verschieben:";
  menu.appendChild(moveLabel);
  for (const p of store.state.projects) {
    if (p.id === r.project_id) continue;
    const opt = document.createElement("button");
    opt.textContent = p.name;
    opt.addEventListener("click", async () => {
      await api.updateRecording(r.id, { project_id: p.id });
      const recs = await api.listRecordings({
        projectId: store.state.selectedProjectId,
        tags: store.state.activeTagFilters.length > 0 ? store.state.activeTagFilters : undefined,
        q: store.state.searchQuery || undefined,
      });
      store.set({ recordings: recs, projects: await api.listProjects() });
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    });
    menu.appendChild(opt);
  }

  const tplBtn = document.createElement("button");
  tplBtn.textContent = "Als Vorlage";
  tplBtn.addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("aria:open-generate-modal", {
        detail: {
          text: r.original_text,
          voice: r.voice,
          model: r.model,
          tags: r.tags.map((t) => t.name),
          title: "",
        },
      })
    );
  });
  menu.appendChild(tplBtn);

  const dlBtn = document.createElement("button");
  dlBtn.textContent = "Download";
  dlBtn.addEventListener("click", () => {
    window.location.href = `/api/recordings/${r.id}/download`;
  });
  menu.appendChild(dlBtn);

  const delBtn = document.createElement("button");
  delBtn.textContent = "Löschen";
  delBtn.style.color = "#c00";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Aufnahme "${r.title}" wirklich löschen?`)) return;
    await api.deleteRecording(r.id);
    document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
    store.set({ tags: await api.listTags(), projects: await api.listProjects() });
  });
  menu.appendChild(delBtn);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  dropdown.appendChild(menu);
  return dropdown;
}

function renderMeta(r: Recording): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = `${formatDate(r.created_at)} · ${r.voice} · ${r.model} · ${formatDuration(r.duration_ms)}`;
  return meta;
}

function renderTags(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-tags";
  for (const t of r.tags) {
    const pill = document.createElement("span");
    pill.className = "tag-pill removable";
    pill.textContent = `#${t.name}`;
    pill.addEventListener("click", async () => {
      const newTags = r.tags.filter((x) => x.id !== t.id).map((x) => x.name);
      const updated = await api.updateRecording(r.id, { tags: newTags });
      r.tags = updated.tags;
      pill.remove();
      store.set({ tags: await api.listTags() });
    });
    wrap.appendChild(pill);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "btn-icon";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", async () => {
    const name = window.prompt("Tag hinzufügen:")?.trim();
    if (!name) return;
    const newTags = [...r.tags.map((x) => x.name), name];
    const updated = await api.updateRecording(r.id, { tags: newTags });
    r.tags = updated.tags;
    wrap.replaceWith(renderTags(r));
    store.set({ tags: await api.listTags() });
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function renderAudio(r: Recording): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "card-audio";
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = `/api/recordings/${r.id}/audio`;
  wrap.appendChild(audio);
  return wrap;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
