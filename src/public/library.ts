import { api } from "./api.js";
import { store } from "./state.js";
import { renderCard } from "./card.js";

let searchDebounce: ReturnType<typeof setTimeout> | undefined;

export function initLibrary(): void {
  document.addEventListener("aria:reload-recordings", reload);
  store.subscribe(() => renderHeader());
  renderHeader();
  reload();
}

function renderHeader(): void {
  const headerEl = document.getElementById("project-header") as HTMLElement;
  const toolbarEl = document.getElementById("toolbar") as HTMLElement;
  const project = store.state.projects.find(
    (p) => p.id === store.state.selectedProjectId
  );

  headerEl.innerHTML = "";
  if (!project) return;

  const title = document.createElement("h1");
  title.textContent = project.name;
  if (!project.is_system) {
    title.contentEditable = "true";
    title.addEventListener("blur", async () => {
      const newName = (title.textContent ?? "").trim();
      if (newName && newName !== project.name) {
        try {
          await api.renameProject(project.id, newName);
          store.set({ projects: await api.listProjects() });
        } catch (e) {
          title.textContent = project.name;
          alert((e as Error).message);
        }
      } else {
        title.textContent = project.name;
      }
    });
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        (title as HTMLElement).blur();
      }
    });
  }
  headerEl.appendChild(title);

  if (!project.is_system) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-ghost";
    delBtn.textContent = "Projekt löschen";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Projekt "${project.name}" wirklich löschen? Aufnahmen werden in die Inbox verschoben.`))
        return;
      await api.deleteProject(project.id);
      store.set({
        selectedProjectId: 1,
        projects: await api.listProjects(),
      });
      reload();
    });
    headerEl.appendChild(delBtn);
  }

  toolbarEl.innerHTML = "";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Suchen…";
  search.value = store.state.searchQuery;
  search.addEventListener("input", () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      store.set({ searchQuery: search.value });
      reload();
    }, 300);
  });
  toolbarEl.appendChild(search);

  for (const tag of store.state.activeTagFilters) {
    const chip = document.createElement("span");
    chip.className = "tag-pill removable";
    chip.textContent = `#${tag}`;
    chip.addEventListener("click", () => {
      store.set({
        activeTagFilters: store.state.activeTagFilters.filter((x) => x !== tag),
      });
      reload();
    });
    toolbarEl.appendChild(chip);
  }

  const newBtn = document.createElement("button");
  newBtn.className = "btn-primary";
  newBtn.textContent = "+ Neue Aufnahme";
  newBtn.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("aria:open-generate-modal", { detail: {} }));
  });
  toolbarEl.appendChild(newBtn);
}

async function reload(): Promise<void> {
  const listEl = document.getElementById("recording-list") as HTMLElement;
  try {
    const recordings = await api.listRecordings({
      projectId: store.state.selectedProjectId,
      tags: store.state.activeTagFilters.length > 0 ? store.state.activeTagFilters : undefined,
      q: store.state.searchQuery || undefined,
    });
    store.set({ recordings });

    listEl.innerHTML = "";
    if (recordings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = store.state.searchQuery || store.state.activeTagFilters.length > 0
        ? "Keine Aufnahmen gefunden"
        : "Noch keine Aufnahmen in diesem Projekt";
      listEl.appendChild(empty);
      return;
    }

    for (const r of recordings) {
      listEl.appendChild(renderCard(r));
    }
  } catch (e) {
    console.error("Failed to load recordings:", e);
  }
}
