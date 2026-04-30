import { Show } from "solid-js";
import { Recording, api } from "../../lib/api";
import { formatDuration, formatRelative, voiceInitial } from "../../lib/format";
import { libraryState, upsertRecording, removeRecording } from "../../stores/library";
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
    if (props.recording.status === "generating") {
      const total = props.recording.progress_total || 1;
      return `Vertonung läuft… Abschnitt ${props.recording.progress_done} von ${total}`;
    }
    if (props.recording.status === "failed") {
      return props.recording.error ?? "Fehlgeschlagen";
    }
    const parts: string[] = [formatDuration(props.recording.duration_ms)];
    if (props.showProject && project()) parts.push(project()!.name);
    parts.push(formatRelative(props.recording.created_at));
    return parts.join(" · ");
  };

  const onCancel = () => api.cancelRecording(props.recording.id);
  const onRetry = async () => {
    const fresh = await api.retryRecording(props.recording.id);
    upsertRecording(fresh);
  };

  const isReady = () => props.recording.status === "done";

  return (
    <div class={`rec-row rec-row-${props.recording.status}`}>
      <button
        class="rec-row-tile"
        style={{ background: VOICE_VAR[props.recording.voice] ?? "var(--voice-alloy)", opacity: isReady() ? 1 : 0.5 }}
        onClick={() => isReady() && playRecording(props.recording)}
        disabled={!isReady()}
      >
        {isPlaying() ? <NowPlayingIndicator size={20} /> : voiceInitial(props.recording.voice)}
      </button>
      <div class="rec-row-info">
        <div class="rec-row-title">{props.recording.title}</div>
        <div class={`rec-row-meta ${props.recording.status === "failed" ? "rec-row-meta-error" : ""}`}>{meta()}</div>
        <Show when={props.recording.status === "generating"}>
          <div class="rec-row-progress">
            <div class="rec-row-progress-fill" style={{ width: `${(props.recording.progress_done / Math.max(1, props.recording.progress_total)) * 100}%` }} />
          </div>
        </Show>
      </div>
      <Show when={props.recording.status === "generating"}>
        <IconButton icon="close" label="Abbrechen" onClick={onCancel} />
      </Show>
      <Show when={props.recording.status === "failed"}>
        <button class="btn btn-ghost" style={{ "min-height": "auto", padding: "var(--space-1) var(--space-2)" }} onClick={onRetry}>Erneut</button>
      </Show>
      <Show when={isReady() && props.onMore}>
        <IconButton icon="more" label="Optionen" onClick={props.onMore} />
      </Show>
    </div>
  );
}
