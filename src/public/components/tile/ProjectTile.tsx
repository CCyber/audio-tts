import { Project } from "../../lib/api";
import { projectColor } from "../../lib/projectColor";
import { useNavigate } from "@solidjs/router";

export function ProjectTile(props: { project: Project; size?: number }) {
  const navigate = useNavigate();
  const size = () => props.size ?? 140;
  return (
    <button
      class="proj-tile"
      style={{ width: `${size()}px`, height: `${size()}px`, background: projectColor({ id: props.project.id, is_system: props.project.is_system, color: props.project.color }) }}
      onClick={() => navigate(`/projects/${props.project.id}`)}
    >
      <div class="proj-tile-name">{props.project.name}</div>
      <div class="proj-tile-count">{props.project.recording_count} Aufnahmen</div>
    </button>
  );
}
