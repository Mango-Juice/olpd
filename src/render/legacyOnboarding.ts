import type { HeroPose } from "./animation";

export const LEGACY_SCENE_FLOOR_Y = 402;
export const LEGACY_HERO_START_X = 166;
// Moru finishes inside the 790..876 doorway instead of stopping beside it.
export const LEGACY_EXIT_X = 822;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const smooth = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

function cubic(
  from: number,
  controlA: number,
  controlB: number,
  to: number,
  progress: number,
) {
  const t = clamp(progress);
  const inverse = 1 - t;
  return (
    inverse ** 3 * from +
    3 * inverse ** 2 * t * controlA +
    3 * inverse * t ** 2 * controlB +
    t ** 3 * to
  );
}

export interface LegacyPathPoint {
  x: number;
  y: number;
  scale: number;
}

/** The exact centerline painted for the connected side path. */
export function legacyVisibleDetourPoint(progress: number): LegacyPathPoint {
  const t = clamp(progress);
  const firstLeg = 0.42;
  let x: number;
  let y: number;
  if (t <= firstLeg) {
    const u = t / firstLeg;
    x = cubic(330, 360, 360, 442, u);
    y = cubic(400, 345, 250, 245, u);
  } else {
    const u = (t - firstLeg) / (1 - firstLeg);
    x = cubic(442, 555, 642, 742, u);
    y = cubic(245, 238, 330, 400, u);
  }
  // The first few pixels are still the foreground floor; perspective begins
  // only once the path visibly climbs into the rear plane.
  const depth = clamp((LEGACY_SCENE_FLOOR_Y - y - 8) / 152);
  return { x, y, scale: mix(1, 0.72, depth) };
}

export interface LegacyHeroTrajectoryPoint extends LegacyPathPoint {
  pose: HeroPose;
  occludedByWall: boolean;
}

export function legacyGapFallTrajectory(
  progress: number,
): LegacyHeroTrajectoryPoint {
  const t = clamp(progress);
  if (t < 0.62) {
    const u = smooth(t / 0.62);
    return {
      x: mix(LEGACY_HERO_START_X, 430, u),
      y: LEGACY_SCENE_FLOOR_Y,
      scale: 1,
      pose: t < 0.03 ? "idle" : "walk",
      occludedByWall: false,
    };
  }
  const u = smooth((t - 0.62) / 0.38);
  return {
    x: mix(430, 496, u),
    y: mix(LEGACY_SCENE_FLOOR_Y, 475, u),
    scale: mix(1, 0.92, u),
    pose: "walk",
    occludedByWall: false,
  };
}

/** Includes the floor approach and exit so Moru's feet enter and leave the painted path. */
export function legacyDetourTrajectory(
  progress: number,
): LegacyHeroTrajectoryPoint {
  const t = clamp(progress);
  let point: LegacyPathPoint;
  if (t < 0.22) {
    const u = smooth(t / 0.22);
    point = {
      x: mix(LEGACY_HERO_START_X, 330, u),
      y: mix(LEGACY_SCENE_FLOOR_Y, 400, u),
      scale: 1,
    };
  } else if (t < 0.9) {
    point = legacyVisibleDetourPoint((t - 0.22) / 0.68);
  } else {
    const u = smooth((t - 0.9) / 0.1);
    point = {
      x: mix(742, LEGACY_EXIT_X, u),
      y: mix(400, LEGACY_SCENE_FLOOR_Y, u),
      scale: 1,
    };
  }
  return {
    ...point,
    pose: t < 0.03 || t >= 0.98 ? "idle" : "detour",
    // The wall is the foreground object while this rear lane crosses behind it.
    occludedByWall:
      point.x > 390 && point.x < 625 && point.y < LEGACY_SCENE_FLOOR_Y - 8,
  };
}

export function legacyJumpTrajectory(
  progress: number,
): LegacyHeroTrajectoryPoint {
  const t = clamp(progress);
  if (t < 0.27) {
    const u = smooth(t / 0.27);
    return {
      x: mix(LEGACY_HERO_START_X, 405, u),
      y: LEGACY_SCENE_FLOOR_Y,
      scale: 1,
      pose: t < 0.03 ? "idle" : "walk",
      occludedByWall: false,
    };
  }
  if (t < 0.72) {
    const u = (t - 0.27) / 0.45;
    return {
      x: mix(405, 588, smooth(u)),
      y: LEGACY_SCENE_FLOOR_Y - Math.sin(u * Math.PI) * 108,
      scale: 1,
      pose: "jump",
      occludedByWall: false,
    };
  }
  const u = smooth((t - 0.72) / 0.28);
  return {
    x: mix(588, LEGACY_EXIT_X, u),
    y: LEGACY_SCENE_FLOOR_Y,
    scale: 1,
    pose: t >= 0.98 ? "idle" : "walk",
    occludedByWall: false,
  };
}

export function legacyDuckTrajectory(
  progress: number,
): LegacyHeroTrajectoryPoint {
  const t = clamp(progress);
  if (t < 0.25) {
    const u = smooth(t / 0.25);
    return {
      x: mix(LEGACY_HERO_START_X, 380, u),
      y: LEGACY_SCENE_FLOOR_Y,
      scale: 1,
      pose: t < 0.03 ? "idle" : "walk",
      occludedByWall: false,
    };
  }
  if (t < 0.83) {
    const u = smooth((t - 0.25) / 0.58);
    return {
      x: mix(380, 680, u),
      y: LEGACY_SCENE_FLOOR_Y,
      scale: 1,
      pose: "duck",
      occludedByWall: false,
    };
  }
  const u = smooth((t - 0.83) / 0.17);
  return {
    x: mix(680, LEGACY_EXIT_X, u),
    y: LEGACY_SCENE_FLOOR_Y,
    scale: 1,
    pose: t >= 0.98 ? "idle" : "walk",
    occludedByWall: false,
  };
}
