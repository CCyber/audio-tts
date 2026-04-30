import type { Recording } from "./api";

export function renderCard(r: Recording): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-header"><div class="card-title">${escapeHtml(r.title)}</div></div>
    <div class="card-meta">${formatDate(r.created_at)} · ${r.voice} · ${r.model} · ${formatDuration(r.duration_ms)}</div>
    <div class="card-tags"></div>
    <div class="card-audio"><audio controls src="/api/recordings/${r.id}/audio"></audio></div>
  `;
  return card;
}

function formatDuration(ms: number): string {
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
