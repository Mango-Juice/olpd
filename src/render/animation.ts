import type { Action, ExecutionEvent, Outcome } from "../game/types";

export type HeroPose =
  "idle" | "walk" | "jump" | "duck" | "detour" | "death" | "revive" | "joy";
export type SoundCue = "step" | "jump" | "land" | "revive" | "death" | "win";

export interface HeroFrame {
  x: number;
  y: number;
  pose: HeroPose;
  phase: number;
  facing: 1 | -1;
  opacity: number;
  scale: number;
  rotation: number;
  dust: number;
  shadow: number;
  fatalKind?: "fall" | "spikes" | "bonk";
}

export const FLOOR_Y = 402;
export const START_X = 152;
export const APPROACH_X = 430;
export const EXIT_X = 836;

export const eventDuration = (event: ExecutionEvent) =>
  event.repeated ? 1400 : 4200;

const crossed = (from: number, to: number, threshold: number) =>
  from < threshold && to >= threshold;

/** Returns presentation-only audio markers crossed during this animation slice. */
export function soundCuesBetween(
  event: ExecutionEvent,
  fromProgress: number,
  toProgress: number,
  cleared: boolean,
): SoundCue[] {
  const cues: SoundCue[] = [];
  const stepThresholds = event.repeated ? [0.17] : [0.09, 0.21];
  for (const threshold of stepThresholds) {
    if (crossed(fromProgress, toProgress, threshold)) cues.push("step");
  }

  if (event.action === "jump") {
    const actionSpan = event.outcome === "safe" ? 0.46 : 0.34;
    const launch = 0.3 + actionSpan * 0.14;
    if (crossed(fromProgress, toProgress, launch)) cues.push("jump");
    if (event.outcome === "safe") {
      const land = 0.3 + actionSpan * 0.82;
      if (crossed(fromProgress, toProgress, land)) cues.push("land");
    }
  }
  if (event.outcome === "death" && crossed(fromProgress, toProgress, 0.64))
    cues.push("death");
  if (
    event.outcome === "safe" &&
    cleared &&
    crossed(fromProgress, toProgress, 1)
  )
    cues.push("win");
  return cues;
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const smooth = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

export interface DetourPathPoint {
  x: number;
  y: number;
  scale: number;
}

/** Shared centerline for the visible rear-lane path and Moru's feet. */
export function detourPathPoint(progress: number): DetourPathPoint {
  const t = clamp(progress);
  if (t < 0.2) {
    const u = smooth(t / 0.2);
    return {
      x: mix(APPROACH_X, 455, u),
      y: mix(FLOOR_Y, 320, u),
      scale: mix(1, 0.86, u),
    };
  }
  if (t < 0.32) {
    const u = smooth((t - 0.2) / 0.12);
    return {
      x: mix(455, 490, u),
      y: mix(320, 252, u),
      scale: mix(0.86, 0.72, u),
    };
  }
  if (t < 0.68) {
    const u = smooth((t - 0.32) / 0.36);
    return {
      x: mix(490, 660, u),
      y: 252,
      scale: 0.72,
    };
  }
  if (t < 0.82) {
    const u = smooth((t - 0.68) / 0.14);
    return {
      x: mix(660, 695, u),
      y: mix(252, 320, u),
      scale: mix(0.72, 0.86, u),
    };
  }
  const u = smooth((t - 0.82) / 0.18);
  return {
    x: mix(695, 720, u),
    y: mix(320, FLOOR_Y, u),
    scale: mix(0.86, 1, u),
  };
}

function fatalKind(event: ExecutionEvent): NonNullable<HeroFrame["fatalKind"]> {
  const { observation, action } = event;
  if (observation === "pitCeilingPath")
    return action === "jump" ? "bonk" : "fall";
  if (observation === "spikesCeilingPath")
    return action === "jump" ? "bonk" : "spikes";
  if (observation === "pit" || observation === "bridge") return "fall";
  if (observation === "floorSpikes") return "spikes";
  return "bonk";
}

function approach(progress: number): HeroFrame {
  const u = smooth(progress / 0.3);
  return {
    x: mix(START_X, APPROACH_X, u),
    y: FLOOR_Y,
    pose: progress < 0.03 ? "idle" : "walk",
    phase: progress * 10,
    facing: 1,
    opacity: 1,
    scale: 1,
    rotation: 0,
    dust: u,
    shadow: 1,
  };
}

function actionFrame(action: Action, u: number, targetX: number): HeroFrame {
  const t = clamp(u);
  if (action === "jump") {
    const prep = 0.14;
    const land = 0.82;
    let y = FLOOR_Y;
    let pose: HeroPose = "jump";
    let scale = 1;
    if (t < prep) {
      pose = "jump";
      scale = 1 - Math.sin((t / prep) * Math.PI) * 0.08;
      y += Math.sin((t / prep) * Math.PI) * 4;
    } else if (t < land) {
      const air = (t - prep) / (land - prep);
      y -= Math.sin(air * Math.PI) * 112;
    } else {
      const settle = (t - land) / (1 - land);
      scale = 1 - Math.sin(settle * Math.PI) * 0.09;
      y += Math.sin(settle * Math.PI) * 3;
    }
    return {
      x: mix(APPROACH_X, targetX, smooth(t)),
      y,
      pose,
      phase: t,
      facing: 1,
      opacity: 1,
      scale,
      rotation: 0,
      dust: t > land ? 1 - t : 0,
      shadow: clamp(1 - (FLOOR_Y - y) / 150, 0.2, 1),
    };
  }
  if (action === "duck") {
    return {
      x: mix(APPROACH_X, targetX, smooth(t)),
      y: FLOOR_Y,
      pose: "duck",
      phase: t * 6,
      facing: 1,
      opacity: 1,
      scale: 1,
      rotation: 0,
      dust: 0.35,
      shadow: 1.05,
    };
  }
  if (action === "detour") {
    if (targetX < 650) {
      return {
        x: mix(APPROACH_X, targetX, smooth(t)),
        y: FLOOR_Y,
        pose: "detour",
        phase: t,
        facing: 1,
        opacity: 1,
        scale: 1,
        rotation: 0,
        dust: 0.2,
        shadow: 1,
      };
    }
    const point = detourPathPoint(t);
    return {
      x: point.x,
      y: point.y,
      pose: "detour",
      phase: t,
      facing: 1,
      opacity: 1,
      scale: point.scale,
      rotation: 0,
      dust: 0.12,
      shadow: mix(1, 0.58, clamp((1 - point.scale) / 0.28)),
    };
  }
  return {
    x: mix(APPROACH_X, targetX, smooth(t)),
    y: FLOOR_Y,
    pose: "walk",
    phase: t * 8,
    facing: 1,
    opacity: 1,
    scale: 1,
    rotation: 0,
    dust: 0.55,
    shadow: 1,
  };
}

function deathFrame(event: ExecutionEvent, progress: number): HeroFrame {
  if (progress < 0.3) return approach(progress);
  const kind = fatalKind(event);
  const actionProgress = clamp((progress - 0.3) / 0.34);
  if (progress < 0.64) {
    const frame = actionFrame(event.action, actionProgress, 584);
    if (kind === "fall" && actionProgress > 0.65) {
      const fall = (actionProgress - 0.65) / 0.35;
      frame.y += fall * fall * 74;
      frame.rotation = fall * 0.32;
      frame.scale = mix(1, 0.82, fall);
      frame.shadow = 0;
    }
    return frame;
  }
  const t = smooth((progress - 0.64) / 0.36);
  if (kind === "fall") {
    return {
      x: mix(584, 598, t),
      y: mix(FLOOR_Y + 58, 470, t),
      pose: "death",
      phase: t,
      facing: 1,
      opacity: 1 - t,
      scale: mix(0.92, 0.54, t),
      rotation: 0,
      dust: 0,
      shadow: 0,
      fatalKind: kind,
    };
  }
  return {
    x: mix(584, 548, t),
    y: FLOOR_Y + 7,
    pose: "death",
    phase: t,
    facing: 1,
    opacity: 1 - t,
    scale: mix(1.08, 0.62, t),
    rotation: 0,
    dust: 0,
    shadow: 1 - t,
    fatalKind: kind,
  };
}

function blockedFrame(event: ExecutionEvent, progress: number): HeroFrame {
  if (progress < 0.34) return approach(progress * (0.3 / 0.34));
  const t = smooth((progress - 0.34) / 0.66);
  const tryFrame = actionFrame(event.action, Math.min(1, t * 1.5), 514);
  if (t > 0.52) {
    tryFrame.x = mix(514, 496, smooth((t - 0.52) / 0.48));
    tryFrame.pose = "idle";
    tryFrame.facing = -1;
    tryFrame.phase = t * 2;
    tryFrame.rotation = -0.035;
  }
  return tryFrame;
}

export function eventHeroFrame(
  event: ExecutionEvent,
  progress: number,
  cleared: boolean,
): HeroFrame {
  const p = clamp(progress);
  if (event.outcome === "death") return deathFrame(event, p);
  if (event.outcome === "blocked") return blockedFrame(event, p);
  if (p < 0.3) return approach(p);
  if (p < 0.76) return actionFrame(event.action, (p - 0.3) / 0.46, 720);
  const exit = smooth((p - 0.76) / 0.24);
  if (cleared && p > 0.89) {
    return {
      x: mix(720, 786, smooth(Math.min(1, exit * 1.45))),
      y: FLOOR_Y,
      pose: "joy",
      phase: (p - 0.89) / 0.11,
      facing: 1,
      opacity: 1,
      scale: 1,
      rotation: 0,
      dust: 0.2,
      shadow: 1,
    };
  }
  return {
    x: mix(720, EXIT_X, exit),
    y: FLOOR_Y,
    pose: "walk",
    phase: p * 10,
    facing: 1,
    opacity: 1,
    scale: 1,
    rotation: 0,
    dust: 0.45,
    shadow: 1,
  };
}

export function idleHeroFrame(timeSeconds: number): HeroFrame {
  return {
    x: START_X,
    y: FLOOR_Y,
    pose: "idle",
    phase: timeSeconds,
    facing: 1,
    opacity: 1,
    scale: 1,
    rotation: 0,
    dust: 0,
    shadow: 1,
  };
}

export function reviveHeroFrame(from: HeroFrame, progress: number): HeroFrame {
  const p = clamp(progress);
  const summon = smooth(clamp(p / 0.7));
  const settle = smooth(clamp((p - 0.7) / 0.3));
  return {
    x: START_X,
    y: FLOOR_Y - Math.sin(summon * Math.PI) * 12,
    pose: p >= 0.92 ? "idle" : "revive",
    phase: p,
    facing: 1,
    opacity: summon,
    scale: mix(0.48, 1 + Math.sin(settle * Math.PI) * 0.08, summon),
    rotation: 0,
    dust: 0,
    shadow: summon,
  };
}

export function outcomeTone(outcome: Outcome) {
  return outcome === "safe"
    ? "#80d7b6"
    : outcome === "death"
      ? "#f3a785"
      : "#f6c76d";
}
