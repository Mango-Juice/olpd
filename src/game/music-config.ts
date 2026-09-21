export type MusicWaveform = "sine" | "triangle";

export interface MusicNote {
  beat: number;
  duration: number;
  frequency: number;
  gain: number;
  waveform: MusicWaveform;
}

export interface MusicTrack {
  bpm: number;
  loopBeats: number;
  gain: number;
  notes: readonly MusicNote[];
}

export const MEMORY_DUNGEON_STAGE_ID = "memory-dungeon";

const memoryDungeon: MusicTrack = {
  bpm: 68,
  loopBeats: 16,
  gain: 0.16,
  notes: [
    // Warm, overlapping fifths keep the harmony calm beneath the foley.
    {
      beat: 0,
      duration: 4.25,
      frequency: 146.83,
      gain: 0.11,
      waveform: "sine",
    },
    { beat: 0, duration: 4.25, frequency: 220, gain: 0.075, waveform: "sine" },
    {
      beat: 4,
      duration: 4.25,
      frequency: 116.54,
      gain: 0.1,
      waveform: "sine",
    },
    {
      beat: 4,
      duration: 4.25,
      frequency: 174.61,
      gain: 0.07,
      waveform: "sine",
    },
    {
      beat: 8,
      duration: 4.25,
      frequency: 174.61,
      gain: 0.1,
      waveform: "sine",
    },
    {
      beat: 8,
      duration: 4.25,
      frequency: 261.63,
      gain: 0.07,
      waveform: "sine",
    },
    {
      beat: 12,
      duration: 4.25,
      frequency: 130.81,
      gain: 0.1,
      waveform: "sine",
    },
    { beat: 12, duration: 4.25, frequency: 196, gain: 0.07, waveform: "sine" },

    // A sparse original motif gives the loop a gentle sense of movement.
    {
      beat: 1,
      duration: 0.8,
      frequency: 349.23,
      gain: 0.055,
      waveform: "triangle",
    },
    { beat: 3, duration: 0.65, frequency: 440, gain: 0.045, waveform: "triangle" },
    {
      beat: 5.5,
      duration: 0.8,
      frequency: 349.23,
      gain: 0.05,
      waveform: "triangle",
    },
    { beat: 7, duration: 0.7, frequency: 293.66, gain: 0.04, waveform: "triangle" },
    {
      beat: 9,
      duration: 0.8,
      frequency: 392,
      gain: 0.05,
      waveform: "triangle",
    },
    { beat: 11, duration: 0.7, frequency: 349.23, gain: 0.04, waveform: "triangle" },
    {
      beat: 13.5,
      duration: 0.9,
      frequency: 329.63,
      gain: 0.05,
      waveform: "triangle",
    },
    { beat: 15, duration: 0.7, frequency: 293.66, gain: 0.04, waveform: "triangle" },
  ],
};

/** Stage-to-track registry. Add later chapters or a boss theme here. */
export const MUSIC_TRACKS: Readonly<Record<string, MusicTrack>> = {
  [MEMORY_DUNGEON_STAGE_ID]: memoryDungeon,
};

export function getMusicTrack(stageId: string): MusicTrack | undefined {
  return MUSIC_TRACKS[stageId];
}

export function secondsPerBeat(track: MusicTrack) {
  return 60 / track.bpm;
}

export function loopDurationSeconds(track: MusicTrack) {
  return track.loopBeats * secondsPerBeat(track);
}

export function noteTiming(
  track: MusicTrack,
  note: MusicNote,
  loopStart: number,
) {
  const beatSeconds = secondsPerBeat(track);
  return {
    start: loopStart + note.beat * beatSeconds,
    end: loopStart + (note.beat + note.duration) * beatSeconds,
  };
}
