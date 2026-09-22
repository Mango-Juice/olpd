/** Original synthesized foley. No media downloads, background autoplay, or sampled third-party assets. */
export type SoundKind =
  | "write"
  | "death"
  | "safe"
  | "erase"
  | "win"
  | "step"
  | "jump"
  | "land"
  | "revive";
let audio: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
const MASTER_GAIN = 0.45;

export type AudioReadyListener = (
  context: AudioContext,
  destination: AudioNode,
) => void;

const readyListeners = new Set<AudioReadyListener>();

/**
 * Shares the gesture-unlocked audio graph with synthesized subsystems such as
 * music. Consumers should still check `context.state` before scheduling.
 */
export function onAudioReady(listener: AudioReadyListener) {
  readyListeners.add(listener);
  if (audio && master && audio.state === "running") listener(audio, master);
  return () => {
    readyListeners.delete(listener);
  };
}

function notifyAudioReady() {
  if (!audio || !master || audio.state !== "running") return;
  readyListeners.forEach((listener) => listener(audio!, master!));
}

export function setAudioMuted(value: boolean) {
  muted = value;
  if (audio && master)
    master.gain.setTargetAtTime(value ? 0 : MASTER_GAIN, audio.currentTime, 0.015);
}
export function unlockAudio() {
  try {
    if (!audio) {
      audio = new AudioContext();
      master = audio.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(audio.destination);
      noise = audio.createBuffer(
        1,
        Math.ceil(audio.sampleRate * 0.35),
        audio.sampleRate,
      );
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * 0.5;
    }
    if (audio.state !== "running") {
      void audio.resume().then(notifyAudioReady).catch(() => undefined);
    } else {
      notifyAudioReady();
    }
  } catch {
    /* Silent play remains fully functional if Web Audio is unavailable. */
  }
}
function tone(
  from: number,
  to: number,
  duration: number,
  delay = 0,
  volume = 0.08,
  type: OscillatorType = "sine",
) {
  if (!audio || !master) return;
  const at = audio.currentTime + delay;
  const oscillator = audio.createOscillator(),
    envelope = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, at);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(1, to),
    at + duration,
  );
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(envelope);
  envelope.connect(master);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.01);
}
function rustle(frequency: number, duration: number, volume: number) {
  if (!audio || !master || !noise) return;
  const source = audio.createBufferSource(),
    filter = audio.createBiquadFilter(),
    envelope = audio.createGain();
  source.buffer = noise;
  filter.type = "lowpass";
  filter.frequency.value = frequency;
  envelope.gain.setValueAtTime(volume, audio.currentTime);
  envelope.gain.exponentialRampToValueAtTime(
    0.0001,
    audio.currentTime + duration,
  );
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.start();
  source.stop(audio.currentTime + duration);
}
export function playSound(kind: SoundKind, isMuted: boolean) {
  if (
    isMuted ||
    muted ||
    !audio ||
    audio.state !== "running" ||
    (typeof document !== "undefined" && document.hidden)
  )
    return;
  switch (kind) {
    case "step":
      rustle(520, 0.065, 0.1);
      tone(100, 65, 0.065, 0, 0.035);
      break;
    case "jump":
      tone(220, 620, 0.16, 0, 0.075, "triangle");
      break;
    case "land":
      rustle(850, 0.1, 0.16);
      tone(120, 55, 0.1, 0, 0.07);
      break;
    case "write":
      rustle(2600, 0.055, 0.11);
      tone(880, 1100, 0.13, 0.015, 0.055);
      break;
    case "erase":
      rustle(1800, 0.22, 0.17);
      break;
    case "death":
      tone(310, 75, 0.32, 0, 0.12, "triangle");
      tone(160, 60, 0.22, 0.08, 0.035);
      break;
    case "revive":
      [392, 523, 784].forEach((hz, i) =>
        tone(hz, hz * 1.02, 0.22, i * 0.075, 0.065),
      );
      break;
    case "win":
      [523, 659, 784, 1046].forEach((hz, i) =>
        tone(hz, hz, 0.35, i * 0.12, 0.09, "triangle"),
      );
      break;
    case "safe":
      tone(660, 880, 0.09, 0, 0.025);
      break;
  }
}
