// Aria — TTS Frontend Application
// This file is compiled to app.js and served as a static asset.

interface Voice {
  _id: string;
  title: string;
  description?: string;
}

interface VoicesResponse {
  items: Voice[];
}

interface TTSResponse {
  success: boolean;
  filename: string;
  size: number;
  chunks: number;
  download_url: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

// ─── DOM Elements ───────────────────────────────────

const textInput = document.getElementById("textInput") as HTMLTextAreaElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const fileName = document.getElementById("fileName") as HTMLSpanElement;
const charCount = document.getElementById("charCount") as HTMLParagraphElement;
const voiceSelect = document.getElementById("voiceSelect") as HTMLSelectElement;
const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const generateBtn = document.getElementById("generateBtn") as HTMLButtonElement;

const progressSection = document.getElementById("progressSection") as HTMLElement;
const progressFill = document.getElementById("progressFill") as HTMLElement;
const progressText = document.getElementById("progressText") as HTMLParagraphElement;

const resultSection = document.getElementById("resultSection") as HTMLElement;
const audioPlayer = document.getElementById("audioPlayer") as HTMLAudioElement;
const downloadLink = document.getElementById("downloadLink") as HTMLAnchorElement;

const errorSection = document.getElementById("errorSection") as HTMLElement;
const errorText = document.getElementById("errorText") as HTMLParagraphElement;

// ─── State ──────────────────────────────────────────

let uploadedFile: File | null = null;

// ─── Voices ─────────────────────────────────────────

async function loadVoices(): Promise<void> {
  voiceSelect.disabled = true;
  voiceSelect.innerHTML = '<option value="">Stimmen werden geladen...</option>';
  hideError();

  try {
    const res = await fetch("/api/voices");
    if (!res.ok) {
      const err: ErrorResponse = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data: VoicesResponse = await res.json();
    const voices = data.items || [];

    if (voices.length === 0) {
      voiceSelect.innerHTML = '<option value="">Keine Stimmen gefunden</option>';
      return;
    }

    voiceSelect.innerHTML = '<option value="">-- Stimme auswählen --</option>';
    voices.forEach((voice) => {
      const opt = document.createElement("option");
      opt.value = voice._id;
      opt.textContent = voice.title || voice._id;
      if (voice.description) {
        opt.title = voice.description;
      }
      voiceSelect.appendChild(opt);
    });

    voiceSelect.disabled = false;
    updateGenerateButton();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    voiceSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
    showError(`Stimmen konnten nicht geladen werden: ${message}`);
  }
}

// ─── Text Input ─────────────────────────────────────

function updateCharCount(): void {
  const len = textInput.value.length;
  charCount.textContent = `${len.toLocaleString("de-DE")} Zeichen`;
}

textInput.addEventListener("input", () => {
  updateCharCount();
  updateGenerateButton();
});

// ─── File Upload ────────────────────────────────────

fileInput.addEventListener("change", () => {
  const files = fileInput.files;
  if (files && files.length > 0) {
    uploadedFile = files[0];
    fileName.textContent = uploadedFile.name;

    // Read and show file content in textarea
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      textInput.value = content;
      updateCharCount();
      updateGenerateButton();
    };
    reader.readAsText(uploadedFile);
  }
});

// ─── Generate Button State ──────────────────────────

function updateGenerateButton(): void {
  const hasText = textInput.value.trim().length > 0;
  const hasVoice = voiceSelect.value !== "";
  generateBtn.disabled = !(hasText && hasVoice);
}

voiceSelect.addEventListener("change", updateGenerateButton);

// ─── Progress ───────────────────────────────────────

function showProgress(text: string, percent: number): void {
  progressSection.classList.remove("hidden");
  progressText.textContent = text;
  progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

function hideProgress(): void {
  progressSection.classList.add("hidden");
  progressFill.style.width = "0%";
}

// ─── Result ─────────────────────────────────────────

function showResult(downloadUrl: string): void {
  resultSection.classList.remove("hidden");
  audioPlayer.src = downloadUrl;
  downloadLink.href = downloadUrl;
}

function hideResult(): void {
  resultSection.classList.add("hidden");
  audioPlayer.src = "";
  downloadLink.href = "#";
}

// ─── Error ──────────────────────────────────────────

function showError(message: string): void {
  errorSection.classList.remove("hidden");
  errorText.textContent = message;
}

function hideError(): void {
  errorSection.classList.add("hidden");
  errorText.textContent = "";
}

// ─── Generate TTS ───────────────────────────────────

async function generateTTS(): Promise<void> {
  hideError();
  hideResult();

  const text = textInput.value.trim();
  const referenceId = voiceSelect.value;
  const model = modelSelect.value;

  if (!text) {
    showError("Bitte Text eingeben oder eine .txt Datei hochladen.");
    return;
  }

  if (!referenceId) {
    showError("Bitte eine Stimme auswählen.");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = "Wird generiert...";
  showProgress("Sende Anfrage an OpenAI API...", 10);

  try {
    // Build FormData to support both text and file upload
    const formData = new FormData();
    formData.append("text", text);
    formData.append("reference_id", referenceId);
    formData.append("model", model);

    showProgress("Generiere Audio...", 30);

    const res = await fetch("/api/tts", {
      method: "POST",
      body: formData,
    });

    showProgress("Verarbeite Antwort...", 70);

    if (!res.ok) {
      const err: ErrorResponse = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data: TTSResponse = await res.json();

    showProgress("Fertig!", 100);

    // Short delay so the user sees 100%
    setTimeout(() => {
      hideProgress();
      showResult(data.download_url);
    }, 600);
  } catch (err: unknown) {
    hideProgress();
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    showError(`Generierung fehlgeschlagen: ${message}`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generieren";
    updateGenerateButton();
  }
}

generateBtn.addEventListener("click", generateTTS);

// ─── Init ───────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadVoices();
  updateCharCount();
});
