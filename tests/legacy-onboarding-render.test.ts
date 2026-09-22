import { describe, expect, it } from "vitest";
import {
  LEGACY_EXIT_X,
  LEGACY_HERO_START_X,
  LEGACY_SCENE_FLOOR_Y,
  legacyDetourTrajectory,
  legacyDuckTrajectory,
  legacyGapFallTrajectory,
  legacyJumpTrajectory,
  legacyVisibleDetourPoint,
} from "../src/render/legacyOnboarding";

describe("legacy onboarding physical trajectories", () => {
  it("uses the painted side-path centerline for Moru's feet", () => {
    for (const pathProgress of [0, 0.2, 0.42, 0.65, 1]) {
      const visible = legacyVisibleDetourPoint(pathProgress);
      const hero = legacyDetourTrajectory(0.22 + pathProgress * 0.68);
      expect(hero.x).toBeCloseTo(visible.x, 5);
      expect(hero.y).toBeCloseTo(visible.y, 5);
      expect(hero.scale).toBeCloseTo(visible.scale, 5);
    }
    expect(legacyDetourTrajectory(0).x).toBe(LEGACY_HERO_START_X);
    expect(legacyDetourTrajectory(1).x).toBe(LEGACY_EXIT_X);
    expect(legacyDetourTrajectory(0.5).occludedByWall).toBe(true);
  });

  it("jumps only while crossing the 440-552 floor gap", () => {
    expect(legacyJumpTrajectory(0).y).toBe(LEGACY_SCENE_FLOOR_Y);
    expect(legacyJumpTrajectory(0.27).x).toBe(405);
    expect(legacyJumpTrajectory(0.495).x).toBeCloseTo(496.5, 1);
    expect(legacyJumpTrajectory(0.495).y).toBeLessThan(310);
    expect(legacyJumpTrajectory(0.72).x).toBe(588);
    expect(legacyJumpTrajectory(1).y).toBe(LEGACY_SCENE_FLOOR_Y);
  });

  it("shows a failed walk descending into the gap cushion", () => {
    expect(legacyGapFallTrajectory(0.62).x).toBe(430);
    expect(legacyGapFallTrajectory(1)).toMatchObject({ x: 496, y: 475 });
  });

  it("ducks before the arch and stands after clearing it", () => {
    expect(legacyDuckTrajectory(0.24).pose).toBe("walk");
    expect(legacyDuckTrajectory(0.25).pose).toBe("duck");
    expect(legacyDuckTrajectory(0.82).pose).toBe("duck");
    expect(legacyDuckTrajectory(0.84).pose).toBe("walk");
  });
});
