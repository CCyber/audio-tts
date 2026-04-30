import { Show, createSignal } from "solid-js";
import { playerState, togglePlay, seek, setSpeed } from "../../stores/player";
import { uiState, closeFullScreenPlayer } from "../../stores/ui";
import { libraryState } from "../../stores/library";
import { voiceInitial, formatDuration, formatRelative } from "../../lib/format";
import { IconButton } from "../common/IconButton";
import { Icon } from "../common/Icon";

const VOICE_VAR: Record<string, string> = {
  alloy: "var(--voice-alloy)", echo: "var(--voice-echo)", fable: "var(--voice-fable)",
  onyx: "var(--voice-onyx)", nova: "var(--voice-nova)", shimmer: "var(--voice-shimmer)",
};
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export function FullScreenPlayer() {
  const project = () => libraryState.projects.find((p) => p.id === playerState.recording?.project_id);
  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(playerState.speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
  };

  let trackEl!: HTMLDivElement;
  const onScrub = (e: PointerEvent) => {
    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct * playerState.duration);
  };

  const [dragOffset, setDragOffset] = createSignal(0);
  let startY = 0;
  let dragging = false;
  const onPointerDown = (e: PointerEvent) => { startY = e.clientY; dragging = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onPointerMove = (e: PointerEvent) => { if (!dragging) return; setDragOffset(Math.max(0, e.clientY - startY)); };
  const onPointerUp = () => { if (dragOffset() > 100) closeFullScreenPlayer(); setDragOffset(0); dragging = false; };

  return (
    <Show when={uiState.fullScreenPlayerOpen && playerState.recording}>
      <div
        class="fs-player"
        style={{ transform: `translateY(${dragOffset()}px)`, transition: dragOffset() > 0 ? "none" : "transform 250ms ease-out" }}
      >
        <div
          class="fs-header"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <IconButton icon="chevronDown" label="Schließen" onClick={closeFullScreenPlayer} />
          <span style={{ flex: 1 }} />
          <IconButton icon="more" label="Optionen" />
        </div>

        <div class="fs-art" style={{ background: VOICE_VAR[playerState.recording!.voice] ?? "var(--voice-alloy)" }}>
          <div class="fs-letter">{voiceInitial(playerState.recording!.voice)}</div>
        </div>

        <div class="fs-meta">
          <h1 class="fs-title">{playerState.recording!.title}</h1>
          <div class="caption">
            {project()?.name ?? "Inbox"} · {formatRelative(playerState.recording!.created_at)}
          </div>
        </div>

        <div class="fs-track" ref={trackEl} onClick={onScrub}>
          <div class="fs-track-bg" />
          <div class="fs-track-fill" style={{ width: `${(playerState.position / Math.max(1, playerState.duration)) * 100}%` }} />
        </div>
        <div class="fs-times">
          <span>{formatDuration(playerState.position * 1000)}</span>
          <span>{formatDuration(playerState.duration * 1000)}</span>
        </div>

        <div class="fs-controls">
          <IconButton icon="skipBack" label="Zurück 15s" onClick={() => seek(Math.max(0, playerState.position - 15))} size={32} />
          <button class="fs-play" onClick={togglePlay} aria-label={playerState.isPlaying ? "Pause" : "Play"}>
            <Icon name={playerState.isPlaying ? "pause" : "play"} size={40} />
          </button>
          <IconButton icon="skipFwd" label="Vor 15s" onClick={() => seek(Math.min(playerState.duration, playerState.position + 15))} size={32} />
        </div>

        <div class="fs-bottom">
          <button class="fs-speed" onClick={cycleSpeed}>{playerState.speed}×</button>
          <a class="fs-download" href={`/api/recordings/${playerState.recording!.id}/download`}>
            <Icon name="download" size={20} /> Download
          </a>
        </div>
      </div>
    </Show>
  );
}
