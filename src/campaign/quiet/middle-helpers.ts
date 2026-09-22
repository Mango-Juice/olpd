import { makeEntity, makeHero, makeWorld, stillWorld, type SegmentDefinition } from "../level";
import { resolveActionReferences } from "../conditions";
import type { ActionResult } from "../program";
import type { Actor, Entity, PhysicalAction, Scalar, StageId, WorldState } from "../types";

export const quietEntity = (
  id: string,
  name: string,
  region: string,
  x: number,
  y: number,
  properties: Record<string, Scalar>,
  patch: Partial<Entity> = {},
): Entity => makeEntity(id, name, region, x, {
  description: name,
  location: { region, x, y },
  properties: { kind: "object", ...properties },
  ...patch,
});

export function quietWorld(
  stageId: StageId,
  segmentId: string,
  entities: Entity[],
  options: { hero?: Partial<Actor>; keeper?: Partial<Actor> } = {},
): WorldState {
  const hero = { ...makeHero(segmentId), ...options.hero };
  const state = makeWorld(stageId, segmentId, entities, hero);
  if (options.keeper) {
    state.actors.keeper = {
      id: "keeper",
      location: { region: segmentId, x: 0, y: 0 },
      holding: null,
      carrying: [],
      riding: null,
      capabilities: ["weight:2", "rail-only"],
      ...options.keeper,
    };
  }
  state.visible = entities.map((entity) => entity.id);
  return state;
}

export const quietAdvance: SegmentDefinition["advance"] = (world) => stillWorld(world);

export function resolvedAction(world: WorldState, action: PhysicalAction): PhysicalAction | ActionResult {
  const resolved = resolveActionReferences(world, action);
  return resolved.outcome === "valid"
    ? resolved.action
    : { world, outcome: "clarification", reason: resolved.reason };
}

export const quietResult = (
  world: WorldState,
  outcome: ActionResult["outcome"],
  reason: string,
): ActionResult => ({ world, outcome, reason });

export const quietBlocked = (world: WorldState, reason: string): ActionResult => quietResult(world, "blocked", reason);
export const quietFailure = (world: WorldState, reason: string): ActionResult => quietResult(world, "failure", reason);
export const quietClarification = (world: WorldState, reason: string): ActionResult => quietResult(world, "clarification", reason);

export function moveEntityTree(world: WorldState, id: string, location: Entity["location"], seen = new Set<string>()): void {
  if (seen.has(id)) return;
  seen.add(id);
  const entity = world.entities[id];
  if (!entity) return;
  entity.location = { ...location };
  for (const child of Object.values(world.entities)) {
    if (child.parent === id) moveEntityTree(world, child.id, location, seen);
  }
}

export function moveQuietActor(world: WorldState, actorId: "hero" | "keeper", location: Entity["location"]): void {
  const actor = world.actors[actorId];
  actor.location = { ...location };
  for (const id of actor.carrying) moveEntityTree(world, id, location);
}

export function takeQuietItem(world: WorldState, actorId: "hero" | "keeper", itemId: string): ActionResult | null {
  const actor = world.actors[actorId];
  const item = world.entities[itemId];
  if (!actor || !item) return quietClarification(world, "주체나 물건을 찾을 수 없어요.");
  if (!item.movable) return quietClarification(world, `${item.name}은 움직일 수 없어요.`);
  if ((item.parent === "hero" || item.parent === "keeper") && item.parent !== actorId) {
    return quietBlocked(world, `${item.name}은 다른 주체가 들고 있어요.`);
  }
  if (item.parent === actorId) return quietClarification(world, `${item.name}은 이미 들고 있어요.`);
  if (actor.location.region !== item.location.region || actor.location.x !== item.location.x || actor.location.y !== item.location.y) {
    return quietBlocked(world, `${item.name} 곁까지 안전하게 이동한 뒤 챙겨야 해요.`);
  }
  const next = structuredClone(world);
  const nextActor = next.actors[actorId];
  const nextItem = next.entities[itemId];
  nextItem.parent = actorId;
  nextActor.carrying = [...nextActor.carrying.filter((id) => id !== itemId), itemId];
  moveEntityTree(next, itemId, nextActor.location);
  return quietResult(next, "done", `${nextItem.name}을(를) 챙겼어요.`);
}

export function placeQuietItem(world: WorldState, actorId: "hero" | "keeper", itemId: string, destinationId: string): ActionResult {
  const actor = world.actors[actorId];
  const item = world.entities[itemId];
  const destination = world.entities[destinationId];
  if (!actor || !item || !destination) return quietClarification(world, "물건과 놓을 곳을 함께 지정해 주세요.");
  if (item.parent !== actorId || !actor.carrying.includes(itemId)) return quietBlocked(world, `${item.name}을(를) 먼저 챙겨야 해요.`);
  if (actor.location.region !== destination.location.region || actor.location.x !== destination.location.x || actor.location.y !== destination.location.y) {
    return quietBlocked(world, `${destination.name} 곁까지 안전하게 이동한 뒤 놓아야 해요.`);
  }
  const next = structuredClone(world);
  next.actors[actorId].carrying = next.actors[actorId].carrying.filter((id) => id !== itemId);
  next.entities[itemId].parent = destinationId;
  moveEntityTree(next, itemId, next.entities[destinationId].location);
  return quietResult(next, "done", `${next.entities[itemId].name}을(를) ${next.entities[destinationId].name}에 두었어요.`);
}

export function releaseQuietHold(world: WorldState, actorId: "hero" | "keeper"): void {
  const actor = world.actors[actorId];
  if (!actor?.holding) return;
  const target = world.entities[actor.holding];
  if (target?.properties.heldBy === actorId) {
    target.properties.held = false;
    target.properties.heldBy = "";
  }
  actor.holding = null;
}

export const movementVerb = (verb: PhysicalAction["verb"]): boolean =>
  verb === "move" || verb === "jump" || verb === "duck" || verb === "climb";

export const crossesX = (from: number, to: number, x: number): boolean =>
  Math.min(from, to) < x && Math.max(from, to) >= x;

export const atEntity = (world: WorldState, actorId: "hero" | "keeper", entityId: string): boolean => {
  const actor = world.actors[actorId];
  const entity = world.entities[entityId];
  return !!actor && !!entity && actor.location.region === entity.location.region
    && actor.location.x === entity.location.x && actor.location.y === entity.location.y;
};

export const descriptionsAreNames = (entities: readonly Entity[]): string => entities.map((entity) => entity.name).join(" · ");
