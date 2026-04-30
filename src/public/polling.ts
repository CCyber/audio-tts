import { api, type Recording } from "./api.js";

const PENDING = new Set<number>();
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 1000;

export function register(id: number): void {
  PENDING.add(id);
  ensureTimer();
}

export function unregister(id: number): void {
  PENDING.delete(id);
  if (PENDING.size === 0) stopTimer();
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(tick, TICK_MS);
}

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (PENDING.size === 0) {
    stopTimer();
    return;
  }
  const ids = [...PENDING];
  const results = await Promise.allSettled(ids.map((id) => api.getRecording(id)));
  results.forEach((res, i) => {
    const id = ids[i];
    if (res.status === "rejected") return; // try again next tick
    const rec: Recording = res.value;
    document.dispatchEvent(new CustomEvent("aria:recording-updated", { detail: rec }));
    if (rec.status !== "generating") {
      PENDING.delete(id);
    }
  });
  if (PENDING.size === 0) stopTimer();
}
