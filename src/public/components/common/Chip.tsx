import { JSX, splitProps } from "solid-js";

interface ChipProps extends JSX.HTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  removable?: boolean;
  onRemove?: () => void;
}

export function Chip(props: ChipProps) {
  const [local, rest] = splitProps(props, ["active", "removable", "onRemove", "class", "children"]);
  return (
    <button class={`chip ${local.active ? "chip-active" : ""} ${local.class ?? ""}`} {...rest}>
      {local.children}
      {local.removable && (
        <span
          class="chip-remove"
          onClick={(e) => { e.stopPropagation(); local.onRemove?.(); }}
        >×</span>
      )}
    </button>
  );
}
