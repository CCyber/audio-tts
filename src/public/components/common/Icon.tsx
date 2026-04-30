import { JSX } from "solid-js";

const PATHS: Record<string, string> = {
  home: "M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2V11z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  library: "M9 5v14l11-7z",
  search: "M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
  compose: "M4 17.5l9.5-9.5L16.5 11 7 20.5H4v-3zM14.5 6.5l3 3 1.5-1.5a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0L14.5 6.5z",
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  skipBack: "M11 6 4 12l7 6V6zm9 0-7 6 7 6V6z",
  skipFwd: "M13 6l7 6-7 6V6zM4 6l7 6-7 6V6z",
  close: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  more: "M5 12a2 2 0 1 1 0-.001M12 12a2 2 0 1 1 0-.001M19 12a2 2 0 1 1 0-.001",
  download: "M12 3v12m0 0l-5-5m5 5l5-5M4 21h16",
};

export function Icon(props: { name: keyof typeof PATHS | string; size?: number; class?: string; style?: JSX.CSSProperties }) {
  const size = () => props.size ?? 24;
  const path = PATHS[props.name] ?? "";
  return (
    <svg width={size()} height={size()} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.class} style={props.style}>
      <path d={path} />
    </svg>
  );
}
