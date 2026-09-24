import { onAudioReady } from "./audio";
import {
  getMusicTrack,
  loopDurationSeconds,
  MEMORY_DUNGEON_STAGE_ID,
  musicNotes,
  noteTiming,
  type MusicIntensity,
  type MusicTrack,
} from "./music-config";

export { MEMORY_DUNGEON_STAGE_ID } from "./music-config";

export interface MusicPlaybackState {
  stageId: string;
  playing: boolean;
  /** Presentation-only arrangement. It never controls simulation timing. */
  intensity?: MusicIntensity;
}

interface MusicRuntime {
  context: AudioContext;
  gain: GainNode;
  sources: Set<OscillatorNode>;
  stageId: string;
  intensity: MusicIntensity;
  nextLoopStart: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const SCHEDULE_AHEAD_SECONDS = 1.25;
const MUSIC_GAIN_MULTIPLIER = 1.5;
const desired: MusicPlaybackState = {
  stageId: MEMORY_DUNGEON_STAGE_ID,
  playing: false,
  intensity: "main",
};
let audioGraph: { context: AudioContext; destination: AudioNode } | null = null;
let runtime: MusicRuntime | null = null;
let listening = false;

function scheduleNote(
  current: MusicRuntime,
  track: MusicTrack,
  note: MusicTrack["notes"][number],
  loopStart: number,
) {
  const { context, gain, sources } = current;
  const { start, end } = noteTiming(track, note, loopStart);
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const filter = context.createBiquadFilter();

  oscillator.type = note.waveform;
  oscillator.frequency.setValueAtTime(note.frequency, start);
  filter.type = "lowpass";
  filter.frequency.value = note.waveform === "sawtooth" ? 700 : note.waveform === "sine" ? 900 : 1800;
  const attackEnd = start + Math.min(0.45, (end - start) * 0.35);
  const releaseStart = Math.max(attackEnd, end - 0.45);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(note.gain, attackEnd);
  envelope.gain.setValueAtTime(note.gain, releaseStart);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(filter);
  filter.connect(envelope);
  envelope.connect(gain);
  oscillator.onended = () => {
    sources.delete(oscillator);
    oscillator.disconnect();
    filter.disconnect();
    envelope.disconnect();
    if (runtime !== current && sources.size === 0) gain.disconnect();
  };
  sources.add(oscillator);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function scheduleLoop(current: MusicRuntime, track: MusicTrack) {
  musicNotes(track, current.intensity).forEach((note) =>
    scheduleNote(current, track, note, current.nextLoopStart),
  );
  current.nextLoopStart += loopDurationSeconds(track);
}

function queueNextLoop(current: MusicRuntime, track: MusicTrack) {
  if (runtime !== current) return;
  const waitSeconds = Math.max(
    0.05,
    current.nextLoopStart -
      current.context.currentTime -
      SCHEDULE_AHEAD_SECONDS,
  );
  current.timer = setTimeout(() => {
    if (runtime !== current) return;
    scheduleLoop(current, track);
    queueNextLoop(current, track);
  }, waitSeconds * 1000);
}

function stopMusic() {
  const current = runtime;
  runtime = null;
  if (!current) return;
  if (current.timer) clearTimeout(current.timer);

  if (current.sources.size === 0) {
    current.gain.disconnect();
    return;
  }

  const now = current.context.currentTime;
  current.gain.gain.cancelScheduledValues(now);
  current.gain.gain.setTargetAtTime(0.0001, now, 0.025);
  current.sources.forEach((source) => {
    try {
      source.stop(now + 0.12);
    } catch {
      // A source that ended between iteration and stop needs no cleanup.
    }
  });
}

function syncMusic() {
  const graph = audioGraph;
  const hidden = typeof document !== "undefined" && document.hidden;
  const track = getMusicTrack(desired.stageId);
  if (
    !desired.playing ||
    hidden ||
    !graph ||
    graph.context.state !== "running" ||
    !track
  ) {
    stopMusic();
    return;
  }
  if (
    runtime &&
    runtime.stageId === desired.stageId &&
    runtime.context === graph.context
  ) {
    // Keep the current phrase alive; the selected layer takes effect at its
    // next loop boundary, so changing presentation never cues a restart.
    runtime.intensity = desired.intensity ?? "main";
    return;
  }

  stopMusic();
  const gain = graph.context.createGain();
  const start = graph.context.currentTime + 0.04;
  gain.gain.setValueAtTime(0.0001, graph.context.currentTime);
  gain.gain.exponentialRampToValueAtTime(track.gain * MUSIC_GAIN_MULTIPLIER, start + 0.5);
  gain.connect(graph.destination);
  const current: MusicRuntime = {
    context: graph.context,
    gain,
    sources: new Set(),
    stageId: desired.stageId,
    intensity: desired.intensity ?? "main",
    nextLoopStart: start,
    timer: null,
  };
  runtime = current;
  scheduleLoop(current, track);
  queueNextLoop(current, track);
}

function ensureListeners() {
  if (listening) return;
  listening = true;
  onAudioReady((context, destination) => {
    audioGraph = { context, destination };
    syncMusic();
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", syncMusic);
  }
}

/**
 * Keeps one stage theme in sync with game presentation state. A `playing: true`
 * request made before the first user gesture is retained until `unlockAudio()`
 * successfully resumes Web Audio.
 */
export function setMusicPlayback(next: MusicPlaybackState) {
  desired.stageId = next.stageId;
  desired.playing = next.playing;
  desired.intensity = next.intensity ?? "main";
  ensureListeners();
  syncMusic();
}
