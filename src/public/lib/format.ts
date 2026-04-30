export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs === undefined) return "—";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatRelative(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "gerade eben";
  if (diffSec < 3600) return `vor ${Math.floor(diffSec / 60)} Min.`;
  if (diffSec < 86400) return `vor ${Math.floor(diffSec / 3600)} Std.`;
  if (diffSec < 7 * 86400) return `vor ${Math.floor(diffSec / 86400)} Tagen`;
  return new Date(isoDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function voiceInitial(voice: string): string {
  return (voice[0] ?? "?").toUpperCase();
}

export function abbreviateProject(name: string, maxLength = 8): string {
  if (name.length <= maxLength) return name;
  return name.slice(0, maxLength - 1) + "…";
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 11) return "Guten Morgen";
  if (hour < 17) return "Hallo";
  return "Guten Abend";
}
