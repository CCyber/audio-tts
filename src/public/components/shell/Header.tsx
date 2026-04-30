import { JSX } from "solid-js";
import { IconButton } from "../common/IconButton";
import { openCompose } from "../../stores/ui";

export function Header(props: { title: JSX.Element; left?: JSX.Element; right?: JSX.Element }) {
  return (
    <header class="app-header">
      <div class="app-header-left">{props.left}</div>
      <div class="app-header-title">{props.title}</div>
      <div class="app-header-right">
        {props.right}
        <IconButton icon="compose" label="Neue Aufnahme" onClick={openCompose} class="header-compose" />
      </div>
    </header>
  );
}
