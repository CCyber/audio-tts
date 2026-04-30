export function deriveTitle(text: string, maxLen: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return "Untitled";
  }
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  const window = cleaned.substring(0, maxLen - 1);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? lastSpace : maxLen - 1;
  return cleaned.substring(0, cut) + "…";
}
