import { Recording, Project } from "../../lib/api";
import { abbreviateProject, voiceInitial } from "../../lib/format";
import { projectColor } from "../../lib/projectColor";
import { playerState, playRecording } from "../../stores/player";
import { libraryState } from "../../stores/library";
import { NowPlayingIndicator } from "./NowPlayingIndicator";

const VOICE_VAR: Record<string, string> = {
  alloy: "var(--voice-alloy)",
  echo: "var(--voice-echo)",
  fable: "var(--voice-fable)",
  onyx: "var(--voice-onyx)",
  nova: "var(--voice-nova)",
  shimmer: "var(--voice-shimmer)",
};

export function RecordingTile(props: { recording: Recording; size?: number }) {
  const size = () => props.size ?? 140;
  const project = (): Project | undefined =>
    libraryState.projects.find((p) => p.id === props.recording.project_id);
  const isPlaying = () =>
    playerState.recording?.id === props.recording.id && playerState.isPlaying;

  return (
    <button
      class="rec-tile"
      style={{ width: `${size()}px`, height: `${size()}px`, background: VOICE_VAR[props.recording.voice] ?? "var(--voice-alloy)" }}
      onClick={() => playRecording(props.recording)}
      aria-label={`Abspielen: ${props.recording.title}`}
    >
      <div class="rec-tile-letter">
        {isPlaying() ? <NowPlayingIndicator size={28} /> : voiceInitial(props.recording.voice)}
      </div>
      {project() && (
        <div class="rec-tile-badge" style={{ background: projectColor({ id: project()!.id, is_system: project()!.is_system, color: project()!.color }) }}>
          {abbreviateProject(project()!.name)}
        </div>
      )}
    </button>
  );
}
