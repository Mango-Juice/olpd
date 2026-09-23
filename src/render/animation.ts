import type { Action, ExecutionEvent } from "../game/types";
import type { StagePresentation } from "../campaign/run";
import type { Verb } from "../campaign/types";
import type { SpatialMotion } from "../campaign/spatial/types";
import { projectSpatialPoint } from "./spatial-geometry";

export type HeroPose =
  | "idle"
  | "walk"
  | "jump"
  | "duck"
  | "detour"
  | "push"
  | "pull"
  | "take"
  | "place"
  | "turn"
  | "hold"
  | "pour"
  | "climb"
  | "interact"
  | "death"
  | "revive"
  | "joy";
export type SoundCue =
  | "step"
  | "jump"
  | "land"
  | "safe"
  | "revive"
  | "death"
  | "win";

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
  /** Screen-space contact used by campaign interaction tracks. */
  contact?: { x: number; y: number; amount: number };
}

export const FLOOR_Y = 402;
export const START_X = 152;
export const APPROACH_X = 430;
export const EXIT_X = 836;

export const eventDuration = (event: ExecutionEvent) =>
  event.repeated ? 1400 : 4200;

/** Player abandonment has no simulated action to replay before the farewell. */
export const isAbandonPresentation = (presentation: StagePresentation) =>
  presentation.outcome === "death" && presentation.events.length === 0;

export const campaignPresentationDuration = (
  presentation: StagePresentation,
  reducedMotion = false,
) => {
  if (isAbandonPresentation(presentation)) return reducedMotion ? 350 : 650;
  if (presentation.outcome === "revive") return reducedMotion ? 1050 : 1650;
  const traces = presentation.events.flatMap((event) => event.motion ? [event.motion] : []);
  if (traces.length) {
    const distance = (trace: SpatialMotion) => trace.points.slice(1).reduce((sum, point, index) => {
      const previous = trace.points[index];
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y, (point.z ?? 0) - (previous.z ?? 0));
    }, 0);
    const base = Math.max(...traces.map((trace) => trace.kind === "jump"
      ? 650 : trace.kind === "interact" ? Math.min(1000, Math.max(700, distance(trace) * 400))
        : Math.max(250, distance(trace) * 400)));
    const outcomeDuration = presentation.outcome === "death" || presentation.outcome === "blocked"
      ? Math.min(2000, Math.max(1400, base + 700))
      : presentation.outcome === "cleared" ? Math.max(1200, base) : base;
    return Math.round(outcomeDuration * (presentation.repeated ? 1 / 3 : 1) * (reducedMotion ? .65 : 1));
  }
  return presentation.repeated ? 1400 : 4200;
};

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

const campaignEvent = (presentation: StagePresentation) =>
  presentation.events.find((event) => event.actor === "hero" && event.verb) ??
  presentation.events.find((event) => event.verb);

export function campaignActorVerb(
  presentation: StagePresentation,
  actorId: string,
): Verb | null {
  return presentation.events.find(
    (event) => event.actor === actorId && event.verb,
  )?.verb ?? null;
}

export function campaignPresentationVerb(
  presentation: StagePresentation,
): Verb | null {
  return campaignEvent(presentation)?.verb ?? null;
}

/** Audio markers for later chapters use the same presentation clock as Chapter 1. */
export function campaignSoundCuesBetween(
  presentation: StagePresentation,
  fromProgress: number,
  toProgress: number,
): SoundCue[] {
  const cues: SoundCue[] = [];
  if (presentation.outcome === "revive") {
    if (crossed(fromProgress, toProgress, 0.02)) cues.push("revive");
    return cues;
  }
  if (isAbandonPresentation(presentation)) {
    if (crossed(fromProgress, toProgress, 0.02)) cues.push("death");
    return cues;
  }
  const verb = campaignPresentationVerb(presentation);
  const steps = presentation.repeated ? [0.17] : [0.09, 0.21];
  if (verb === "move" || verb === "jump" || verb === "duck" || verb === "climb") {
    for (const threshold of steps) {
      if (crossed(fromProgress, toProgress, threshold)) cues.push("step");
    }
  }
  if (verb === "jump") {
    if (crossed(fromProgress, toProgress, 0.36)) cues.push("jump");
    if (presentation.outcome !== "death" && crossed(fromProgress, toProgress, 0.7)) {
      cues.push("land");
    }
  } else if (
    verb &&
    verb !== "move" &&
    verb !== "duck" &&
    verb !== "climb" &&
    crossed(fromProgress, toProgress, 0.55)
  ) {
    cues.push("safe");
  }
  if (presentation.outcome === "death" && crossed(fromProgress, toProgress, 0.7)) {
    cues.push("death");
  }
  if (presentation.outcome === "cleared" && crossed(fromProgress, toProgress, 0.96)) {
    cues.push("win");
  }
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

export function reviveHeroFrame(progress: number): HeroFrame {
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

export interface CampaignHeroMotion {
  presentation: StagePresentation;
  progress: number;
  from: { x: number; y: number; rotation: number };
  to: { x: number; y: number; rotation: number };
  contact?: { x: number; y: number };
  verb?: Verb | null;
}

const campaignPose = (verb: Verb | null, moving: boolean): HeroPose => {
  if (verb === "jump") return "jump";
  if (verb === "duck") return "duck";
  if (verb === "climb") return "climb";
  if (verb === "push") return "push";
  if (verb === "pull") return "pull";
  if (verb === "take" || verb === "release") return "take";
  if (verb === "place") return "place";
  if (verb === "turn" || verb === "open" || verb === "close") return "turn";
  if (verb === "hold") return "hold";
  if (verb === "pour") return "pour";
  if (moving || verb === "move" || verb === "board" || verb === "dismount") {
    return "walk";
  }
  if (verb && verb !== "observe" && verb !== "remember") return "interact";
  return "idle";
};

const directMovementVerb = (verb: Verb | null) =>
  verb === "move" ||
  verb === "jump" ||
  verb === "duck" ||
  verb === "climb" ||
  verb === "board" ||
  verb === "dismount";

/**
 * Maps a deterministic campaign boundary onto the same hero pose lifecycle as
 * Chapter 1. Physics remains in `StageRun`; this function is presentation only.
 */
export function campaignHeroFrame(motion: CampaignHeroMotion): HeroFrame {
  const p = clamp(motion.progress);
  const { presentation, from, to } = motion;
  if (presentation.outcome === "blocked" && presentation.events.every((event) => event.actor === null)) {
    return { ...idleHeroFrame(0), x: from.x, y: from.y, rotation: from.rotation };
  }
  if (isAbandonPresentation(presentation)) {
    const fade = smooth(p);
    return { x: from.x, y: from.y + fade * 4, pose: "death", phase: p,
      facing: 1, opacity: 1 - fade, scale: 1 - fade * .25,
      rotation: from.rotation, dust: 0, shadow: 1 - fade };
  }
  if (presentation.outcome === "revive") {
    const frame = reviveHeroFrame(p);
    return {
      ...frame,
      x: to.x,
      y: to.y - Math.sin(smooth(clamp(p / 0.7)) * Math.PI) * 12,
      rotation: to.rotation,
    };
  }

  const verb = motion.verb === undefined
    ? campaignPresentationVerb(presentation)
    : motion.verb;
  const interaction = !!verb && !directMovementVerb(verb) && verb !== "observe" && verb !== "remember";
  const actionProgress = smooth(
    clamp((p - (interaction ? 0.08 : 0.18)) / (interaction ? 0.3 : 0.58)),
  );
  const moved = Math.hypot(to.x - from.x, to.y - from.y) > 1;
  const contactFacing: 1 | -1 = motion.contact
    ? motion.contact.x < from.x
      ? -1
      : 1
    : to.x < from.x
      ? -1
      : 1;
  const contactX = interaction && motion.contact
    ? motion.contact.x - contactFacing * 58
    : to.x;
  let x = mix(from.x, contactX, actionProgress);
  let y = mix(from.y, to.y, actionProgress);
  const rotation = mix(from.rotation, to.rotation, actionProgress);
  const facing = contactFacing;
  if (verb === "jump" && moved) y -= Math.sin(actionProgress * Math.PI) * 72;

  if (presentation.outcome === "death" && p >= 0.7) {
    const fatal = smooth((p - 0.7) / 0.3);
    return {
      x: mix(x, x - facing * 22, fatal),
      y: y + fatal * 8,
      pose: "death",
      phase: fatal,
      facing,
      opacity: 1 - fatal,
      scale: mix(1.04, 0.62, fatal),
      rotation,
      dust: 0,
      shadow: 1 - fatal,
      fatalKind: verb === "jump" ? "fall" : "bonk",
    };
  }

  if (presentation.outcome === "cleared" && p >= 0.86) {
    return {
      x: to.x,
      y: to.y,
      pose: "joy",
      phase: (p - 0.86) / 0.14,
      facing,
      opacity: 1,
      scale: 1,
      rotation: to.rotation,
      dust: 0.2,
      shadow: 1,
    };
  }

  const blockedReturn = presentation.outcome === "blocked" && p > 0.76;
  if (blockedReturn) {
    const back = smooth((p - 0.76) / 0.24);
    x = mix(contactX, contactX - facing * 18, back);
  } else if (interaction && presentation.outcome !== "death" && p > 0.84) {
    x = mix(contactX, to.x, smooth((p - 0.84) / 0.16));
  }
  const pose = blockedReturn && p > 0.9
    ? "idle"
    : interaction && p < 0.28
      ? moved
        ? "walk"
        : "idle"
      : interaction && verb !== "hold" && p > 0.84 && presentation.outcome !== "death"
        ? "idle"
        : campaignPose(verb, moved);
  const contactAmount = motion.contact
    ? verb === "hold"
      ? smooth(clamp((p - 0.34) / 0.2))
      : Math.sin(clamp((p - 0.34) / 0.52) * Math.PI)
    : 0;
  return {
    x,
    y,
    pose,
    phase: actionProgress * (pose === "walk" || pose === "climb" ? 6 : 1),
    facing,
    opacity: 1,
    scale: pose === "push" || pose === "pull" ? 1 - contactAmount * 0.035 : 1,
    rotation:
      rotation +
      (pose === "push" ? facing * 0.055 * contactAmount : 0) -
      (pose === "pull" ? facing * 0.045 * contactAmount : 0) +
      (interaction && pose !== "push" && pose !== "pull"
        ? facing * 0.025 * contactAmount
        : 0),
    dust: moved ? 0.42 : 0,
    shadow: 1,
    ...(motion.contact && contactAmount > 0.01
      ? { contact: { ...motion.contact, amount: contactAmount } }
      : {}),
  };
}

/** Samples the simulation's swept path, including its actual jump arc and depth lane. */
export function spatialMotionPoint(motion: SpatialMotion, progress: number) {
  const points = motion.points;
  if (!points.length) return null;
  const end = points[points.length - 1];
  const target = Math.max(0, Math.min(1, progress)) * end.t;
  const nextIndex = points.findIndex((point) => point.t >= target);
  if (nextIndex <= 0) return points[0];
  const next = points[nextIndex];
  const previous = points[nextIndex - 1];
  const span = next.t - previous.t;
  const weight = span > 0 ? (target - previous.t) / span : 0;
  return { x: previous.x + (next.x - previous.x) * weight,
    y: previous.y + (next.y - previous.y) * weight,
    z: (previous.z ?? 0) + ((next.z ?? 0) - (previous.z ?? 0)) * weight,
    t: target };
}

export interface SpatialCampaignMotion extends CampaignHeroMotion {
  trace: SpatialMotion;
}

/** New spatial scenes reuse the Chapter 1 hero art with cause-specific contact timing. */
export function spatialCampaignHeroFrame(motion: SpatialCampaignMotion): HeroFrame {
  const { presentation, trace } = motion;
  const p = clamp(motion.progress);
  if (presentation.outcome === "revive" || !trace.points.length) return campaignHeroFrame(motion);
  const travel = clamp((p - .08) / .64);
  const sampled = spatialMotionPoint(trace, travel)!;
  const projected = projectSpatialPoint(sampled);
  const first = trace.points[0];
  const last = trace.points[trace.points.length - 1];
  const facing: 1 | -1 = last.x < first.x ? -1 : 1;
  const moving = Math.hypot(last.x - first.x, last.y - first.y, (last.z ?? 0) - (first.z ?? 0)) > .01;
  const pathDistance = trace.points.slice(1).reduce((sum, point, index) => {
    const previous = trace.points[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y, (point.z ?? 0) - (previous.z ?? 0));
  }, 0);
  const verb = motion.verb === undefined ? campaignPresentationVerb(presentation) : motion.verb;
  const contact = trace.contact && p >= .68
    ? projectSpatialPoint({ ...trace.contact, z: last.z }) : null;
  const contactAmount = contact ? Math.sin(clamp((p - .68) / .3) * Math.PI) : 0;
  const cause = trace.kind;
  let pose: HeroPose = p < .08 ? "idle" : moving && travel < .98
    ? trace.kind === "jump" || verb === "jump" ? "jump" : "walk"
    : campaignPose(verb, false);
  let x = projected.x, y = projected.y, opacity = 1, rotation = motion.to.rotation;
  let scale = 1;
  if (presentation.outcome === "blocked" && p >= .76) {
    const recoil = smooth((p - .76) / .24);
    x -= facing * recoil * 18;
    pose = recoil > .75 ? "idle" : "push";
  } else if (presentation.outcome === "death" && p >= .76) {
    const fatal = smooth((p - .76) / .24);
    pose = "death";
    opacity = 1 - fatal;
    scale = 1 - fatal * .38;
    if (cause === "fall") y += fatal * 74;
    else if (cause === "wind") x += facing * fatal * 52;
    else if (cause === "water") y += fatal * 34;
    else if (cause === "crush") scale *= 1 - fatal * .28;
    else if (cause === "steam" || cause === "heat") x -= facing * fatal * 20;
    else if (cause === "spikes") y -= fatal * 10;
    else x -= facing * fatal * 14;
  } else if (presentation.outcome === "cleared" && p >= .88) {
    pose = "joy";
  }
  return { x, y, pose, phase: travel * (pose === "walk" ? pathDistance * 3 : 1), facing,
    opacity, scale, rotation, dust: moving && pose === "walk" ? .35 : 0,
    shadow: pose === "jump" ? .45 : 1,
    ...(pose === "death" ? { fatalKind: cause === "fall" ? "fall" as const : cause === "spikes" ? "spikes" as const : "bonk" as const } : {}),
    ...(contact && contactAmount > .01 ? { contact: { ...contact, amount: contactAmount } } : {}) };
}
