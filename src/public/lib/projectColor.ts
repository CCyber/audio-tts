export const PROJECT_PALETTE = [
  "#ff9500", // orange
  "#ff2d55", // pink
  "#af52de", // purple
  "#5e5ce6", // indigo
  "#007aff", // blue
  "#34c759", // green
  "#30b0c7", // teal
  "#ff6482", // rose
];

export function projectColor(input: { id: number; is_system: number | boolean; color: string | null | undefined }): string {
  if (input.is_system) return "var(--text-muted)";
  if (input.color) return input.color;
  return PROJECT_PALETTE[input.id % PROJECT_PALETTE.length];
}
