import type { PhysicalAction, WorldState } from "../../../src/campaign/types";

// Historical shared-v1 fixture metadata; never called by the current runtime.
/** First obstacle or approach point reached when no notebook rule applies. */
const DEFAULT_WALK_TARGETS: Readonly<Record<string, string>> = {
  "02-v2-1": "02-v2-1-exit", "02-v2-2": "02-v2-2-window", "02-v2-3": "02-v2-3-bank",
  "02-v2-4": "02-v2-4-bank", "02-v2-5": "02-v2-5-stairs", "02-v2-6": "02-v2-6-exit",
  "03-v2-1": "03-v2-1-exit", "03-v2-2": "03-v2-2-oven", "03-v2-3": "03-v2-3-exit",
  "03-v2-4": "03-v2-4-shelf", "03-v2-5": "03-v2-5-exit", "03-v2-6": "03-v2-6-exit",
  "04-v2-1": "04-v2-1-windmill", "04-v2-2": "04-v2-2-exit", "04-v2-3": "04-v2-3-exit",
  "04-v2-4": "04-v2-4-exit", "04-v2-5": "04-v2-5-door", "04-v2-6": "04-v2-6-exit",
  "05-v2-1": "05-v2-1-path", "05-v2-2": "05-v2-2-thorns", "05-v2-3": "05-v2-3-vine",
  "05-v2-4": "05-v2-4-closed", "05-v2-5": "05-v2-5-arch", "05-v2-6": "05-v2-6-vine",
  "06-v2-1": "06-v2-1-alcove", "06-v2-2": "06-v2-2-ladder", "06-v2-3": "06-v2-3-exit",
  "06-v2-4": "06-v2-4-door", "06-v2-5": "06-v2-5-lower-door", "06-v2-6": "06-v2-6-door",
  "07-v2-1": "07-v2-1-meeting", "07-v2-2": "07-v2-2-curtain", "07-v2-3": "07-v2-3-arrival",
  "07-v2-4": "07-v2-4-curtain", "07-v2-5": "07-v2-5-gap", "07-v2-6": "07-v2-6-curtain",
  "08-v2-1": "08-v2-1-bridge", "08-v2-2": "08-v2-2-left-bridge", "08-v2-3": "08-v2-3-exit",
  "08-v2-4": "08-v2-4-stairs", "08-v2-5": "08-v2-5-triangle-bridge", "08-v2-6": "08-v2-6-boat",
  "09-v2-1": "09-v2-1-stairs", "09-v2-2": "09-v2-2-exit", "09-v2-3": "09-v2-3-lift",
  "09-v2-4": "09-v2-4-stairs", "09-v2-5": "09-v2-5-bridge", "09-v2-6": "09-v2-6-door",
  "10-v2-1": "10-v2-1-safe-spot", "10-v2-2": "10-v2-2-plate", "10-v2-3": "10-v2-3-inside",
  "10-v2-4": "10-v2-4-wing", "10-v2-5": "10-v2-5-latch", "10-v2-6": "10-v2-6-door",
};

export function authoredDefaultWalk(world: WorldState): PhysicalAction | null {
  const targetId = DEFAULT_WALK_TARGETS[world.segmentId];
  if (!targetId) throw new Error(`기본 전진 대상이 없는 캠페인 장면이에요: ${world.segmentId}`);
  const target = world.entities[targetId];
  const hero = world.actors.hero;
  if (!target || !hero) throw new Error(`기본 전진 대상을 현재 장면에서 찾을 수 없어요: ${targetId}`);
  // Reaching the target's horizontal approach line is enough. Gravity, stairs,
  // and hanging devices may deliberately keep actor and object on different Y.
  if (hero.location.region === target.location.region && hero.location.x === target.location.x) return null;
  return { kind: "action", actor: "hero", verb: "move", target: targetId };
}
