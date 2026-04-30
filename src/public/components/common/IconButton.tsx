import { JSX, splitProps } from "solid-js";
import { Icon } from "./Icon";

interface IconButtonProps extends JSX.HTMLAttributes<HTMLButtonElement> {
  icon: string;
  size?: number;
  label: string;
}

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["icon", "size", "label", "class"]);
  return (
    <button aria-label={local.label} class={`icon-btn ${local.class ?? ""}`} {...rest}>
      <Icon name={local.icon} size={local.size ?? 24} />
    </button>
  );
}
