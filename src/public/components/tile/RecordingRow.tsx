import { Recording } from "../../lib/api";
import { formatDuration, formatRelative, voiceInitial } from "../../lib/format";
import { libraryState } from "../../stores/library";
import { playerState, playRecording } from "../../stores/player";
import { NowPlayingIndicator } from "./NowPlayingIndicator";
import { IconButton } from "../common/IconButton";

const VOICE_VAR: Record<string, string> = {
  alloy: "var(--voice-alloy)", echo: "var(--voice-echo)", fable: "var(--voice-fable)",
  onyx: "var(--voice-onyx)", nova: "var(--voice-nova)", shimmer: "var(--voice-shimmer)",
};

export function RecordingRow(props: { recording: Recording; onMore?: () => void; showProject?: boolean }) {
  const project = () => libraryState.projects.find((p) => p.id === props.recording.project_id);
  const isPlaying = () => playerState.recording?.id === props.recording.id && playerState.isPlaying;
  const meta = () => {
    const parts: string[] = [];
    parts.push(formatDuration(props.recording.duration_ms));
    if (props.showProject && project()) parts.push(project()!.name);
    parts.push(formatRelative(props.recording.created_at));
    return parts.join(" · ");
  };

  return (
    <div class="rec-row">
      <button class="rec-row-tile" style={{ background: VOICE_VAR[props.recording.voice] ?? "var(--voice-alloy)" }} onClick={() => playRecording(props.recording)}>
        {isPlaying() ? <NowPlayingIndicator size={20} /> : voiceInitial(props.recording.voice)}
      </button>
      <div class="rec-row-info">
        <div class="rec-row-title">{props.recording.title}</div>
        <div class="rec-row-meta">{meta()}</div>
      </div>
      {props.onMore && <IconButton icon="more" label="Optionen" onClick={props.onMore} />}
    </div>
  );
}
