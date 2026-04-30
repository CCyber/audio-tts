import { Show } from "solid-js";
import { playerState, togglePlay, closePlayer } from "../../stores/player";
import { openFullScreenPlayer } from "../../stores/ui";
import { voiceInitial } from "../../lib/format";
import { IconButton } from "../common/IconButton";

const VOICE_VAR: Record<string, string> = {
  alloy: "var(--voice-alloy)", echo: "var(--voice-echo)", fable: "var(--voice-fable)",
  onyx: "var(--voice-onyx)", nova: "var(--voice-nova)", shimmer: "var(--voice-shimmer)",
};

export function MiniPlayer() {
  const progressPct = () =>
    playerState.duration > 0 ? (playerState.position / playerState.duration) * 100 : 0;

  return (
    <Show when={playerState.recording}>
      <div class="mini-player" onClick={openFullScreenPlayer}>
        <div class="mini-tile" style={{ background: VOICE_VAR[playerState.recording!.voice] ?? "var(--voice-alloy)" }}>
          {voiceInitial(playerState.recording!.voice)}
        </div>
        <div class="mini-info">
          <div class="mini-title">{playerState.recording!.title}</div>
        </div>
        <IconButton
          icon={playerState.isPlaying ? "pause" : "play"}
          label={playerState.isPlaying ? "Pause" : "Play"}
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        />
        <IconButton
          icon="close"
          label="Schließen"
          onClick={(e) => { e.stopPropagation(); closePlayer(); }}
          class="mini-close"
        />
        <div class="mini-progress" style={{ width: `${progressPct()}%` }} />
      </div>
    </Show>
  );
}
