import { api } from "./api";
import { store } from "./state";

export function initSidebar(): void {
  const projectListEl = document.getElementById("project-list") as HTMLUListElement;
  const tagListEl = document.getElementById("tag-list") as HTMLUListElement;
  const addProjectBtn = document.getElementById("add-project-btn") as HTMLButtonElement;

  store.subscribe(() => render());
  render();

  addProjectBtn.addEventListener("click", () => promptCreateProject());

  function render() {
    projectListEl.innerHTML = "";
    for (const p of store.state.projects) {
      const li = document.createElement("li");
      if (p.id === store.state.selectedProjectId && store.state.activeTagFilters.length === 0) {
        li.classList.add("active");
      }
      li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="count">${p.recording_count}</span>`;
      li.addEventListener("click", () => {
        store.set({
          selectedProjectId: p.id,
          activeTagFilters: [],
          searchQuery: "",
        });
        triggerReload();
      });
      projectListEl.appendChild(li);
    }

    tagListEl.innerHTML = "";
    for (const t of store.state.tags) {
      const li = document.createElement("li");
      if (store.state.activeTagFilters.includes(t.name)) li.classList.add("active");
      li.innerHTML = `<span>#${escapeHtml(t.name)}</span><span class="count">${t.count}</span>`;
      li.addEventListener("click", () => {
        const isActive = store.state.activeTagFilters.includes(t.name);
        store.set({
          activeTagFilters: isActive
            ? store.state.activeTagFilters.filter((x) => x !== t.name)
            : [...store.state.activeTagFilters, t.name],
        });
        triggerReload();
      });
      tagListEl.appendChild(li);
    }
  }

  async function promptCreateProject() {
    const name = window.prompt("Name des neuen Projekts:")?.trim();
    if (!name) return;
    try {
      await api.createProject(name);
      const projects = await api.listProjects();
      store.set({ projects });
    } catch (e) {
      alert((e as Error).message);
    }
  }
}

export function triggerReload(): void {
  document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
