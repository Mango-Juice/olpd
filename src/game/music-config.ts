export type MusicWaveform = "sine" | "triangle" | "sawtooth";
export type MusicIntensity = "intro" | "main" | "climax";

export interface MusicNote {
  beat: number;
  duration: number;
  frequency: number;
  gain: number;
  waveform: MusicWaveform;
}

/** A complete, self-contained arrangement of one chapter motif. */
export interface MusicLayer {
  notes: readonly MusicNote[];
}

export interface MusicTrack {
  bpm: number;
  loopBeats: number;
  gain: number;
  /** Main is retained for callers written before the layer contract. */
  notes: readonly MusicNote[];
  layers: Readonly<Record<MusicIntensity, MusicLayer>>;
}

export const MEMORY_DUNGEON_STAGE_ID = "memory-dungeon";
export const RAIN_CORRIDOR_STAGE_ID = "rain-corridor";
export const CLOCKWORK_KITCHEN_STAGE_ID = "clockwork-kitchen";
export const WIND_FORGE_STAGE_ID = "wind-forge";
export const INVERTED_GARDEN_STAGE_ID = "inverted-garden";
export const LANTERN_STOREHOUSE_STAGE_ID = "lantern-storehouse";
export const COUNTERWEIGHT_THEATRE_STAGE_ID = "counterweight-theatre";
export const FOG_SIGNAL_YARD_STAGE_ID = "fog-signal-yard";
export const INNER_BELL_TOWER_STAGE_ID = "inner-bell-tower";
export const RETURNLESS_WARDEN_STAGE_ID = "returnless-warden";

export const MUSIC_STAGE_IDS = [
  MEMORY_DUNGEON_STAGE_ID,
  RAIN_CORRIDOR_STAGE_ID,
  CLOCKWORK_KITCHEN_STAGE_ID,
  WIND_FORGE_STAGE_ID,
  INVERTED_GARDEN_STAGE_ID,
  LANTERN_STOREHOUSE_STAGE_ID,
  COUNTERWEIGHT_THEATRE_STAGE_ID,
  FOG_SIGNAL_YARD_STAGE_ID,
  INNER_BELL_TOWER_STAGE_ID,
  RETURNLESS_WARDEN_STAGE_ID,
] as const;

const n = (
  beat: number,
  duration: number,
  frequency: number,
  gain: number,
  waveform: MusicWaveform = "triangle",
): MusicNote => ({ beat, duration, frequency, gain, waveform });

const combine = (...parts: readonly (readonly MusicNote[])[]) => parts.flat();

function layeredTrack(
  bpm: number,
  gain: number,
  intro: readonly MusicNote[],
  main: readonly MusicNote[],
  climax: readonly MusicNote[],
  loopBeats = 16,
): MusicTrack {
  const mainNotes = combine(intro, main);
  return {
    bpm,
    loopBeats,
    gain,
    notes: mainNotes,
    layers: {
      intro: { notes: intro },
      main: { notes: mainNotes },
      climax: { notes: combine(mainNotes, climax) },
    },
  };
}

// Chapter 1's original main arrangement is deliberately unchanged.
const memoryDungeonMain = [
  n(0, 4.25, 146.83, 0.11, "sine"), n(0, 4.25, 220, 0.075, "sine"),
  n(4, 4.25, 116.54, 0.1, "sine"), n(4, 4.25, 174.61, 0.07, "sine"),
  n(8, 4.25, 174.61, 0.1, "sine"), n(8, 4.25, 261.63, 0.07, "sine"),
  n(12, 4.25, 130.81, 0.1, "sine"), n(12, 4.25, 196, 0.07, "sine"),
  n(1, 0.8, 349.23, 0.055), n(3, 0.65, 440, 0.045),
  n(5.5, 0.8, 349.23, 0.05), n(7, 0.7, 293.66, 0.04),
  n(9, 0.8, 392, 0.05), n(11, 0.7, 349.23, 0.04),
  n(13.5, 0.9, 329.63, 0.05), n(15, 0.7, 293.66, 0.04),
] as const;
const memoryDungeonIntro = memoryDungeonMain.filter((note) => note.beat < 8 && note.frequency >= 293);
const memoryDungeonClimax = [n(14, 1.5, 523.25, 0.032), n(15.25, 0.6, 587.33, 0.027)];
const memoryDungeon: MusicTrack = {
  bpm: 68,
  loopBeats: 16,
  gain: 0.16,
  notes: memoryDungeonMain,
  layers: {
    intro: { notes: memoryDungeonIntro },
    main: { notes: memoryDungeonMain },
    climax: { notes: combine(memoryDungeonMain, memoryDungeonClimax) },
  },
};

// Each chapter shares one motif across layers. These are Web Audio note events,
// not recordings or gameplay signals.
const rainCorridor = layeredTrack(72, 0.13,
  [n(1, .45, 587.33, .034), n(5, .5, 659.25, .032), n(9, .45, 587.33, .03), n(13, .6, 523.25, .03)],
  [n(0, 2.8, 146.83, .055, "sine"), n(4, 2.8, 164.81, .05, "sine"), n(8, 2.8, 196, .05, "sine"), n(12, 2.8, 174.61, .05, "sine"), n(3, .7, 440, .029), n(7, .7, 493.88, .028), n(11, .7, 440, .028)],
  [n(2, 3, 293.66, .032, "sine"), n(6, 3, 329.63, .03, "sine"), n(10, 3, 392, .03, "sine"), n(14, 1.7, 440, .026)]);

const clockworkKitchen = layeredTrack(76, 0.12,
  [n(1, .4, 392, .032), n(3, .35, 493.88, .03), n(9, .4, 440, .032), n(11, .35, 523.25, .03)],
  [n(0, 3.5, 130.81, .052, "sine"), n(4, 3.5, 146.83, .048, "sine"), n(8, 3.5, 164.81, .048, "sine"), n(12, 3.5, 146.83, .048, "sine"), n(5, .65, 329.63, .028), n(7, .5, 392, .027), n(13, .65, 349.23, .028), n(15, .5, 440, .027)],
  [n(2, 1.2, 261.63, .025), n(6, 1.2, 293.66, .025), n(10, 1.2, 329.63, .025), n(14, 1.2, 293.66, .025)]);

const windForge = layeredTrack(64, 0.13,
  [n(1, 1.4, 293.66, .035, "sine"), n(5, 1.2, 329.63, .033, "sine"), n(9, 1.4, 392, .034, "sine"), n(13, 1.3, 349.23, .033, "sine")],
  [n(0, 3.8, 98, .06, "sine"), n(4, 3.8, 110, .055, "sine"), n(8, 3.8, 130.81, .055, "sine"), n(12, 3.8, 110, .055, "sine"), n(2.5, 1.8, 220, .027), n(6.5, 1.8, 246.94, .026), n(10.5, 1.8, 293.66, .026), n(14.5, 1.2, 246.94, .025)],
  [n(3, 1.5, 587.33, .019, "sawtooth"), n(7, 1.5, 659.25, .018, "sawtooth"), n(11, 1.5, 783.99, .018, "sawtooth"), n(15, .8, 659.25, .017, "sawtooth")]);

const invertedGarden = layeredTrack(66, 0.115,
  [n(1, .75, 329.63, .03), n(4, .75, 392, .03), n(9, .75, 440, .03), n(12, .75, 392, .03)],
  [n(0, 3.6, 164.81, .048, "sine"), n(4, 3.6, 196, .045, "sine"), n(8, 3.6, 146.83, .045, "sine"), n(12, 3.6, 174.61, .045, "sine"), n(2.5, .9, 493.88, .022), n(6.5, .9, 440, .022), n(10.5, .9, 523.25, .022), n(14.5, .9, 493.88, .022)],
  [n(3, 2.2, 659.25, .017), n(7, 2.2, 587.33, .017), n(11, 2.2, 698.46, .017), n(15, .8, 659.25, .016)]);

const lanternStorehouse = layeredTrack(60, 0.12,
  [n(1, .9, 440, .028, "sine"), n(5, .9, 493.88, .027, "sine"), n(9, .9, 523.25, .028, "sine"), n(13, .9, 493.88, .027, "sine")],
  [n(0, 3.7, 110, .055, "sine"), n(4, 3.7, 130.81, .05, "sine"), n(8, 3.7, 146.83, .05, "sine"), n(12, 3.7, 130.81, .05, "sine"), n(3, 1.1, 329.63, .023, "sine"), n(7, 1.1, 349.23, .023, "sine"), n(11, 1.1, 392, .023, "sine"), n(15, .7, 349.23, .022, "sine")],
  [n(2, 2.5, 220, .025), n(6, 2.5, 261.63, .024), n(10, 2.5, 293.66, .024), n(14, 1.5, 261.63, .023)]);

const counterweightTheatre = layeredTrack(74, 0.125,
  [n(1, .65, 349.23, .032), n(5, .65, 392, .031), n(9, .65, 440, .032), n(13, .65, 392, .031)],
  [n(0, 3.4, 98, .054, "sine"), n(4, 3.4, 130.81, .05, "sine"), n(8, 3.4, 146.83, .05, "sine"), n(12, 3.4, 130.81, .05, "sine"), n(3, .65, 293.66, .028), n(7, .65, 329.63, .028), n(11, .65, 349.23, .028), n(15, .5, 329.63, .027)],
  [n(1.8, .65, 523.25, .021), n(5.8, .65, 587.33, .021), n(9.8, .65, 659.25, .021), n(13.8, .65, 587.33, .021)]);

const fogSignalYard = layeredTrack(58, 0.105,
  [n(2, 1.3, 293.66, .025, "sine"), n(6, 1.2, 329.63, .024, "sine"), n(10, 1.3, 349.23, .025, "sine"), n(14, 1.2, 329.63, .024, "sine")],
  [n(0, 4.2, 73.42, .048, "sine"), n(4, 4.2, 87.31, .044, "sine"), n(8, 4.2, 98, .044, "sine"), n(12, 4.2, 87.31, .044, "sine"), n(3.5, 1.8, 220, .019), n(7.5, 1.8, 246.94, .019), n(11.5, 1.8, 261.63, .019)],
  [n(1, 3.1, 146.83, .019), n(5, 3.1, 164.81, .019), n(9, 3.1, 174.61, .019), n(13, 2.4, 164.81, .018)]);

const innerBellTower = layeredTrack(62, 0.125,
  [n(1, 1, 261.63, .029, "sine"), n(5, 1, 293.66, .028, "sine"), n(9, 1, 329.63, .029, "sine"), n(13, 1, 293.66, .028, "sine")],
  [n(0, 3.9, 87.31, .056, "sine"), n(4, 3.9, 98, .052, "sine"), n(8, 3.9, 116.54, .052, "sine"), n(12, 3.9, 98, .052, "sine"), n(3, 1.2, 392, .022), n(7, 1.2, 440, .022), n(11, 1.2, 493.88, .022), n(15, .8, 440, .021)],
  [n(2, 3.2, 196, .023), n(6, 3.2, 220, .023), n(10, 3.2, 246.94, .023), n(14, 1.8, 220, .022)]);

const returnlessWarden = layeredTrack(64, 0.13,
  [n(1, 1.3, 293.66, .027), n(5, 1.3, 329.63, .027), n(9, 1.3, 349.23, .027), n(13, 1.3, 392, .027)],
  [n(0, 3.8, 65.41, .06, "sine"), n(4, 3.8, 73.42, .056, "sine"), n(8, 3.8, 87.31, .056, "sine"), n(12, 3.8, 98, .056, "sine"), n(3, 1.8, 196, .025, "sawtooth"), n(7, 1.8, 220, .024, "sawtooth"), n(11, 1.8, 246.94, .024, "sawtooth"), n(15, .8, 293.66, .022, "sawtooth")],
  [n(2, 2.6, 523.25, .019), n(6, 2.6, 587.33, .019), n(10, 2.6, 659.25, .019), n(14, 1.5, 783.99, .018)]);

/** Complete campaign registry; stage progress does not affect this music data. */
export const MUSIC_TRACKS: Readonly<Record<string, MusicTrack>> = {
  [MEMORY_DUNGEON_STAGE_ID]: memoryDungeon,
  [RAIN_CORRIDOR_STAGE_ID]: rainCorridor,
  [CLOCKWORK_KITCHEN_STAGE_ID]: clockworkKitchen,
  [WIND_FORGE_STAGE_ID]: windForge,
  [INVERTED_GARDEN_STAGE_ID]: invertedGarden,
  [LANTERN_STOREHOUSE_STAGE_ID]: lanternStorehouse,
  [COUNTERWEIGHT_THEATRE_STAGE_ID]: counterweightTheatre,
  [FOG_SIGNAL_YARD_STAGE_ID]: fogSignalYard,
  [INNER_BELL_TOWER_STAGE_ID]: innerBellTower,
  [RETURNLESS_WARDEN_STAGE_ID]: returnlessWarden,
};

export function getMusicTrack(stageId: string): MusicTrack | undefined {
  return MUSIC_TRACKS[stageId];
}

export function musicNotes(track: MusicTrack, intensity: MusicIntensity = "main") {
  return track.layers[intensity].notes;
}

export function secondsPerBeat(track: MusicTrack) {
  return 60 / track.bpm;
}

export function loopDurationSeconds(track: MusicTrack) {
  return track.loopBeats * secondsPerBeat(track);
}

export function noteTiming(track: MusicTrack, note: MusicNote, loopStart: number) {
  const beatSeconds = secondsPerBeat(track);
  return {
    start: loopStart + note.beat * beatSeconds,
    end: loopStart + (note.beat + note.duration) * beatSeconds,
  };
}
