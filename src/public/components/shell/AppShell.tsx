import { JSX, onMount } from "solid-js";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { MiniPlayer } from "../player/MiniPlayer";
import { FullScreenPlayer } from "../player/FullScreenPlayer";
import { ComposeSheet } from "../compose/ComposeSheet";
import { loadAll } from "../../stores/library";

export function AppShell(props: { children: JSX.Element }) {
  onMount(() => { loadAll(); });
  return (
    <div class="app-shell">
      <Sidebar />
      <div class="app-main">
        {props.children}
        <MiniPlayer />
      </div>
      <TabBar />
      <FullScreenPlayer />
      <ComposeSheet />
    </div>
  );
}
