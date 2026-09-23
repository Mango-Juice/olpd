import { describe, expect, it, vi } from "vitest";
import {
  advancePlaybackTimeline,
  type PlaybackTimeline,
} from "../src/hooks/useCanvasPlayback";

describe("shared canvas playback timeline", () => {
  it("crosses cues in order and completes exactly once", async () => {
    const timeline: PlaybackTimeline = {
      elapsed: 0,
      duration: 1000,
      cueProgress: 0,
      ended: false,
    };
    const cues: string[] = [];
    const complete = vi.fn();
    const between = (from: number, to: number) =>
      [0.25, 0.75]
        .filter((threshold) => from < threshold && to >= threshold)
        .map((threshold) => String(threshold));

    expect(advancePlaybackTimeline(timeline, {
      deltaMs: 300,
      cuesBetween: between,
      onCue: (cue) => cues.push(cue),
      onEnd: complete,
    })).toBe(0.3);
    expect(advancePlaybackTimeline(timeline, {
      deltaMs: 700,
      cuesBetween: between,
      onCue: (cue) => cues.push(cue),
      onEnd: complete,
    })).toBe(1);
    await Promise.resolve();
    expect(cues).toEqual(["0.25", "0.75"]);
    expect(complete).toHaveBeenCalledTimes(1);

    advancePlaybackTimeline(timeline, { deltaMs: 500, onEnd: complete });
    await Promise.resolve();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not move when the shared clock supplies a paused delta", () => {
    const timeline: PlaybackTimeline = {
      elapsed: 420,
      duration: 1000,
      cueProgress: 0.42,
      ended: false,
    };
    expect(advancePlaybackTimeline(timeline, { deltaMs: 0 })).toBe(0.42);
    expect(timeline).toMatchObject({ elapsed: 420, cueProgress: 0.42, ended: false });
  });
});
