import { api } from "./api.js";
import { store } from "./state.js";
import { initSidebar } from "./sidebar.js";
import { initLibrary } from "./library.js";
import { initGenerateModal } from "./generate.js";

document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  initLibrary();
  initGenerateModal();
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
