import { api } from "./api.js";
import { store } from "./state.js";

interface PrefilledFields {
  text?: string;
  voice?: string;
  model?: string;
  tags?: string[];
  title?: string;
}

export function initGenerateModal(): void {
  document.addEventListener("aria:open-generate-modal", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as PrefilledFields | undefined;
    open(detail ?? {});
  });
}

function open(prefilled: PrefilledFields): void {
  const root = document.getElementById("modal-root") as HTMLElement;
  root.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const modal = document.createElement("div");
  modal.className = "modal";

  modal.innerHTML = `
    <h2>Neue Aufnahme</h2>
    <div id="modal-error" class="error-banner" style="display:none"></div>
    <div class="form-group">
      <label>Text</label>
      <textarea id="gen-text"></textarea>
      <small id="gen-charcount" style="color:#888"></small>
    </div>
    <div class="form-group">
      <label>Optional: Titel</label>
      <input id="gen-title" type="text" placeholder="Wird automatisch aus Text generiert" />
    </div>
    <div class="form-group">
      <label>Stimme</label>
      <select id="gen-voice"></select>
    </div>
    <div class="form-group">
      <label>Modell</label>
      <select id="gen-model"></select>
    </div>
    <div class="form-group">
      <label>Projekt</label>
      <select id="gen-project"></select>
    </div>
    <div class="form-group">
      <label>Tags (Komma-getrennt)</label>
      <input id="gen-tags" type="text" placeholder="z.B. urgent, lernen" />
    </div>
    <div class="form-actions">
      <button id="gen-cancel" class="btn-ghost">Abbrechen</button>
      <button id="gen-submit" class="btn-primary">Generieren</button>
    </div>
  `;

  backdrop.appendChild(modal);
  root.appendChild(backdrop);

  const textEl = modal.querySelector("#gen-text") as HTMLTextAreaElement;
  const titleEl = modal.querySelector("#gen-title") as HTMLInputElement;
  const voiceEl = modal.querySelector("#gen-voice") as HTMLSelectElement;
  const modelEl = modal.querySelector("#gen-model") as HTMLSelectElement;
  const projectEl = modal.querySelector("#gen-project") as HTMLSelectElement;
  const tagsEl = modal.querySelector("#gen-tags") as HTMLInputElement;
  const charCountEl = modal.querySelector("#gen-charcount") as HTMLElement;
  const errorEl = modal.querySelector("#modal-error") as HTMLElement;
  const submitBtn = modal.querySelector("#gen-submit") as HTMLButtonElement;
  const cancelBtn = modal.querySelector("#gen-cancel") as HTMLButtonElement;

  for (const v of store.state.voices) {
    const opt = document.createElement("option");
    opt.value = v._id;
    opt.textContent = v.title;
    voiceEl.appendChild(opt);
  }
  for (const m of store.state.models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelEl.appendChild(opt);
  }
  for (const p of store.state.projects) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = p.name;
    projectEl.appendChild(opt);
  }

  textEl.value = prefilled.text ?? "";
  titleEl.value = prefilled.title ?? "";
  voiceEl.value = prefilled.voice ?? "nova";
  if (prefilled.model) modelEl.value = prefilled.model;
  projectEl.value = String(store.state.selectedProjectId);
  tagsEl.value = (prefilled.tags ?? []).join(", ");

  function updateCount() {
    charCountEl.textContent = `${textEl.value.length.toLocaleString("de-DE")} Zeichen`;
  }
  textEl.addEventListener("input", updateCount);
  updateCount();

  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  submitBtn.addEventListener("click", async () => {
    const text = textEl.value.trim();
    if (!text) {
      showError("Bitte Text eingeben.");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Wird gesendet…";
    errorEl.style.display = "none";
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("voice", voiceEl.value);
      form.append("model", modelEl.value);
      form.append("project_id", projectEl.value);
      if (titleEl.value.trim()) form.append("title", titleEl.value.trim());
      const tags = tagsEl.value.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
      for (const t of tags) form.append("tags[]", t);

      await api.generateRecording(form);
      close();
      document.dispatchEvent(new CustomEvent("aria:reload-recordings"));
      const [projects, tagsList] = await Promise.all([api.listProjects(), api.listTags()]);
      store.set({ projects, tags: tagsList });
    } catch (e) {
      showError((e as Error).message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Generieren";
    }
  });

  function close() {
    root.innerHTML = "";
  }

  function showError(msg: string) {
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }
}
