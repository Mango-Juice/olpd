import { describe, expect, it } from "vitest";
import {
  getMusicTrack,
  loopDurationSeconds,
  MEMORY_DUNGEON_STAGE_ID,
  noteTiming,
} from "../src/game/music-config";

describe("stage music configuration", () => {
  it("maps the complete eight-door chapter to one quiet looping track", () => {
    const track = getMusicTrack(MEMORY_DUNGEON_STAGE_ID);
    expect(track).toBeDefined();
    expect(track?.bpm).toBe(68);
    expect(track?.loopBeats).toBe(16);
    expect(track?.gain).toBeLessThan(0.2);
    expect(track?.notes.length).toBeGreaterThan(8);
    expect(getMusicTrack("future-boss")).toBeUndefined();
  });

  it("projects every configured note inside its loop", () => {
    const track = getMusicTrack(MEMORY_DUNGEON_STAGE_ID)!;
    const loopStart = 12.5;
    const loopEnd = loopStart + loopDurationSeconds(track);

    for (const note of track.notes) {
      const timing = noteTiming(track, note, loopStart);
      expect(timing.start).toBeGreaterThanOrEqual(loopStart);
      expect(timing.start).toBeLessThan(loopEnd);
      expect(timing.end).toBeGreaterThan(timing.start);
      // Pads may overlap the seam for a smooth transition, but only briefly.
      expect(timing.end).toBeLessThanOrEqual(loopEnd + 0.25);
    }
  });

  it("derives timing from tempo without accumulating loop drift", () => {
    const track = getMusicTrack(MEMORY_DUNGEON_STAGE_ID)!;
    expect(loopDurationSeconds(track)).toBeCloseTo((16 * 60) / 68, 10);
    const first = noteTiming(track, track.notes[0], 100);
    expect(first.start).toBe(100);
    expect(first.end - first.start).toBeCloseTo((4.25 * 60) / 68, 10);
  });
});
