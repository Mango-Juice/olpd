import type { ActionResult } from "./program";
import { isPublicProperty, resolveActionReferences } from "./conditions.js";
import type { Actor, Entity, PhysicalAction, WorldState } from "./types";

export type ActionValidation =
  | { outcome: "valid"; action: PhysicalAction }
  | { outcome: "clarification"; reason: string };

const MOVEMENT = new Set<PhysicalAction["verb"]>(["move", "jump", "duck"]);
const CONTACT = new Set<PhysicalAction["verb"]>([
  "push", "pull", "place", "take", "release", "open", "close", "turn",
  "tie", "untie", "board", "dismount", "climb", "pour", "hold",
]);

function invalid(reason: string): ActionValidation {
  return { outcome: "clarification", reason };
}

function distance(a: Entity["location"], b: Entity["location"]): number {
  if (a.region !== b.region) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ropeLength(rope: Entity): number {
  const marked = rope.properties.ropeLength;
  return typeof marked === "number" && Number.isFinite(marked) && marked >= 0 ? marked : rope.reach;
}

function reachable(actor: Actor, entity: Entity): boolean {
  return distance(actor.location, entity.location) <= Math.max(1, entity.reach);
}

function slot(entity: Entity): "small" | "large" | null {
  return entity.properties.slot === "small" || entity.properties.slot === "large"
    ? entity.properties.slot
    : null;
}

function capabilityNumber(actor: Actor, names: string[]): number | null {
  for (const capability of actor.capabilities) {
    for (const name of names) {
      const match = capability.match(new RegExp(`^${name}(?::|=)(\\d+(?:\\.\\d+)?)$`));
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function actorCarries(actor: Actor, id: string): boolean {
  return actor.carrying.includes(id);
}

function carriedEntities(world: WorldState, actor: Actor): Entity[] {
  return actor.carrying.flatMap((id) => world.entities[id] && world.entities[id].properties.equipment !== true ? [world.entities[id]] : []);
}

function isDescendant(world: WorldState, possibleDescendant: string, ancestor: string): boolean {
  let cursor: string | null = possibleDescendant;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === ancestor) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = world.entities[cursor]?.parent ?? null;
  }
  return false;
}

function fluidMass(entity: Entity): number {
  const density = entity.properties.fluidDensity;
  const amount = entity.properties.amount;
  return typeof density === "number" && typeof amount === "number" ? Math.max(0, density * amount) : 0;
}
/** Actual mass includes contained objects and explicitly modelled liquid. */
export function entityMass(world: WorldState, id: string, seen = new Set<string>()): number {
  const entity = world.entities[id];
  if (!entity || seen.has(id)) return 0;
  seen.add(id);
  return entity.weight + fluidMass(entity) + Object.values(world.entities)
    .filter((child) => child.parent === id)
    .reduce((sum, child) => sum + entityMass(world, child.id, seen), 0);
}
export function currentLoad(world: WorldState, destinationId: string): number {
  const objectLoad = Object.values(world.entities).filter((entity) => entity.parent === destinationId)
    .reduce((sum, entity) => sum + entityMass(world, entity.id), 0);
  const riderLoad = Object.values(world.actors).filter((actor) => actor.riding === destinationId)
    .reduce((sum, actor) => sum + (capabilityNumber(actor, ["weight"]) ?? 1) + actor.carrying.reduce((mass, id) => mass + entityMass(world, id), 0), 0);
  return objectLoad + riderLoad + (world.entities[destinationId] ? fluidMass(world.entities[destinationId]) : 0);
}

function validateInventory(world: WorldState, actor: Actor, target: Entity): ActionValidation | null {
  const targetSlot = slot(target);
  if (!targetSlot) return invalid(`${target.name}의 공개된 운반 크기를 먼저 확인해 주세요.`);
  const carried = carriedEntities(world, actor);
  const smallCount = carried.filter((entity) => slot(entity) === "small").length;
  const largeCount = carried.filter((entity) => slot(entity) === "large").length;
  if (targetSlot === "large" && (largeCount > 0 || smallCount > 2)) {
    return invalid("큰 물건을 드는 손은 한 칸뿐이에요. 먼저 든 물건을 놓아 주세요.");
  }
  if (targetSlot === "small" && smallCount >= (largeCount === 0 ? 3 : 2)) {
    return invalid("물건 고리 두 칸과 손 한 칸이 모두 찼어요. 무엇을 먼저 놓을지 정해 주세요.");
  }
  if (actor.id === "keeper") {
    if (targetSlot !== "small" || carried.length >= 1) {
      return invalid("등지기는 공개된 작은 물건 하나만 운반할 수 있어요.");
    }
    const maximum = capabilityNumber(actor, ["max-weight", "maxWeight"]);
    if (maximum === null) return invalid("등지기의 공개된 운반 무게 한계를 먼저 확인해 주세요.");
    if (entityMass(world, target.id) > maximum) {
      return invalid(`${target.name}은 등지기의 공개된 운반 무게 한계를 넘어요.`);
    }
  }
  return null;
}

function keeperMovementInvalid(actor: Actor, action: PhysicalAction, target: Entity): string | null {
  if (actor.id !== "keeper") return null;
  if (action.verb === "jump") return "등지기는 점프할 수 없어요.";
  if (action.verb === "climb" && (target.properties.stairs === true || target.properties.ladder === true)) {
    return "등지기는 계단이나 사다리를 오를 수 없어요.";
  }
  if ((MOVEMENT.has(action.verb) || action.verb === "climb") && target.properties.rail !== true) {
    return "등지기는 표시된 톱니 레일 위에서만 이동할 수 있어요.";
  }
  return null;
}

/**
 * Checks interpretation and publicly knowable constraints without mutating the world.
 * A clarification is free; load and stability failures remain executable physics.
 */
export function validateAction(world: WorldState, action: PhysicalAction): ActionValidation {
  const resolution = resolveActionReferences(world, action);
  if (resolution.outcome === "clarification") return resolution;
  action = resolution.action;
  const actor = world.actors[action.actor];
  if (!actor) return invalid(`주체 ${action.actor}을(를) 현재 세계에서 찾을 수 없어요.`);
  const target = world.entities[action.target];
  if (!target) return invalid(`대상 ${action.target}을(를) 현재 세계에서 찾을 수 없어요.`);
  const actuatorStroke = (action.verb === "pull" || action.verb === "push") && target.properties.actuator === true;
  if (actuatorStroke && action.destination !== undefined) return invalid("고정된 장치는 제자리에서 한 번 작동해요. 물건을 옮길 도착지는 필요하지 않아요.");
  if (target.properties.equipment === true && action.verb !== "observe" && action.verb !== "remember" && !MOVEMENT.has(action.verb)) {
    return invalid(`${target.name}은 몸에 매단 여정 물품이에요. 손과 물건 고리를 차지하지 않으며 모험 중에는 내려놓지 않아요.`);
  }
  const destination = action.destination ? world.entities[action.destination] : undefined;
  if (action.destination && !destination) return invalid(`도착 대상 ${action.destination}을(를) 현재 세계에서 찾을 수 없어요.`);
  const instrument = action.instrument ? world.entities[action.instrument] : undefined;
  if (action.instrument && !instrument) return invalid(`도구 ${action.instrument}을(를) 현재 세계에서 찾을 수 없어요.`);
  if (instrument) {
    const owner = owningActor(world, instrument.id);
    if (owner !== null && owner !== actor.id) return invalid(`${instrument.name}은 다른 주체가 들고 있어요.`);
  }
  if (instrument && !actorCarries(actor, instrument.id) && !reachable(actor, instrument)) {
    return invalid(`${instrument.name}은 현재 손이 닿는 범위 밖에 있어요.`);
  }
  if (instrument && action.verb !== "tie" && action.verb !== "untie" && action.verb !== "hold") {
    return invalid(`${instrument.name}을(를) ${action.verb} 행동에 쓰는 공개된 물리 관계가 없어요.`);
  }

  const keeperReason = keeperMovementInvalid(actor, action, target);
  if (keeperReason) return invalid(keeperReason);

  if (action.verb === "observe" || action.verb === "remember") {
    if (!world.visible.includes(target.id)) return invalid(`${target.name}은 지금 실제로 보이지 않아 관찰 사실을 만들 수 없어요.`);
    return { outcome: "valid", action };
  }

  if (MOVEMENT.has(action.verb)) return { outcome: "valid", action };

  const heldOrCarried = actor.holding === target.id || actorCarries(actor, target.id);
  const tongReach = action.verb === "hold" && instrument?.properties.tool === "tongs"
    ? distance(actor.location, target.location) <= instrument.reach
    : false;
  if (CONTACT.has(action.verb) && !heldOrCarried && !reachable(actor, target) && !tongReach) {
    return invalid(`${target.name}은 ${action.actor === "hero" ? "용사" : "등지기"}의 손이 닿는 범위 밖에 있어요.`);
  }

  if ((action.verb === "push" || action.verb === "pull" || action.verb === "take") && !target.movable && !actuatorStroke) {
    return invalid(`${target.name}에는 움직이지 않음 표식이 있어요.`);
  }
  if ((action.verb === "push" || action.verb === "pull") && (target.parent === "hero" || target.parent === "keeper") && target.parent !== actor.id) {
    return invalid(`${target.name}은 다른 주체가 들고 있어요. 먼저 내려놓아야 해요.`);
  }

  if ((action.verb === "push" || action.verb === "pull" || action.verb === "place" || action.verb === "pour" || action.verb === "tie") && !destination && !actuatorStroke) {
    return invalid(`${target.name}을(를) 어디에 둘지 대상을 더 분명히 해 주세요.`);
  }
  if (destination && (action.verb === "push" || action.verb === "pull" || action.verb === "place" || action.verb === "pour" || action.verb === "tie")) {
    if (!reachable(actor, destination)) return invalid(`${destination.name}은 현재 도달 범위 밖에 있어요.`);
    if (target.id === destination.id || isDescendant(world, destination.id, target.id)) {
      return invalid("물건을 자기 자신이나 자기 안의 물건 위에 둘 수 없어요.");
    }
  }
  if (action.verb === "dismount" && destination && distance(target.location, destination.location) > Math.max(target.reach, destination.reach, 1)) {
    return invalid(`${destination.name}은 ${target.name}에서 내릴 수 있는 범위 밖에 있어요.`);
  }

  if (action.verb === "take") {
    if (actorCarries(actor, target.id)) return invalid(`${target.name}은 이미 ${action.actor === "hero" ? "용사" : "등지기"}가 들고 있어요.`);
    if (target.parent === "hero" || target.parent === "keeper") return invalid(`${target.name}은 다른 주체가 들고 있어요.`);
    if (target.properties.recoverable === false) return invalid(`${target.name}에는 돌아오지 않음 표식이 있어 회수할 수 없어요.`);
    const inventory = validateInventory(world, actor, target);
    if (inventory) return inventory;
  }

  if (action.verb === "place" && !actorCarries(actor, target.id)) {
    if (!target.movable) return invalid(`${target.name}에는 움직이지 않음 표식이 있어요.`);
    if (target.parent === "hero" || target.parent === "keeper") return invalid(`${target.name}은 다른 주체가 들고 있어요.`);
    const inventory = validateInventory(world, actor, target);
    if (inventory) return inventory;
  }
  if (action.verb === "release" && !heldOrCarried) {
    return invalid(`${target.name}은 현재 이 주체가 잡거나 운반하고 있지 않아요.`);
  }
  if (action.verb === "hold") {
    if (target.properties.held === true && target.properties.heldBy !== actor.id) return invalid("이 손잡이는 다른 주체가 유지하고 있어요. 먼저 역할을 넘겨 주세요.");
    if (actor.holding && actor.holding !== target.id) return invalid("한 주체가 두 장치를 동시에 잡아 둘 수 없어요.");
    if (target.properties.holdable !== true) return invalid(`${target.name}에는 잡아 유지할 수 있는 손잡이가 보이지 않아요.`);
    if (instrument && instrument.properties.tool !== "tongs") return invalid(`${instrument.name}에는 집게 도구 표식이 없어요.`);
    const effectEntity = target.properties.holdEffectEntity;
    const effectProperty = target.properties.holdEffectProperty;
    if ((effectEntity !== undefined || effectProperty !== undefined) &&
        (typeof effectEntity !== "string" || !world.entities[effectEntity] || typeof effectProperty !== "string" || target.properties.holdEffectValue === undefined)) {
      return invalid(`${target.name}의 공개된 유지 효과 연결이 완전하지 않아요.`);
    }
  }
  if (action.verb === "board" && target.properties.boardable !== true) {
    return invalid(`${target.name}에는 탈 수 있음 표식이 없어요.`);
  }
  if (action.verb === "board" && actor.riding && actor.riding !== target.id) {
    return invalid("다른 물체에 타고 있어 먼저 내려야 해요.");
  }
  if (action.verb === "dismount" && actor.riding !== target.id) {
    return invalid(`${action.actor === "hero" ? "용사" : "등지기"}는 현재 ${target.name}에 타고 있지 않아요.`);
  }
  if (action.verb === "climb" && target.properties.climbable !== true) {
    return invalid(`${target.name}에는 오를 수 있음 표식이 없어요.`);
  }
  if ((action.verb === "open" || action.verb === "close") && typeof target.properties.open !== "boolean") {
    return invalid(`${target.name}에는 열고 닫을 수 있는 상태가 보이지 않아요.`);
  }
  if (action.verb === "turn" && typeof target.properties.orientation !== "number" && typeof target.properties.on !== "boolean") {
    return invalid(`${target.name}에는 돌릴 수 있는 상태가 보이지 않아요.`);
  }
  if (action.verb === "tie") {
    if (!instrument) return invalid("두 대상을 어떤 밧줄로 묶을지 분명히 해 주세요.");
    if (instrument.properties.tool !== "rope") return invalid(`${instrument.name}에는 밧줄 도구 표식이 없어요.`);
    if (!destination || target.properties.tiePoint !== true || destination.properties.tiePoint !== true) {
      return invalid("두 대상 모두에 공개된 묶는 지점이 필요해요.");
    }
    const targetOwner = owningActor(world, target.id);
    const destinationOwner = owningActor(world, destination.id);
    if ((targetOwner !== null && targetOwner !== actor.id) || (destinationOwner !== null && destinationOwner !== actor.id)) {
      return invalid("다른 주체가 들고 있는 물건은 허락 없이 밧줄 연결을 바꿀 수 없어요.");
    }
    if (distance(target.location, destination.location) > ropeLength(instrument)) {
      return invalid(`${instrument.name}의 공개 길이가 두 묶는 지점 사이 거리에 닿지 않아요.`);
    }
    if (typeof target.properties.tiedTo === "string" || typeof destination.properties.tiedTo === "string") {
      return invalid("이미 묶인 지점이 있어 어느 연결을 바꿀지 분명히 해 주세요.");
    }
  }
  if (action.verb === "untie") {
    const tiedTo = target.properties.tiedTo;
    const tiedWith = target.properties.tiedWith;
    if (typeof tiedTo !== "string" || typeof tiedWith !== "string") return invalid(`${target.name}은 현재 다른 대상과 묶여 있지 않아요.`);
    if (destination && destination.id !== tiedTo) return invalid(`${target.name}은 ${destination.name}과(와) 묶여 있지 않아요.`);
    if (instrument && (instrument.properties.tool !== "rope" || instrument.id !== tiedWith)) {
      return invalid(`${instrument.name}은 이 연결에 쓰인 밧줄이 아니에요.`);
    }
  }
  if (action.verb === "pour") {
    if (typeof target.properties.amount !== "number" || !destination || typeof destination.properties.amount !== "number") {
      return invalid("붓기에는 양이 보이는 용기와 도착 용기가 필요해요.");
    }
    if (action.amount !== undefined && action.amount > target.properties.amount) {
      return invalid(`${target.name}에는 요청한 양 ${action.amount}보다 적은 ${target.properties.amount}만큼만 들어 있어요.`);
    }
  }
  return { outcome: "valid", action };
}

function applyHoldingEffect(world: WorldState, device: Entity, holding: boolean): void {
  device.properties.held = holding;
  device.properties.heldBy = holding ? String(device.properties.heldBy || "") : "";
  if (!holding) device.properties.heldWith = "";
  const effectTarget = device.properties.holdEffectEntity;
  const effectProperty = device.properties.holdEffectProperty;
  const effectValue = holding ? device.properties.holdEffectValue : device.properties.releaseEffectValue;
  if (typeof effectTarget === "string" && typeof effectProperty === "string" && effectValue !== undefined) {
    const affected = world.entities[effectTarget];
    if (affected) affected.properties[effectProperty] = effectValue;
  }
}

function stopHolding(world: WorldState, actor: Actor): void {
  if (!actor.holding) return;
  const device = world.entities[actor.holding];
  if (device) applyHoldingEffect(world, device, false);
  actor.holding = null;
}

interface MotionResult { ok: boolean; reason?: string }
interface MotionContext { visited: Set<string>; coMovingActor: string | null }

function owningActor(world: WorldState, entityId: string): string | null {
  let parent = world.entities[entityId]?.parent ?? null;
  const visited = new Set<string>();
  while (parent) {
    if (world.actors[parent]) return parent;
    if (visited.has(parent)) return null;
    visited.add(parent);
    parent = world.entities[parent]?.parent ?? null;
  }
  return null;
}

function pointAtRopeLength(origin: Entity["location"], previousPeer: Entity["location"], length: number): Entity["location"] {
  const dx = previousPeer.x - origin.x;
  const dy = previousPeer.y - origin.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude === 0) return { ...origin };
  return { region: origin.region, x: origin.x + dx / magnitude * length, y: origin.y + dy / magnitude * length };
}

/** Move an entity hierarchy while treating a rope as a length constraint, not a weld. */
function moveTree(
  world: WorldState,
  parentId: string,
  location: Entity["location"],
  context: MotionContext = { visited: new Set<string>(), coMovingActor: null },
): MotionResult {
  if (context.visited.has(parentId)) return { ok: true };
  const parent = world.entities[parentId];
  if (!parent) return { ok: true };

  const tiedId = typeof parent.properties.tiedTo === "string" ? parent.properties.tiedTo : null;
  const peer = tiedId ? world.entities[tiedId] : undefined;
  let pulledLocation: Entity["location"] | null = null;
  if (peer) {
    const ropeId = typeof parent.properties.tiedWith === "string" ? parent.properties.tiedWith : null;
    const rope = ropeId ? world.entities[ropeId] : undefined;
    if (!rope || rope.properties.tool !== "rope") {
      return { ok: false, reason: `${parent.name}의 밧줄 연결 상태를 공개된 도구에서 확인할 수 없어요.` };
    }
    const length = ropeLength(rope);
    if (location.region !== peer.location.region) {
      return { ok: false, reason: `${rope.name}은 서로 다른 구역까지 이어지지 않아요.` };
    }
    if (distance(location, peer.location) > length) {
      const owner = owningActor(world, peer.id);
      const coMoves = owner !== null && owner === context.coMovingActor;
      if (peer.properties.fixed === true || !peer.movable) {
        return { ok: false, reason: `${peer.name}은 고정되어 있어 ${rope.name}의 길이 밖으로 옮길 수 없어요.` };
      }
      if (owner !== null && !coMoves) {
        return { ok: false, reason: `${peer.name}은 다른 주체가 들고 있어 밧줄로 끌어갈 수 없어요.` };
      }
      pulledLocation = coMoves ? { ...location } : pointAtRopeLength(location, peer.location, length);
    }
  }

  context.visited.add(parentId);
  parent.location = { ...location };
  for (const rider of Object.values(world.actors)) {
    if (rider.riding !== parentId) continue;
    rider.location = { ...location };
    const riderContext: MotionContext = { visited: context.visited, coMovingActor: rider.id };
    for (const carried of rider.carrying) {
      const moved = moveTree(world, carried, location, riderContext);
      if (!moved.ok) return moved;
    }
  }
  for (const child of Object.values(world.entities)) {
    if (child.parent !== parentId) continue;
    const moved = moveTree(world, child.id, location, context);
    if (!moved.ok) return moved;
  }
  if (peer && pulledLocation) {
    const owner = owningActor(world, peer.id);
    if (peer.parent && owner === null && peer.parent !== parentId) peer.parent = null;
    const moved = moveTree(world, peer.id, pulledLocation, context);
    if (!moved.ok) return moved;
  }
  return { ok: true };
}

function moveActor(world: WorldState, actor: Actor, location: Entity["location"]): MotionResult {
  stopHolding(world, actor);
  actor.location = { ...location };
  const context: MotionContext = { visited: new Set<string>(), coMovingActor: actor.id };
  for (const carried of actor.carrying) {
    const moved = moveTree(world, carried, location, context);
    if (!moved.ok) return moved;
  }
  return { ok: true };
}

function rememberVisibleProperties(world: WorldState, target: Entity): void {
  for (const [property, value] of Object.entries(target.properties)) {
    if (!isPublicProperty(property)) continue;
    world.facts.push({ entity: target.id, property, value, attempt: world.attempt, tick: world.tick });
  }
}

function overload(world: WorldState, destination: Entity, reason: string): ActionResult {
  destination.properties.overloaded = true;
  destination.properties.tipped = true;
  return { world, outcome: "failure", reason };
}

function blockedMotion(world: WorldState, motion: MotionResult): ActionResult | null {
  return motion.ok ? null : { world, outcome: "clarification", reason: motion.reason ?? "밧줄의 공개 길이 때문에 그 위치로 옮길 수 없어요." };
}

/** Deterministic physical mutation. Impossible instructions remain free clarification. */
export function executePhysicalAction(world: WorldState, action: PhysicalAction, options: { movementStep?: number } = {}): ActionResult {
  const validation = validateAction(world, action);
  if (validation.outcome === "clarification") return { world, outcome: "clarification", reason: validation.reason };
  action = validation.action;

  const next = structuredClone(world);
  const actor = next.actors[action.actor];
  const target = next.entities[action.target];
  const destination = action.destination ? next.entities[action.destination] : undefined;
  const instrument = action.instrument ? next.entities[action.instrument] : undefined;

  if ((action.verb === "pull" || action.verb === "push") && target.properties.actuator === true) {
    const strokes = target.properties.strokes;
    target.properties.strokes = (typeof strokes === "number" ? strokes : 0) + 1;
    return { world: next, outcome: "done", reason: `${target.name}을(를) 제자리에서 한 번 ${action.verb === "push" ? "눌렀어요" : "당겼어요"}.` };
  }

  if (MOVEMENT.has(action.verb)) {
    let location = target.location;
    let inTransit = false;
    if (options.movementStep !== undefined) {
      const step = options.movementStep;
      if (!Number.isFinite(step) || step <= 0) throw new Error("movementStep must be finite and positive");
      if (actor.location.region !== target.location.region) return { world, outcome: "clarification", reason: "다른 방의 대상까지 이어진 이동 경로가 없어요." };
      const dx = target.location.x - actor.location.x;
      const dy = target.location.y - actor.location.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining > step) {
        location = { region: actor.location.region, x: actor.location.x + dx / remaining * step, y: actor.location.y + dy / remaining * step };
        inTransit = true;
      }
    }
    const actorMotion = blockedMotion(world, moveActor(next, actor, location));
    if (actorMotion) return actorMotion;
    if (actor.riding) {
      const ridingMotion = blockedMotion(world, moveTree(next, actor.riding, location));
      if (ridingMotion) return ridingMotion;
    }
    return { world: next, outcome: inTransit ? "progress" : "done", reason: inTransit ? `${target.name} 쪽으로 한 걸음 이동했어요.` : `${actor.id === "hero" ? "용사가" : "등지기가"} ${target.name} 위치로 이동했어요.` };
  }

  switch (action.verb) {
    case "observe":
    case "remember":
      rememberVisibleProperties(next, target);
      return { world: next, outcome: "done", reason: `${target.name}에서 실제로 보이는 상태를 현재 시도에 기록했어요.` };
    case "take": {
      if (target.parent && next.entities[target.parent]) target.parent = null;
      target.parent = actor.id;
      const motion = blockedMotion(world, moveTree(next, target.id, actor.location, { visited: new Set<string>(), coMovingActor: actor.id }));
      if (motion) return motion;
      actor.carrying.push(target.id);
      return { world: next, outcome: "done", reason: `${target.name}을(를) 챙겼어요.` };
    }
    case "release":
      if (actor.holding === target.id) stopHolding(next, actor);
      if (actorCarries(actor, target.id)) {
        actor.carrying = actor.carrying.filter((id) => id !== target.id);
        target.parent = null;
        const motion = blockedMotion(world, moveTree(next, target.id, actor.location));
        if (motion) return motion;
      }
      return { world: next, outcome: "done", reason: `${target.name}을(를) 놓았어요.` };
    case "place": {
      actor.carrying = actor.carrying.filter((id) => id !== target.id);
      target.parent = destination!.id;
      const motion = blockedMotion(world, moveTree(next, target.id, destination!.location));
      if (motion) return motion;
      const load = currentLoad(next, destination!.id);
      if (load > destination!.capacity) {
        return overload(next, destination!, `${destination!.name}의 하중 ${load}이(가) 공개 용량 ${destination!.capacity}을(를) 넘어 기울었어요.`);
      }
      return { world: next, outcome: "done", reason: `${target.name}을(를) ${destination!.name}에 놓았어요.` };
    }
    case "push":
    case "pull":
      actor.carrying = actor.carrying.filter((id) => id !== target.id);
      target.parent = null;
      const motion = blockedMotion(world, moveTree(next, target.id, destination!.location));
      if (motion) return motion;
      return { world: next, outcome: "done", reason: `${target.name}을(를) ${destination!.name} 위치로 옮겼어요.` };
    case "hold":
      actor.holding = target.id;
      target.properties.heldBy = actor.id;
      if (instrument) target.properties.heldWith = instrument.id;
      applyHoldingEffect(next, target, true);
      return { world: next, outcome: "done", reason: `${target.name}을(를) 잡아 유지해요.` };
    case "board": {
      const motion = blockedMotion(world, moveActor(next, actor, target.location));
      if (motion) return motion;
      actor.riding = target.id;
      const load = currentLoad(next, target.id);
      if (load > target.capacity) return overload(next, target, `${target.name}의 적재 하중 ${load}이(가) 용량 ${target.capacity}을(를) 넘어 기울었어요.`);
      return { world: next, outcome: "done", reason: `${target.name}에 탔어요.` };
    }
    case "dismount":
      actor.riding = null;
      if (destination) {
        const motion = blockedMotion(world, moveActor(next, actor, destination.location));
        if (motion) return motion;
      }
      return { world: next, outcome: "done", reason: `${target.name}에서 내렸어요.` };
    case "climb": {
      const addedLoad = actor.riding === target.id ? 0 : (capabilityNumber(actor, ["weight"]) ?? 1) + actor.carrying.reduce((sum, id) => sum + entityMass(next, id), 0);
      if (currentLoad(next, target.id) + addedLoad > target.capacity || target.properties.stable === false) {
        target.properties.tipped = true;
        return { world: next, outcome: "failure", reason: `${target.name}이(가) 하중을 버티지 못해 기울었어요.` };
      }
      const motion = blockedMotion(world, moveActor(next, actor, target.location));
      if (motion) return motion;
      actor.riding = target.id;
      return { world: next, outcome: "done", reason: `${target.name} 위에 올랐어요.` };
    }
    case "open":
      target.properties.open = true;
      return { world: next, outcome: "done", reason: `${target.name}을(를) 열었어요.` };
    case "close":
      target.properties.open = false;
      return { world: next, outcome: "done", reason: `${target.name}을(를) 닫았어요.` };
    case "turn":
      if (typeof target.properties.orientation === "number") target.properties.orientation += action.amount ?? 1;
      else target.properties.on = !target.properties.on;
      return { world: next, outcome: "done", reason: `${target.name}을(를) 돌렸어요.` };
    case "tie":
      target.properties.tiedTo = destination!.id;
      target.properties.tiedWith = instrument!.id;
      destination!.properties.tiedTo = target.id;
      destination!.properties.tiedWith = instrument!.id;
      instrument!.properties.connects = [target.id, destination!.id].sort().join("|");
      actor.carrying = actor.carrying.filter((id) => id !== instrument!.id);
      instrument!.parent = target.id;
      instrument!.location = { ...target.location };
      return { world: next, outcome: "done", reason: `${instrument!.name}(으)로 ${target.name}과(와) ${destination!.name}을(를) 묶었어요.` };
    case "untie": {
      const tiedTo = String(target.properties.tiedTo);
      const ropeId = String(target.properties.tiedWith);
      const peer = next.entities[tiedTo];
      const rope = next.entities[ropeId];
      delete target.properties.tiedTo;
      delete target.properties.tiedWith;
      if (peer?.properties.tiedTo === target.id) {
        delete peer.properties.tiedTo;
        delete peer.properties.tiedWith;
      }
      if (rope) {
        delete rope.properties.connects;
        rope.parent = null;
        rope.location = { ...actor.location };
      }
      return { world: next, outcome: "done", reason: `${target.name}의 밧줄 연결을 풀었어요.` };
    }
    case "pour": {
      const requested = action.amount ?? Number(target.properties.amount);
      const available = Number(target.properties.amount);
      const free = destination!.capacity - Number(destination!.properties.amount);
      const transferred = Math.max(0, Math.min(requested, available, free));
      target.properties.amount = available - transferred;
      destination!.properties.amount = Number(destination!.properties.amount) + transferred;
      if (requested > free) return overload(next, destination!, `${destination!.name}의 눈금 ${destination!.capacity}을(를) 넘어 물이 쏟아졌어요.`);
      return { world: next, outcome: "done", reason: `${transferred}만큼 ${destination!.name}에 부었어요.` };
    }
    default:
      return { world, outcome: "blocked", reason: `${action.verb} 행동은 공개된 물리 규칙으로 실행할 수 없어요.` };
  }
}
