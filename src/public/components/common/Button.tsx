import { JSX, splitProps } from "solid-js";

interface ButtonProps extends JSX.HTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "destructive";
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "class", "children"]);
  return (
    <button class={`btn btn-${local.variant ?? "primary"} ${local.class ?? ""}`} {...rest}>
      {local.children}
    </button>
  );
}
