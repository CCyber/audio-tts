import { api } from "./api";
import { store } from "./state";
import { initSidebar } from "./sidebar";

document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  await loadInitial();
});

async function loadInitial() {
  try {
    const [projects, tags, voices, models] = await Promise.all([
      api.listProjects(),
      api.listTags(),
      api.listVoices(),
      api.listModels(),
    ]);
    store.set({ projects, tags, voices, models });
  } catch (e) {
    console.error("Failed to load initial data:", e);
  }
}
