import { describe, expect, it } from "vitest";
import {
  MUSIC_STAGE_IDS,
  getMusicTrack,
  loopDurationSeconds,
  musicNotes,
  type MusicIntensity,
} from "../src/game/music-config";

const intensities: readonly MusicIntensity[] = ["intro", "main", "climax"];

describe("campaign chapter music", () => {
  it("registers one bounded synthesized theme for every documented chapter", () => {
    expect(MUSIC_STAGE_IDS).toHaveLength(10);
    expect(new Set(MUSIC_STAGE_IDS).size).toBe(10);

    for (const stageId of MUSIC_STAGE_IDS) {
      const track = getMusicTrack(stageId);
      expect(track).toBeDefined();
      expect(track!.gain).toBeGreaterThan(0);
      expect(track!.gain).toBeLessThanOrEqual(0.2);
      expect(track!.bpm).toBeGreaterThanOrEqual(50);
      expect(track!.bpm).toBeLessThanOrEqual(80);
      expect(track!.loopBeats).toBe(16);
      expect(loopDurationSeconds(track!)).toBeGreaterThan(10);

      for (const intensity of intensities) {
        const notes = musicNotes(track!, intensity);
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.length).toBeLessThanOrEqual(32);
        for (const note of notes) {
          expect(Number.isFinite(note.beat)).toBe(true);
          expect(Number.isFinite(note.duration)).toBe(true);
          expect(Number.isFinite(note.frequency)).toBe(true);
          expect(Number.isFinite(note.gain)).toBe(true);
          expect(note.beat).toBeGreaterThanOrEqual(0);
          expect(note.beat).toBeLessThan(track!.loopBeats);
          expect(note.duration).toBeGreaterThan(0);
          expect(note.beat + note.duration).toBeLessThanOrEqual(track!.loopBeats + 0.5);
          expect(note.frequency).toBeGreaterThan(30);
          expect(note.frequency).toBeLessThan(2_000);
          expect(note.gain).toBeGreaterThan(0);
          expect(note.gain).toBeLessThanOrEqual(0.12);
        }
      }
    }
  });

  it("keeps one motif while adding density from intro through climax", () => {
    for (const stageId of MUSIC_STAGE_IDS) {
      const track = getMusicTrack(stageId)!;
      const intro = musicNotes(track, "intro");
      const main = musicNotes(track, "main");
      const climax = musicNotes(track, "climax");
      expect(main.length).toBeGreaterThanOrEqual(intro.length);
      expect(climax.length).toBeGreaterThan(main.length);
      expect(track.notes).toBe(main);
      for (const note of intro) expect(main).toContain(note);
      for (const note of main) expect(climax).toContain(note);
    }
  });

  it("does not collapse the campaign into one transposed arrangement", () => {
    const signatures = MUSIC_STAGE_IDS.map((stageId) => {
      const track = getMusicTrack(stageId)!;
      return `${track.bpm}:${musicNotes(track, "main").map((note) => note.waveform).join("")}:${musicNotes(track, "main").map((note) => note.beat).join(",")}`;
    });
    expect(new Set(signatures).size).toBe(MUSIC_STAGE_IDS.length);
  });
});
