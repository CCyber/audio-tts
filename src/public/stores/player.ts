import { createStore } from "solid-js/store";
import { Recording } from "../lib/api";

export interface PlayerState {
  recording: Recording | null;
  isPlaying: boolean;
  position: number; // seconds
  duration: number; // seconds
  speed: number;
  volume: number;
  ended: boolean;
}

const [playerState, setPlayerState] = createStore<PlayerState>({
  recording: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  speed: 1,
  volume: 1,
  ended: false,
});

export { playerState };

let audio: HTMLAudioElement | null = null;
let rafId: number | null = null;

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("loadedmetadata", () => {
      setPlayerState("duration", audio!.duration);
    });
    audio.addEventListener("ended", () => {
      setPlayerState({ isPlaying: false, ended: true });
      stopRaf();
    });
  }
  return audio;
}

function startRaf(): void {
  const tick = () => {
    if (audio && !audio.paused) setPlayerState("position", audio.currentTime);
    rafId = requestAnimationFrame(tick);
  };
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function stopRaf(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export async function playRecording(recording: Recording): Promise<void> {
  const a = ensureAudio();
  if (playerState.recording?.id !== recording.id) {
    a.src = `/api/recordings/${recording.id}/audio`;
    a.load();
    setPlayerState({ recording, position: 0, ended: false });
  }
  a.playbackRate = playerState.speed;
  a.volume = playerState.volume;
  await a.play();
  setPlayerState("isPlaying", true);
  startRaf();
}

export function togglePlay(): void {
  if (!audio) return;
  if (audio.paused) {
    audio.play();
    setPlayerState("isPlaying", true);
    startRaf();
  } else {
    audio.pause();
    setPlayerState("isPlaying", false);
  }
}

export function seek(seconds: number): void {
  if (!audio) return;
  audio.currentTime = seconds;
  setPlayerState("position", seconds);
}

export function setSpeed(speed: number): void {
  setPlayerState("speed", speed);
  if (audio) audio.playbackRate = speed;
}

export function setVolume(volume: number): void {
  setPlayerState("volume", volume);
  if (audio) audio.volume = volume;
}

export function closePlayer(): void {
  if (audio) {
    audio.pause();
    audio.src = "";
  }
  stopRaf();
  setPlayerState({
    recording: null,
    isPlaying: false,
    position: 0,
    duration: 0,
    ended: false,
  });
}
