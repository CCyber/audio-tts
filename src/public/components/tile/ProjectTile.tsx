import { Project } from "../../lib/api";
import { projectColor } from "../../lib/projectColor";
import { useNavigate } from "@solidjs/router";
import { IconButton } from "../common/IconButton";

export function ProjectTile(props: { project: Project; size?: number; onMore?: () => void }) {
  const navigate = useNavigate();
  const size = () => props.size ?? 140;
  return (
    <div
      class="proj-tile-wrap"
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <button
        class="proj-tile"
        style={{ width: "100%", height: "100%", background: projectColor({ id: props.project.id, is_system: props.project.is_system, color: props.project.color }) }}
        onClick={() => navigate(`/projects/${props.project.id}`)}
      >
        <div class="proj-tile-name">{props.project.name}</div>
        <div class="proj-tile-count">{props.project.recording_count} Aufnahmen</div>
      </button>
      {props.onMore && (
        <IconButton
          icon="more"
          label="Optionen"
          class="proj-tile-more"
          onClick={(e) => { e.stopPropagation(); props.onMore!(); }}
        />
      )}
    </div>
  );
}
