import { resolveActionReferences } from "../conditions";
import { makeEntity, makeHero, makeWorld } from "../level";
import type { ActionResult } from "../program";
import type { Actor, Entity, PhysicalAction, Scalar, StageId, WorldState } from "../types";
import { authoredPublicKind } from "./public-kinds";

export function quietEntity(
  id: string,
  name: string,
  region: string,
  x: number,
  y: number,
  properties: Record<string, Scalar>,
  patch: Partial<Entity> = {},
): Entity {
  return makeEntity(id, name, region, x, {
    description: name,
    publicKind: authoredPublicKind(id),
    location: { region, x, y },
    properties: { kind: "object", ...properties },
    ...patch,
  });
}

export function quietWorld(
  stageId: StageId,
  segmentId: string,
  entities: Entity[],
  hero: { x?: number; y?: number } = {},
  keeper?: { x: number; y: number },
): WorldState {
  const world = makeWorld(stageId, segmentId, entities, makeHero(segmentId, hero.x ?? 0));
  world.actors.hero.location.y = hero.y ?? 0;
  world.entities.letter.location = { ...world.actors.hero.location };
  if (keeper) {
    const actor: Actor = {
      id: "keeper",
      location: { region: segmentId, x: keeper.x, y: keeper.y },
      holding: null,
      carrying: [],
      riding: null,
      capabilities: ["weight:0.3", "max-weight:0.3"],
    };
    world.actors.keeper = actor;
  }
  return world;
}

export function resolved(world: WorldState, action: PhysicalAction): ActionResult | PhysicalAction {
  const resolution = resolveActionReferences(world, action);
  return resolution.outcome === "valid"
    ? resolution.action
    : { world, outcome: "clarification", reason: resolution.reason };
}

export function isActionResult(value: ActionResult | PhysicalAction): value is ActionResult {
  return "world" in value;
}

export function done(world: WorldState, reason: string): ActionResult {
  return { world, outcome: "done", reason };
}

export function blocked(world: WorldState, reason: string): ActionResult {
  return { world, outcome: "blocked", reason };
}

export function clarification(world: WorldState, reason: string): ActionResult {
  return { world, outcome: "clarification", reason };
}

export function moveActor(world: WorldState, actorId: "hero" | "keeper", targetId: string, reason: string): ActionResult {
  const next = structuredClone(world);
  const actor = next.actors[actorId];
  const target = next.entities[targetId];
  if (!actor || !target) return clarification(world, "현재 장면에서 주체나 목적지를 찾을 수 없어요.");
  if (actor.holding) {
    const held = next.entities[actor.holding];
    if (held) {
      held.properties.held = false;
      held.properties.heldBy = "";
    }
    actor.holding = null;
  }
  actor.location = { ...target.location };
  for (const id of actor.carrying) {
    const carried = next.entities[id];
    if (carried) carried.location = { ...actor.location };
  }
  return done(next, reason);
}

export function rememberOne(world: WorldState, entity: string, property: string, value: Scalar): void {
  world.facts = world.facts.filter((fact) => !(fact.attempt === world.attempt && fact.entity === entity && fact.property === property));
  world.facts.push({ entity, property, value, attempt: world.attempt, tick: world.tick });
}

export function tick(world: WorldState): WorldState {
  const next = structuredClone(world);
  next.tick += 1;
  return next;
}
