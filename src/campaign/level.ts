import type { ActionExecutor } from "./program";
import { executePhysicalAction } from "./physics";
import type { EnvironmentStep, StageDynamics } from "./run";
import type { Actor, Entity, PhysicalAction, StageId, WorldState } from "./types";

export interface SegmentDefinition {
  id: string;
  title: string;
  goal: string;
  description: string;
  hints: readonly [string, string, string];
  /** Entry must preserve physical state when later rooms depend on it. */
  enter: (previous: WorldState | null) => WorldState;
  execute?: ActionExecutor;
  /** Authored safe-path movement after every applicable instruction has yielded. */
  idleAction?: (world: WorldState) => PhysicalAction | null;
  advance: (world: WorldState) => EnvironmentStep;
  complete: (world: WorldState) => boolean;
}
export interface CampaignStageDefinition {
  id: Exclude<StageId, 1>;
  title: string;
  segments: readonly SegmentDefinition[];
  /** Required first-play learning cards. Core segment IDs remain stable in `segments`. */
  onboarding?: readonly SegmentDefinition[];
  practice: SegmentDefinition;
  story: { afterSegment: string; object: string; text: string };
}
export function allStageSegments(stage: CampaignStageDefinition): readonly SegmentDefinition[] {
  return [...(stage.onboarding ?? []), ...stage.segments];
}
export function isOnboardingSegment(stage: CampaignStageDefinition, segmentId: string): boolean {
  return stage.onboarding?.some((segment) => segment.id === segmentId) ?? false;
}
export function stageDynamics(stage: CampaignStageDefinition): StageDynamics {
  const sequence = allStageSegments(stage);
  function segment(world: WorldState): SegmentDefinition {
    const found = sequence.find((item) => item.id === world.segmentId);
    if (!found || world.stageId !== stage.id) throw new Error("현재 장과 구간의 세계 정의가 맞지 않아요.");
    return found;
  }
  return {
    execute: (world, action) => (segment(world).execute ?? executePhysicalAction)(world, action),
    idleAction: (world) => segment(world).idleAction?.(world) ?? null,
    advance: (world) => segment(world).advance(world),
    segmentComplete: (world) => segment(world).complete(world),
    nextSegment: (world) => {
      const index = sequence.findIndex((item) => item.id === world.segmentId);
      if (index < 0) throw new Error("다음 구간을 확인할 수 없어요.");
      const next = sequence[index + 1];
      if (!next) return null;
      // Entering core is a hard boundary: onboarding tools, facts, and physical state do not leak.
      const onboarding = isOnboardingSegment(stage, world.segmentId);
      const entered = next.enter(onboarding && !isOnboardingSegment(stage, next.id) ? null : world);
      if (onboarding) return entered;
      const facts = [...world.facts];
      const seen = new Set(facts.map((fact) => JSON.stringify(fact)));
      for (const fact of entered.facts) {
        const signature = JSON.stringify(fact);
        if (!seen.has(signature)) { facts.push(fact); seen.add(signature); }
      }
      return { ...entered, tick: world.tick, segmentStartedAt: world.tick, attempt: world.attempt, facts };
    },
    sealAfter: (id) => stage.id !== 10 ? null : id === stage.segments[1]?.id ? 1 : id === stage.segments[3]?.id ? 2 : null,
    isOnboardingSegment: (id) => isOnboardingSegment(stage, id),
  };
}
export function makeEntity(id: string, name: string, region: string, x: number, patch: Partial<Entity> = {}): Entity {
  return { id, name, description: name, material: "metal", movable: false, weight: 1, capacity: 10, reach: 1, location: { region, x, y: 0 }, parent: null, properties: {}, ...patch };
}
export function makeHero(region: string, x = 0): Actor {
  return { id: "hero", location: { region, x, y: 0 }, holding: null, carrying: [], riding: null, capabilities: ["weight:1"] };
}
export function makeWorld(stageId: StageId, segmentId: string, entities: Entity[], hero = makeHero(segmentId)): WorldState {
  // The delivery letter is worn equipment, outside puzzle hands and item hooks.
  // It travels through the same ownership tree, so it cannot respawn from a floor.
  const previous = entities.find((entity) => entity.id === "letter");
  const letter = makeEntity("letter", "배달할 편지", hero.location.region, hero.location.x, {
    ...previous, description: "몸에 매단 편지 주머니. 손과 물건 고리를 차지하지 않으며 모험 중에는 내려놓지 않아요.",
    material: "cloth", movable: false, weight: 0, parent: "hero", location: { ...hero.location },
    properties: { ...previous?.properties, kind: "object", slot: "equipment", equipment: true, dry: previous?.properties.dry ?? true },
  });
  const items = [...entities.filter((entity) => entity.id !== "letter"), letter];
  if (!hero.carrying.includes(letter.id)) hero.carrying = [...hero.carrying, letter.id];
  return { stageId, segmentId, segmentStartedAt: 0, tick: 0, attempt: 1, entities: Object.fromEntries(items.map((entity) => [entity.id, entity])), actors: { hero }, visible: items.map((entity) => entity.id), facts: [] };
}
export function at(world: WorldState, actorId: string, entityId: string): boolean {
  const actor = world.actors[actorId];
  const entity = world.entities[entityId];
  return !!actor && !!entity && actor.location.region === entity.location.region && actor.location.x === entity.location.x && actor.location.y === entity.location.y;
}
export function stillWorld(world: WorldState): EnvironmentStep {
  return { world: { ...world, tick: world.tick + 1 }, events: [], canChange: false };
}

export function elapsedTicks(world: WorldState): number {
  return world.tick - (world.segmentStartedAt ?? 0);
}
