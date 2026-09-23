import type { ActionExecutor } from "./program";
import { executePhysicalAction } from "./physics.js";
import type { EnvironmentStep, StageDynamics } from "./run";
import type { Actor, Entity, PhysicalAction, StageId, WorldState } from "./types";
import type { SpatialBody, SpatialSurface } from "./spatial/types";

/** Authored, bounded stage composition. Coordinates are world units, never UI data. */
export interface SceneComposition {
  floors: readonly { from: number; to: number; y: number }[];
  ceiling?: boolean;
  spatial?: { bodies: SpatialBody[]; surfaces: SpatialSurface[]; ceiling?: number };
}

export interface SegmentDefinition {
  id: string;
  title: string;
  goal: string;
  description: string;
  hints: readonly [string, string, string];
  scene?: SceneComposition;
  /** Entry must preserve physical state when later rooms depend on it. */
  enter: (previous: WorldState | null) => WorldState;
  execute?: ActionExecutor;
  /** Historical fixture metadata only; the runtime never dispatches this action. */
  idleAction?: (world: WorldState) => PhysicalAction | null;
  advance: (world: WorldState) => EnvironmentStep;
  complete: (world: WorldState) => boolean;
}
export interface CampaignStageDefinition {
  id: Exclude<StageId, 1>;
  title: string;
  /** Required by registered campaign content; omitted only by legacy test stages. */
  contentRevision?: "shared-v1" | "spatial-v1";
  /** The chapter's purpose, never a list of steps or hidden completion rules. */
  objective?: string;
  segments: readonly SegmentDefinition[];
  /** Required first-play learning cards. Core segment IDs remain stable in `segments`. */
  onboarding?: readonly SegmentDefinition[];
  practice: SegmentDefinition;
  story: { afterSegment: string; object: string; text: string };
}
export function allStageSegments(stage: CampaignStageDefinition): readonly SegmentDefinition[] {
  return [...(stage.onboarding ?? []), ...stage.segments];
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
    advance: (world) => segment(world).advance(world),
    segmentComplete: (world) => segment(world).complete(world),
    nextSegment: (world) => {
      const index = sequence.findIndex((item) => item.id === world.segmentId);
      if (index < 0) throw new Error("다음 구간을 확인할 수 없어요.");
      const next = sequence[index + 1];
      if (!next) return null;
      const entered = next.enter(world);
      const facts = [...world.facts];
      const seen = new Set(facts.map((fact) => JSON.stringify(fact)));
      for (const fact of entered.facts) {
        const signature = JSON.stringify(fact);
        if (!seen.has(signature)) { facts.push(fact); seen.add(signature); }
      }
      return { ...entered, tick: world.tick, segmentStartedAt: world.tick, attempt: world.attempt, facts };
    },
    // A life always retries from the chapter entrance; story seals are presentation only.
    sealAfter: () => null,
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
    publicKind: "letter",
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
