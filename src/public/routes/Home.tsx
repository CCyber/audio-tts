import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Header } from "../components/shell/Header";
import { RecordingTile } from "../components/tile/RecordingTile";
import { ProjectTile } from "../components/tile/ProjectTile";
import { Chip } from "../components/common/Chip";
import { libraryState } from "../stores/library";
import { greeting } from "../lib/format";

export function Home() {
  const navigate = useNavigate();
  const recent = () => [...libraryState.recordings].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12);

  return (
    <>
      <Header title={<span class="accent-text">Aria</span>} />
      <div class="home-content">
        <h1 class="home-greeting">
          {greeting()},<br />was möchtest du heute hören?
        </h1>

        <SectionHeader title="Zuletzt erstellt" onSeeAll={() => navigate("/library")} />
        <div class="scroll-snap-x">
          <For each={recent()}>{(r) => <RecordingTile recording={r} />}</For>
        </div>

        <SectionHeader title="Projekte" onSeeAll={() => navigate("/projects")} />
        <div class="scroll-snap-x">
          <For each={libraryState.projects}>{(p) => <ProjectTile project={p} />}</For>
        </div>

        <Show when={libraryState.tags.length > 0}>
          <SectionHeader title="Browse by Tag" />
          <div class="scroll-snap-x">
            <For each={libraryState.tags}>{(t) => (
              <Chip onClick={() => navigate(`/library?tag=${encodeURIComponent(t.name)}`)}>#{t.name}</Chip>
            )}</For>
          </div>
        </Show>
      </div>
    </>
  );
}

function SectionHeader(props: { title: string; onSeeAll?: () => void }) {
  return (
    <div class="section-header">
      <h2 class="section-title">{props.title}</h2>
      <Show when={props.onSeeAll}>
        <button class="see-all" onClick={props.onSeeAll}>Alle anzeigen ▸</button>
      </Show>
    </div>
  );
}
