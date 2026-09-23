import { makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from '../level.js';
import type { ActionResult } from '../program';
import type { EnvironmentStep } from '../run';
import type { Actor, Entity, PhysicalAction, WorldState } from '../types';
import type { ContactKind, SpatialBody, SpatialChapterDefinition, SpatialCondition, SpatialInteraction, SpatialMotion, SpatialSceneDefinition, SpatialSurface } from './types';

const EPS = 0.001;
const RADIUS = 0.28;
const HERO_HEIGHT = 1;
const WALK_STEP = 0.7;
const JUMP_RANGE = 2.6;
const JUMP_HEIGHT = 1.2;
const SAMPLE = 0.04;

type Point = { x: number; y: number; z?: number; t: number };
type Hit = { kind: ContactKind; x: number; y: number; z?: number; entity?: string; surface?: 'ceiling'; held?: string };
const depthOf = (location: { z?: number }): number => location.z ?? 0;
const actorHeight = (actor: Actor, duck = false): number => actor.id === 'keeper' ? 0.45 : duck ? 0.6 : HERO_HEIGHT;
const actorRadius = (actor: Actor): number => actor.id === 'keeper' ? 0.2 : RADIUS;
function result(world: WorldState, outcome: ActionResult['outcome'], reason: string, motion?: SpatialMotion): ActionResult {
  return motion ? { world, outcome, reason, motion } : { world, outcome, reason };
}
function position(world: WorldState, id: string): { x: number; y: number; z?: number; region: string } | null {
  return world.actors[id]?.location ?? world.entities[id]?.location ?? null;
}
export function spatialCondition(world: WorldState, condition: SpatialCondition): boolean {
  switch (condition.kind) {
    case 'property': return world.entities[condition.entity]?.properties[condition.property] === condition.value;
    case 'near': {
      const a = position(world, condition.entity), b = position(world, condition.target);
      return !!a && !!b && a.region === b.region && Math.hypot(a.x - b.x, a.y - b.y, depthOf(a) - depthOf(b)) <= (condition.distance ?? 0.65) + EPS;
    }
    case 'at': {
      const at = position(world, condition.entity);
      return !!at && Math.hypot(at.x - condition.x, at.y - condition.y, condition.z === undefined ? 0 : depthOf(at) - condition.z) <= (condition.distance ?? 0.35) + EPS;
    }
    case 'parent': return world.entities[condition.entity]?.parent === condition.parent;
    case 'holding': return world.actors[condition.actor]?.holding === condition.entity;
    case 'carrying': return world.actors[condition.actor]?.carrying.includes(condition.entity) ?? false;
    case 'all': return condition.conditions.every((item) => spatialCondition(world, item));
    case 'any': return condition.conditions.some((item) => spatialCondition(world, item));
    case 'not': return !spatialCondition(world, condition.condition);
  }
}
function active(world: WorldState, body: SpatialBody): boolean {
  return !body.active || spatialCondition(world, body.active);
}
function floorY(surface: SpatialSurface, x: number): number {
  const ratio = (x - surface.from) / (surface.to - surface.from || 1);
  return surface.y + ((surface.endY ?? surface.y) - surface.y) * ratio;
}
function conditionReferences(condition: SpatialCondition, entity: string): boolean {
  switch (condition.kind) {
    case 'property': case 'at': case 'parent': case 'holding': case 'carrying': return condition.entity === entity;
    case 'near': return condition.entity === entity || condition.target === entity;
    case 'all': case 'any': return condition.conditions.some((item) => conditionReferences(item, entity));
    case 'not': return conditionReferences(condition.condition, entity);
  }
}
function supportingFloor(world: WorldState, scene: SpatialSceneDefinition, x: number, z: number, feetY: number, maxDrop = 0.16, ignored?: string): number | null {
  const floors = scene.surfaces.filter((surface) => x >= surface.from - EPS && x <= surface.to + EPS
    && Math.abs(z - (surface.z ?? 0)) <= (surface.depth ?? 1.2) / 2 + EPS
    && !(ignored && surface.enabled && conditionReferences(surface.enabled, ignored))
    && (!surface.enabled || spatialCondition(world, surface.enabled)))
    .map((surface) => floorY(surface, x)).filter((y) => y <= feetY + 0.18 && y >= feetY - maxDrop);
  for (const body of scene.bodies) {
    if (!body.support || body.entity === ignored || !active(world, body)) continue;
    const entity = world.entities[body.entity];
    if (!entity || entity.parent === 'hero' || entity.parent === 'keeper') continue;
    const left = entity.location.x + (body.offsetX ?? 0) - body.width / 2;
    const right = left + body.width;
    const top = entity.location.y + (body.offsetY ?? 0) + body.height;
    if (Math.abs(z - depthOf(entity.location)) <= (body.depth ?? 0.8) / 2 + RADIUS
      && x + RADIUS > left + EPS && x - RADIUS < right - EPS && top <= feetY + 0.18 && top >= feetY - maxDrop) floors.push(top);
  }
  return floors.length ? Math.max(...floors) : null;
}
function hitBody(world: WorldState, scene: SpatialSceneDefinition, actor: Actor, x: number, y: number, z: number, ignored?: string, duck = false): Hit | null {
  const height = actorHeight(actor, duck), radius = actorRadius(actor);
  const inverted = actor.capabilities.includes('gravity:up');
  if (scene.ceiling !== undefined && (inverted ? y > scene.ceiling + EPS : y + height > scene.ceiling + EPS)) return { kind: 'solid', x, y: scene.ceiling - (inverted ? 0 : height), z, surface: 'ceiling' };
  for (const body of scene.bodies) {
    if (body.entity === ignored || !active(world, body)) continue;
    const entity = world.entities[body.entity];
    if (!entity || entity.parent === 'hero' || entity.parent === 'keeper') continue;
    const left = entity.location.x + (body.offsetX ?? 0) - body.width / 2;
    const bottom = entity.location.y + (body.offsetY ?? 0);
    // Standing on a support touches only its top edge, which is not a collision.
    if (Math.abs(z - depthOf(entity.location)) < (body.depth ?? 0.8) / 2 + radius - EPS
      && x + radius > left + EPS && x - radius < left + body.width - EPS
      && (inverted ? y > bottom + EPS && y - height < bottom + body.height - EPS : y + height > bottom + EPS && y < bottom + body.height - EPS)) {
      return { kind: body.kind, x, y, z, entity: body.entity };
    }
  }
  return null;
}
function moveCarried(world: WorldState, actor: Actor): void {
  for (const id of actor.carrying) {
    const item = world.entities[id];
    if (item) item.location = { ...actor.location };
  }
}
function setActor(world: WorldState, actor: Actor, x: number, y: number, z = depthOf(actor.location)): void {
  actor.location = { ...actor.location, x, y, z };
  moveCarried(world, actor);
}
function motion(actor: Actor, kind: SpatialMotion['kind'], points: Point[], target?: string, hit?: Hit): SpatialMotion {
  return { actor: actor.id, kind: hit?.held ? kind : hit?.kind ?? kind, target,
    points, ...(hit?.held ? { issue: 'out-of-reach' as const } : {}),
    ...(hit && !hit.held ? { contact: { x: hit.x, y: hit.y, ...(hit.entity ? { entity: hit.entity } : {}), ...(hit.surface ? { surface: hit.surface } : {}) } } : {}) };
}
function heldReachHit(world: WorldState, scene: SpatialSceneDefinition, actor: Actor, x: number, y: number, z: number): Hit | null {
  if (!actor.holding) return null;
  const held = world.entities[actor.holding];
  const entry = scene.interactions?.find((item) => item.entity === held?.id);
  // Joint movable objects can travel with their holders; handles and doors stay fixed.
  if (!held || (entry?.kind !== 'handle' && entry?.kind !== 'door')) return null;
  const body = scene.bodies.find((item) => item.entity === held.id);
  const reach = Math.max(0.48, body ? body.width / 2 + actorRadius(actor) + 0.03 : 0.48, held.reach * 0.6);
  return Math.hypot(x - held.location.x, z - depthOf(held.location)) <= reach + EPS
    && Math.abs(y - held.location.y) <= 1.3 + EPS
    ? null : { kind: 'solid', x, y, z, held: held.id };
}
function sweptWalk(world: WorldState, scene: SpatialSceneDefinition, actor: Actor, targetX: number, targetZ = depthOf(actor.location), ignored?: string, duck = false): { points: Point[]; hit?: Hit; reached: boolean } {
  const start = { x: actor.location.x, y: actor.location.y, z: depthOf(actor.location), t: 0 };
  const points = [start];
  const distance = targetX - start.x, depth = targetZ - start.z;
  const count = Math.max(1, Math.ceil(Math.hypot(distance, depth) / SAMPLE));
  for (let i = 1; i <= count; i++) {
    const x = start.x + distance * i / count;
    const z = start.z + depth * i / count;
    const previous = points[points.length - 1];
    const y = supportingFloor(world, scene, x, z, previous.y);
    if (y === null) {
      const hazard = hitBody(world, scene, actor, x, previous.y - 0.05, z, ignored, duck);
      if (hazard && hazard.kind !== 'solid') {
        const contact = { ...hazard, x, y: previous.y - 0.05, z };
        points.push({ x, y: contact.y, z, t: i / count });
        setActor(world, actor, x, contact.y, z);
        return { points, hit: contact, reached: false };
      }
      const fall = { kind: 'fall' as const, x, y: previous.y, z };
      points.push({ x, y: previous.y - 0.3, z, t: i / count });
      setActor(world, actor, x, previous.y - 0.3, z);
      return { points, hit: fall, reached: false };
    }
    // Slopes are traversable only where a step changes feet height gently.
    if (Math.abs(y - previous.y) > 0.18) return { points, hit: { kind: 'solid', x: previous.x, y: previous.y }, reached: false };
    const heldHit = heldReachHit(world, scene, actor, x, y, z);
    if (heldHit) {
      setActor(world, actor, previous.x, previous.y, previous.z);
      return { points, hit: { ...heldHit, x: previous.x, y: previous.y, z: previous.z }, reached: false };
    }
    for (const entry of scene.interactions ?? []) if (entry.kind === 'gravity') {
      const arch = world.entities[entry.entity];
      if (arch && Math.hypot(x - arch.location.x, y - arch.location.y, z - depthOf(arch.location)) <= 0.7) {
        actor.capabilities = actor.capabilities.filter((item) => !item.startsWith('gravity:')).concat(`gravity:${entry.gravity}`);
      }
    }
    const hit = hitBody(world, scene, actor, x, y, z, ignored, duck);
    if (hit) {
      setActor(world, actor, previous.x, previous.y, previous.z);
      if (hit.kind === 'wind') {
        const pushed = sweptWalk(world, scene, actor, Math.max(0, previous.x - 1.2), previous.z, hit.entity, duck);
        const trace = [...points, ...pushed.points.slice(1).map((point) => ({ ...point, t: i / count + point.t * (1 - i / count) }))];
        return { points: trace, hit: pushed.hit ?? { ...hit, x, y, z }, reached: false };
      }
      return { points, hit: { ...hit, x: previous.x, y: previous.y, z: previous.z }, reached: false };
    }
    points.push({ x, y, z, t: i / count });
  }
  const end = points[points.length - 1];
  setActor(world, actor, end.x, end.y, end.z);
  return { points, reached: true };
}
function jumpArc(world: WorldState, scene: SpatialSceneDefinition, actor: Actor, landingX: number, landingZ = depthOf(actor.location), ignored?: string): { points: Point[]; hit?: Hit; reached: boolean } {
  const start = { x: actor.location.x, y: actor.location.y, z: depthOf(actor.location), t: 0 };
  const points = [start];
  const length = Math.abs(landingX - start.x);
  const count = Math.max(12, Math.ceil(length / SAMPLE));
  const inverted = actor.capabilities.includes('gravity:up');
  const support = supportingFloor(world, scene, landingX, landingZ, start.y + (inverted ? 0 : JUMP_HEIGHT), 2 * JUMP_HEIGHT + 0.3);
  const landing = support !== null && Math.abs(support - start.y) <= JUMP_HEIGHT + EPS ? support : null;
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const x = start.x + (landingX - start.x) * t;
    const z = start.z + (landingZ - start.z) * t;
    const y = start.y + ((landing ?? start.y) - start.y) * t + (inverted ? -1 : 1) * 4 * JUMP_HEIGHT * t * (1 - t);
    const previous = points[points.length - 1];
    const heldHit = heldReachHit(world, scene, actor, x, y, z);
    if (heldHit) {
      setActor(world, actor, previous.x, previous.y, previous.z);
      return { points, hit: { ...heldHit, x: previous.x, y: previous.y, z: previous.z }, reached: false };
    }
    const hit = hitBody(world, scene, actor, x, y, z, ignored);
    if (hit) {
      let low = 0, high = 1;
      for (let attempt = 0; attempt < 10; attempt++) {
        const fraction = (low + high) / 2;
        const trialX = previous.x + (x - previous.x) * fraction;
        const trialY = previous.y + (y - previous.y) * fraction;
        const trialZ = (previous.z ?? 0) + (z - (previous.z ?? 0)) * fraction;
        if (hitBody(world, scene, actor, trialX, trialY, trialZ, ignored)) high = fraction;
        else low = fraction;
      }
      const contact = { x: previous.x + (x - previous.x) * low, y: previous.y + (y - previous.y) * low,
        z: (previous.z ?? 0) + (z - (previous.z ?? 0)) * low, t: previous.t + (t - previous.t) * low };
      points.push(contact);
      setActor(world, actor, contact.x, contact.y, contact.z);
      return { points, hit: { ...hit, x: contact.x, y: contact.y, z: contact.z }, reached: false };
    }
    points.push({ x, y, z, t });
  }
  if (landing === null) {
    const fallY = start.y + (inverted ? 0.5 : -0.5);
    points.push({ x: landingX, y: fallY, z: landingZ, t: 1.1 });
    setActor(world, actor, landingX, fallY, landingZ);
    return { points, hit: { kind: 'fall', x: landingX, y: start.y, z: landingZ }, reached: false };
  }
  setActor(world, actor, landingX, landing, landingZ);
  return { points, reached: true };
}
function sceneFor(world: WorldState, chapter: SpatialChapterDefinition): SpatialSceneDefinition | undefined {
  return chapter.scenes.find((scene) => scene.id === world.segmentId);
}
function applyRules(world: WorldState, scene: SpatialSceneDefinition): void {
  const source = structuredClone(world);
  for (const [index, rule] of (scene.rules ?? []).entries()) {
    const matched = spatialCondition(source, rule.when);
    const owner = world.entities[rule.effects[0]?.entity ?? rule.locations?.[0]?.entity ?? ''];
    const sinceKey = `__spatialRuleSince${index}`;
    if (owner) {
      if (matched && typeof owner.properties[sinceKey] !== 'number') owner.properties[sinceKey] = world.tick;
      if (!matched) delete owner.properties[sinceKey];
    }
    const enabled = matched && (!rule.delayTicks || (owner && typeof owner.properties[sinceKey] === 'number'
      && world.tick - Number(owner.properties[sinceKey]) >= rule.delayTicks));
    for (const effect of rule.effects) {
      const target = world.entities[effect.entity];
      if (target && (enabled || effect.otherwise !== undefined)) target.properties[effect.property] = enabled ? effect.value : effect.otherwise!;
    }
    for (const location of rule.locations ?? []) {
      const entity = world.entities[location.entity];
      const selected = enabled ? location : location.otherwise;
      if (entity && selected) entity.location = { ...entity.location, x: selected.x, y: selected.y, z: selected.z ?? 0 };
    }
  }
}
function interaction(scene: SpatialSceneDefinition, target: string): SpatialInteraction | undefined {
  return scene.interactions?.find((entry) => entry.entity === target);
}
function mechanismCrush(before: WorldState, after: WorldState, scene: SpatialSceneDefinition): { actor: Actor; hit: Hit } | null {
  for (const body of scene.bodies) {
    if (!body.kinematic || !active(after, body)) continue;
    const oldEntity = before.entities[body.entity], newEntity = after.entities[body.entity];
    if (!oldEntity || !newEntity) continue;
    const oldActive = active(before, body);
    const distance = Math.hypot(oldEntity.location.x - newEntity.location.x, oldEntity.location.y - newEntity.location.y,
      depthOf(oldEntity.location) - depthOf(newEntity.location));
    if (oldActive && distance < EPS) continue;
    const samples = Math.max(1, Math.min(80, Math.ceil(distance / SAMPLE)));
    const probe = { ...after, entities: { ...after.entities, [body.entity]: { ...newEntity, location: { ...newEntity.location } } } };
    for (let index = 0; index <= samples; index++) {
      if (!oldActive && index < samples) continue;
      const t = index / samples;
      probe.entities[body.entity].location = { ...newEntity.location,
        x: oldEntity.location.x + (newEntity.location.x - oldEntity.location.x) * t,
        y: oldEntity.location.y + (newEntity.location.y - oldEntity.location.y) * t,
        z: depthOf(oldEntity.location) + (depthOf(newEntity.location) - depthOf(oldEntity.location)) * t };
      for (const actor of Object.values(after.actors)) {
        const hit = hitBody(probe, { ...scene, bodies: [body] }, actor, actor.location.x, actor.location.y, depthOf(actor.location));
        if (hit) return { actor, hit: { kind: 'crush', x: actor.location.x, y: actor.location.y, z: depthOf(actor.location), entity: body.entity } };
      }
    }
  }
  return null;
}
function finish(world: WorldState, scene: SpatialSceneDefinition, reason: string, trace?: SpatialMotion): ActionResult {
  const before = structuredClone(world);
  applyRules(world, scene);
  const crush = mechanismCrush(before, world, scene);
  if (crush) return result(world, 'failure', '닫히는 구조물에 끼었어요.', motion(crush.actor, 'crush', [{ ...crush.actor.location, t: 0 }], crush.hit.entity, crush.hit));
  return result(world, 'done', reason, trace);
}
function failed(world: WorldState, hit: Hit, trace: SpatialMotion): ActionResult {
  if (hit.held) return result(world, 'blocked', '잡고 있는 대상에서 더 멀어질 수 없어요.', trace);
  const causes: Record<ContactKind, string> = {
    solid: '몸이 닿아 더 갈 수 없어요.', spikes: '가시에 닿았어요.', steam: '뜨거운 김에 닿았어요.',
    heat: '뜨거운 표면에 닿았어요.', crush: '움직이는 구조물에 끼었어요.', water: '물에 빠졌어요.',
    wind: '바람에 밀려 돌아왔어요.', fall: '발 디딜 곳 없이 추락했어요.',
  };
  return result(world, hit.kind === 'solid' || hit.kind === 'wind' ? 'blocked' : 'failure',
    causes[hit.kind], trace);
}
function contactApproach(world: WorldState, scene: SpatialSceneDefinition, actor: Actor, target: Entity): ActionResult | SpatialMotion {
  if (target.parent === actor.id) return motion(actor, 'interact', [{ ...actor.location, t: 0 }], target.id);
  if (actor.holding === target.id) {
    const trace = motion(actor, 'interact', [{ ...actor.location, t: 0 }], target.id);
    return heldReachHit(world, scene, actor, actor.location.x, actor.location.y, depthOf(actor.location))
      ? result(world, 'blocked', '잡고 있는 대상에서 손이 닿지 않아요.', { ...trace, issue: 'out-of-reach' }) : trace;
  }
  if (target.location.region !== actor.location.region) return result(world, 'blocked', '다른 방의 대상과 접촉할 경로가 없어요.');
  const body = scene.bodies.find((entry) => entry.entity === target.id);
  const desiredDistance = Math.max(0.48, body ? body.width / 2 + actorRadius(actor) + 0.03 : 0.48);
  const delta = target.location.x - actor.location.x, dz = depthOf(target.location) - depthOf(actor.location);
  if (Math.hypot(delta, dz) <= Math.max(desiredDistance, target.reach * 0.6) && Math.abs(target.location.y - actor.location.y) <= 1.3) {
    return motion(actor, 'interact', [{ ...actor.location, t: 0 }], target.id);
  }
  const length = Math.hypot(delta, dz);
  const fraction = Math.min(1, Math.max(0, (length - desiredDistance) / length));
  const goalX = actor.location.x + delta * fraction, goalZ = depthOf(actor.location) + dz * fraction;
  const remaining = Math.hypot(goalX - actor.location.x, goalZ - depthOf(actor.location));
  const stride = Math.min(1, WALK_STEP / remaining);
  const stepX = actor.location.x + (goalX - actor.location.x) * stride;
  const stepZ = depthOf(actor.location) + (goalZ - depthOf(actor.location)) * stride;
  const walk = sweptWalk(world, scene, actor, stepX, stepZ);
  const trace = motion(actor, 'interact', walk.points, target.id, walk.hit);
  if (walk.hit) return failed(world, walk.hit, trace);
  if (Math.hypot(actor.location.x - goalX, depthOf(actor.location) - goalZ) > EPS) return result(world, 'progress', `${target.name} 쪽으로 다가갔어요.`, trace);
  if (Math.abs(target.location.y - actor.location.y) > 1.3) return result(world, 'blocked', '높이가 달라 손이 닿지 않아요.', { ...trace, issue: 'out-of-reach' });
  return trace;
}
function slotFor(entry: Extract<SpatialInteraction, { kind: 'movable' }>, action: PhysicalAction): { x: number; y: number; z?: number } | null {
  if (action.destination) return entry.placements?.[action.destination] ?? null;
  return entry.pushTo ?? null;
}
function moveObject(world: WorldState, scene: SpatialSceneDefinition, actor: Actor, target: Entity, slot: { x: number; y: number; z?: number }, verb: string): ActionResult {
  const dx = slot.x - target.location.x, dz = (slot.z ?? 0) - depthOf(target.location);
  if (Math.hypot(dx, dz) <= EPS) return finish(world, scene, `${target.name}이(가) 제자리에 있어요.`);
  // A sideways shove can slide the object into a nearby depth slot while the
  // actor braces on the original lane; forward hauling follows the actor stride.
  const fraction = Math.min(1, (Math.abs(dz) > Math.abs(dx) ? 1.6 : WALK_STEP) / Math.hypot(dx, dz));
  const step = dx * fraction, depthStep = dz * fraction;
  const body = scene.bodies.find((entry) => entry.entity === target.id);
  const width = body?.width ?? 0.5;
  const count = Math.max(1, Math.ceil(Math.hypot(step, depthStep) / SAMPLE));
  const startX = target.location.x, startZ = depthOf(target.location);
  let movingY = target.location.y;
  for (let i = 1; i <= count; i++) {
    const x = startX + step * i / count, z = startZ + depthStep * i / count;
    const centerFloor = supportingFloor(world, scene, x, z, movingY, 0.2, target.id);
    if (centerFloor !== null) movingY = centerFloor;
    const supportSamples = body?.support ? [x - width / 2 + 0.03, x, x + width / 2 - 0.03] : [x];
    const depthSamples = [z - (body?.depth ?? 0.8) / 2 + 0.03, z, z + (body?.depth ?? 0.8) / 2 - 0.03];
    if (!supportSamples.some((sample) => depthSamples.some((sampleZ) => supportingFloor(world, scene, sample, sampleZ, movingY, 0.2, target.id) !== null))) {
      return result(world, 'blocked', '물건 아래에 이어진 바닥이 없어요.');
    }
    for (const obstacle of scene.bodies) {
      if (obstacle.entity === target.id || !active(world, obstacle)) continue;
      const item = world.entities[obstacle.entity];
      if (!item || item.parent) continue;
      const left = item.location.x + (obstacle.offsetX ?? 0) - obstacle.width / 2;
      if (Math.abs(z - depthOf(item.location)) < ((body?.depth ?? 0.8) + (obstacle.depth ?? 0.8)) / 2 - EPS
        && x + width / 2 > left + EPS && x - width / 2 < left + obstacle.width - EPS && movingY < item.location.y + obstacle.height - EPS && movingY + (body?.height ?? 0.5) > item.location.y + EPS) {
        return result(world, obstacle.kind === 'solid' ? 'blocked' : 'failure', `${target.name}이(가) ${obstacle.kind}에 닿았어요.`);
      }
    }
  }
  target.parent = null;
  target.location = { ...target.location, x: startX + step, y: movingY, z: startZ + depthStep };
  const nextActorX = actor.location.x + step, nextActorZ = depthOf(actor.location);
  const actorWalk = sweptWalk(world, scene, actor, nextActorX, nextActorZ, target.id);
  if (actorWalk.hit) {
    const lastSupported = actorWalk.points.at(-2);
    const canBrace = actorWalk.hit.kind === 'fall' && body?.support && lastSupported
      && Math.hypot(lastSupported.x - target.location.x, (lastSupported.z ?? 0) - depthOf(target.location)) <= body.width / 2 + actorRadius(actor) + 0.2;
    if (!canBrace) return failed(world, actorWalk.hit, motion(actor, 'interact', actorWalk.points, target.id, actorWalk.hit));
    setActor(world, actor, lastSupported.x, lastSupported.y, lastSupported.z);
    actorWalk.points.pop();
  }
  applyRules(world, scene);
  const arrived = Math.hypot(slot.x - target.location.x, (slot.z ?? 0) - depthOf(target.location)) <= EPS;
  if (arrived && Math.abs(slot.y - target.location.y) > 0.25) return result(world, 'blocked', '지정한 높이에 이어지는 받침이 없어요.');
  return result(world, arrived ? 'done' : 'progress', `${target.name}을(를) ${verb} 옮겼어요.`, motion(actor, 'interact', actorWalk.points, target.id));
}
export function executeSpatialAction(source: WorldState, action: PhysicalAction, chapter: SpatialChapterDefinition): ActionResult {
  const scene = sceneFor(source, chapter);
  if (!scene) return result(source, 'blocked', '현재 공간 정의를 찾을 수 없어요.');
  const rawActor = source.actors[action.actor], rawTarget = source.entities[action.target];
  if (!rawActor || !rawTarget) return result(source, 'clarification', '현재 공간에 없는 주체나 대상이에요.');
  const world = structuredClone(source), actor = world.actors[action.actor], target = world.entities[action.target];
  if (action.verb === 'observe' || action.verb === 'remember') {
    if (!world.visible.includes(target.id)) return result(source, 'clarification', '보이는 대상이 아니에요.');
    for (const [property, value] of Object.entries(target.properties)) world.facts.push({ entity: target.id, property, value, attempt: world.attempt, tick: world.tick });
    return finish(world, scene, `${target.name}의 상태를 확인했어요.`);
  }
  if (action.verb === 'move' || action.verb === 'duck') {
    if (target.location.region !== actor.location.region) return result(source, 'blocked', '다른 방까지 걸어가는 경로가 없어요.');
    const route = scene.routes?.[target.id];
    let nextIndex = actor.route?.target === target.id ? actor.route.next : 0;
    if (route) {
      while (nextIndex < route.length) {
        const point = route[nextIndex];
        if (Math.hypot(point.x - actor.location.x, (point.z ?? 0) - depthOf(actor.location)) > 0.08 || Math.abs(point.y - actor.location.y) > 0.25) break;
        nextIndex++;
      }
      actor.route = { target: target.id, next: nextIndex };
    } else actor.route = undefined;
    const next = route?.[nextIndex];
    const goalX = next?.x ?? target.location.x, goalZ = next?.z ?? depthOf(target.location);
    const distance = Math.hypot(goalX - actor.location.x, goalZ - depthOf(actor.location));
    const fraction = distance ? Math.min(1, WALK_STEP / distance) : 0;
    const stepX = actor.location.x + (goalX - actor.location.x) * fraction;
    const stepZ = depthOf(actor.location) + (goalZ - depthOf(actor.location)) * fraction;
    if (distance < EPS) return Math.abs(actor.location.y - target.location.y) <= Math.max(0.5, target.reach)
      ? finish(world, scene, `${target.name} 앞에 도착했어요.`, motion(actor, 'walk', [{ ...actor.location, t: 0 }], target.id))
      : result(world, 'blocked', '목적지가 다른 높이에 있어 오르는 길이 필요해요.');
    const walk = sweptWalk(world, scene, actor, stepX, stepZ, undefined, action.verb === 'duck');
    const trace = motion(actor, 'walk', walk.points, target.id, walk.hit);
    if (walk.hit) return failed(world, walk.hit, trace);
    if (next && Math.hypot(next.x - actor.location.x, (next.z ?? 0) - depthOf(actor.location)) <= 0.08 && Math.abs(next.y - actor.location.y) <= 0.25) {
      actor.route = { target: target.id, next: nextIndex + 1 };
    }
    if (actor.riding) {
      const platform = world.entities[actor.riding];
      const body = scene.bodies.find((item) => item.entity === actor.riding);
      if (!platform || Math.abs(actor.location.x - platform.location.x) > (body?.width ?? 1) / 2) actor.riding = null;
    }
    applyRules(world, scene);
    const reached = Math.hypot(actor.location.x - target.location.x, depthOf(actor.location) - depthOf(target.location)) <= 0.35 && Math.abs(actor.location.y - target.location.y) <= Math.max(0.5, target.reach);
    if (reached) actor.route = undefined;
    return result(world, reached ? 'done' : 'progress', reached ? `${target.name} 앞에 도착했어요.` : `${target.name} 쪽으로 걸었어요.`, trace);
  }
  if (action.verb === 'jump') {
    if (actor.id !== 'hero') return result(source, 'blocked', '이 주체는 점프할 수 없어요.');
    if (target.location.region !== actor.location.region) return result(source, 'blocked', '다른 방으로 뛰어넘을 수 없어요.');
    const direction = Math.sign(target.location.x - actor.location.x);
    if (!direction) return result(source, 'blocked', '뛰어넘을 방향을 정할 수 없어요.');
    // Choose a launch point by checking actual sampled arcs, not by an obstacle name.
    const ahead = scene.bodies.filter((body) => active(world, body) && world.entities[body.entity] && body.entity !== target.id
      && direction * (world.entities[body.entity].location.x + direction * (body.width / 2 + actorRadius(actor)) - actor.location.x) > 0
      && !(body.support && Math.abs(world.entities[body.entity].location.y + (body.offsetY ?? 0) + body.height - actor.location.y) <= 0.18
        && Math.abs(world.entities[body.entity].location.x - actor.location.x) <= body.width / 2)
      && Math.abs(depthOf(world.entities[body.entity].location) - depthOf(actor.location)) <= (body.depth ?? 0.8) / 2 + RADIUS
      && !(Math.abs(world.entities[body.entity].location.x - actor.location.x) < body.width / 2
        && hitBody(world, { ...scene, bodies: [body] }, actor, actor.location.x, actor.location.y, depthOf(actor.location)) === null))
      .map((body) => ({ body, x: world.entities[body.entity].location.x - direction * (body.width / 2 + RADIUS + 0.04) }))
      .filter(({ x }) => direction * (x - actor.location.x) > -1.6 && direction * (x - target.location.x) < 0)
      .sort((a, b) => direction * (a.x - b.x))[0];
    let launchX = actor.location.x;
    if (ahead) {
      const candidatePositions = Array.from({ length: 26 }, (_, index) => ahead.x - direction * index * 0.06)
        .filter((x) => direction * (target.location.x - x) > 0.45)
        .sort((a, b) => Math.abs(a - actor.location.x) - Math.abs(b - actor.location.x));
      const chosen = candidatePositions.find((x) => {
        const trial = structuredClone(world), trialActor = trial.actors[action.actor];
        const approach = sweptWalk(trial, scene, trialActor, x);
        if (!approach.reached || approach.hit) return false;
        if (trialActor.capabilities.includes('gravity:up') !== actor.capabilities.includes('gravity:up')) return false;
        const landingX = x + direction * Math.min(JUMP_RANGE, Math.abs(target.location.x - x));
        const arc = jumpArc(trial, scene, trialActor, landingX);
        return arc.reached && direction * (landingX - (ahead.x + direction * (ahead.body.width + RADIUS))) > 0;
      });
      launchX = chosen ?? ahead.x - direction * 0.3;
    }
    if (Math.abs(launchX - actor.location.x) > 0.07) {
      const approachX = actor.location.x + Math.sign(launchX - actor.location.x) * Math.min(WALK_STEP, Math.abs(launchX - actor.location.x));
      const walked = sweptWalk(world, scene, actor, approachX);
      const trace = motion(actor, 'walk', walked.points, target.id, walked.hit);
      if (walked.hit) return failed(world, walked.hit, trace);
      return result(world, 'progress', '도약할 가장자리로 다가갔어요.', trace);
    }
    const requested = Math.abs(target.location.x - actor.location.x);
    const landingX = actor.location.x + direction * Math.min(JUMP_RANGE, requested);
    const arc = jumpArc(world, scene, actor, landingX);
    const trace = motion(actor, 'jump', arc.points, target.id, arc.hit);
    if (arc.hit) return failed(world, arc.hit, trace);
    actor.riding = null;
    applyRules(world, scene);
    const reached = Math.abs(actor.location.x - target.location.x) <= 0.35;
    return result(world, reached ? 'done' : 'progress', reached ? `${target.name} 쪽에 착지했어요.` : '범위 안에서 점프해 착지했어요.', trace);
  }
  const supportBody = scene.bodies.find((body) => body.entity === target.id && body.support && active(world, body));
  if ((action.verb === 'board' || action.verb === 'climb') && supportBody) {
    const distance = Math.hypot(target.location.x - actor.location.x, depthOf(target.location) - depthOf(actor.location));
    if (distance > JUMP_RANGE - 0.1) {
      const fraction = Math.min(1, WALK_STEP / distance);
      const stepX = actor.location.x + (target.location.x - actor.location.x) * fraction;
      const stepZ = depthOf(actor.location) + (depthOf(target.location) - depthOf(actor.location)) * fraction;
      const walk = sweptWalk(world, scene, actor, stepX, stepZ);
      const trace = motion(actor, 'walk', walk.points, target.id, walk.hit);
      if (walk.hit) return failed(world, walk.hit, trace);
      return result(world, 'progress', '발판의 도약 범위로 다가갔어요.', trace);
    }
    const top = target.location.y + (supportBody.offsetY ?? 0) + supportBody.height;
    if (top - actor.location.y > JUMP_HEIGHT + EPS) return result(world, 'blocked', '오를 수 있는 높이를 넘어요.');
    const arc = jumpArc(world, scene, actor, target.location.x, depthOf(target.location), target.id);
    const trace = motion(actor, 'jump', arc.points, target.id, arc.hit);
    if (arc.hit) return failed(world, arc.hit, trace);
    if (action.verb === 'board') actor.riding = target.id;
    return finish(world, scene, `${target.name} 위에 올랐어요.`, trace);
  }
  const carried = actor.carrying.includes(target.id);
  if (carried && action.verb === 'place' && action.destination) {
    const destination = world.entities[action.destination];
    if (!destination) return result(world, 'clarification', '지정한 자리를 찾을 수 없어요.');
    const approach = contactApproach(world, scene, actor, destination);
    if ('outcome' in approach) return approach;
  }
  if (!carried && action.verb !== 'release') {
    const approach = contactApproach(world, scene, actor, target);
    if ('outcome' in approach) return approach;
  }
  const entry = interaction(scene, target.id);
  const trace = motion(actor, 'interact', [{ ...actor.location, t: 0 }], target.id);
  const needsPartner = entry?.kind === 'movable' && entry.joint
    && (actor.holding !== target.id || !Object.values(world.actors).some(other => other.id !== actor.id && other.holding === target.id));
  if (action.verb === 'take') {
    if (needsPartner) return result(world, 'blocked', '두 주체가 물건 양쪽에 함께 있어야 해요.', { ...trace, issue: 'needs-partner' });
    if (!target.movable || target.parent === 'hero' || target.parent === 'keeper') return result(world, 'blocked', '지금 이 물건을 들 수 없어요.', trace);
    if (actor.carrying.filter((id) => world.entities[id]?.properties.equipment !== true).length >= 2) return result(world, 'blocked', '손과 물건 고리가 가득 찼어요.', trace);
    target.parent = actor.id; actor.carrying.push(target.id); target.location = { ...actor.location };
    return finish(world, scene, `${target.name}을(를) 챙겼어요.`, trace);
  }
  if (action.verb === 'release') {
    if (actor.holding === target.id) {
      actor.holding = null; target.properties.held = false; delete target.properties.heldBy;
      if (entry?.kind === 'door' && entry.spring && target.properties.latched !== true) target.properties.open = false;
      return finish(world, scene, `${target.name}을(를) 놓았어요.`, trace);
    }
    if (carried) {
      actor.carrying = actor.carrying.filter((id) => id !== target.id); target.parent = null; target.location = { ...actor.location };
      return finish(world, scene, `${target.name}을(를) 내려놓았어요.`, trace);
    }
    return result(world, 'clarification', '현재 잡거나 운반하는 대상이 아니에요.');
  }
  if (entry?.kind === 'movable' && (action.verb === 'place' || action.verb === 'push' || action.verb === 'pull')) {
    if (!target.movable) return result(world, 'blocked', '움직일 수 있는 배치 경로가 없어요.', trace);
    if (needsPartner) {
      return result(world, 'blocked', '두 주체가 물건 양쪽에 함께 있어야 해요.', { ...trace, issue: 'needs-partner' });
    }
    const slot = slotFor(entry, action);
    if (!slot) return result(world, 'clarification', '이 물건을 둘 수 있는 장소를 지정해 주세요.');
    if (action.verb === 'place') {
      if (!carried && !entry.joint) return result(world, 'clarification', '먼저 물건을 들어야 해요.');
      const width = scene.bodies.find((body) => body.entity === target.id)?.width ?? 0;
      if (Math.hypot(slot.x - actor.location.x, slot.y - actor.location.y, (slot.z ?? 0) - depthOf(actor.location)) > 1.1 + (entry.joint ? width / 2 : 0)) return result(world, 'blocked', '지정된 자리에 손이 닿지 않아요.', trace);
      if (entry.joint && width > 0 && [slot.x - width / 2 + 0.05, slot.x + width / 2 - 0.05].some((edge) => supportingFloor(world, scene, edge, slot.z ?? 0, slot.y + 0.15, 0.35) === null)) return result(world, 'blocked', '긴 물건의 양 끝이 받침에 닿지 않아요.', trace);
      if (!action.destination && supportingFloor(world, scene, slot.x, slot.z ?? 0, slot.y + 0.1, 0.2) === null) return result(world, 'blocked', '지정된 자리에 받침이 없어요.', trace);
      actor.carrying = actor.carrying.filter((id) => id !== target.id); target.parent = action.destination ?? null; target.location = { ...target.location, ...slot };
      if (entry.joint) for (const participant of Object.values(world.actors)) if (participant.holding === target.id) participant.holding = null;
      return finish(world, scene, `${target.name}을(를) 놓았어요.`, trace);
    }
    if (target.parent) return result(world, 'blocked', '들려 있는 물건은 밀거나 당길 수 없어요.', trace);
    return moveObject(world, scene, actor, target, slot, action.verb === 'push' ? '밀어' : '당겨');
  }
  if (action.verb === 'hold') {
    if (!entry || (entry.kind !== 'handle' && !(entry.kind === 'door' && entry.spring) && !(entry.kind === 'movable' && entry.joint)) || (actor.holding && actor.holding !== target.id)) return result(world, 'blocked', '이 손잡이를 유지할 수 없어요.', trace);
    actor.holding = target.id; target.properties.held = true; target.properties.heldBy = actor.id;
    if (entry.kind === 'door') target.properties.open = true;
    return finish(world, scene, `${target.name}을(를) 잡았어요.`, trace);
  }
  if (entry?.kind === 'control' && ['turn', 'push', 'pull', 'open', 'close'].includes(action.verb)) {
    const current = target.properties[entry.property];
    const destination = action.destination && entry.destinations?.[action.destination];
    target.properties[entry.property] = destination ?? (current === entry.value && entry.offValue !== undefined ? entry.offValue : entry.value);
    return finish(world, scene, `${target.name}을(를) 조작했어요.`, trace);
  }
  if (entry?.kind === 'door' && (action.verb === 'open' || action.verb === 'close')) {
    if (action.verb === 'open' && entry.key && !actor.carrying.includes(entry.key) && world.entities[entry.key]?.parent !== target.id) return result(world, 'blocked', '문에 맞는 열쇠가 필요해요.', trace);
    if (action.verb === 'open' && entry.key && actor.carrying.includes(entry.key)) {
      const key = world.entities[entry.key];
      if (key) { actor.carrying = actor.carrying.filter((id) => id !== key.id); key.parent = target.id; key.location = { ...target.location }; }
    }
    target.properties.open = action.verb === 'open';
    if (entry.spring && action.verb === 'open') { actor.holding = target.id; target.properties.held = true; target.properties.heldBy = actor.id; }
    if (action.verb === 'close') { target.properties.latched = false; if (actor.holding === target.id) actor.holding = null; }
    return finish(world, scene, `${target.name}을(를) ${action.verb === 'open' ? '열었어요' : '닫았어요'}.`, trace);
  }
  if (entry?.kind === 'door' && entry.spring && action.verb === 'turn') {
    if (!target.properties.open || actor.holding !== target.id) return result(world, 'blocked', '문을 잡아 연 채 잠금쇠를 돌려야 해요.', trace);
    target.properties.latched = true;
    return finish(world, scene, `${target.name}의 잠금쇠를 걸었어요.`, trace);
  }
  if (entry?.kind === 'handle' && ['open', 'close', 'turn', 'pull', 'push'].includes(action.verb)) {
    target.properties.open = action.verb !== 'close' && !target.properties.open;
    return finish(world, scene, `${target.name}을(를) 조작했어요.`, trace);
  }
  if (action.verb === 'climb' && scene.bodies.some((body) => body.entity === target.id && body.support)) {
    const body = scene.bodies.find((item) => item.entity === target.id)!;
    const top = target.location.y + (body.offsetY ?? 0) + body.height;
    if (top - actor.location.y > JUMP_HEIGHT + EPS) return result(world, 'blocked', '오를 수 있는 높이를 넘어요.', trace);
    if (Math.hypot(target.location.x - actor.location.x, depthOf(target.location) - depthOf(actor.location)) > JUMP_RANGE) return result(world, 'blocked', '오를 수 있는 거리를 넘어요.', trace);
    const arc = jumpArc(world, scene, actor, target.location.x, depthOf(target.location), target.id);
    const climbTrace = motion(actor, 'jump', arc.points, target.id, arc.hit);
    if (arc.hit) return failed(world, arc.hit, climbTrace);
    return finish(world, scene, `${target.name} 위에 올랐어요.`, climbTrace);
  }
  if (entry?.kind === 'ladder' && action.verb === 'climb') {
    if (entry.freeHands && (actor.holding || actor.carrying.some((id) => world.entities[id]?.properties.equipment !== true))) return result(world, 'blocked', '손을 비워야 오를 수 있어요.', trace);
    const destination = world.entities[entry.destination];
    if (!destination) return result(world, 'blocked', '사다리가 닿는 곳이 없어요.', trace);
    // A ladder is an authored vertical connector; horizontal reach remains bounded.
    if (Math.abs(destination.location.x - actor.location.x) > 1.1) return result(world, 'blocked', '사다리 끝이 손이 닿는 곳에 없어요.', trace);
    if (heldReachHit(world, scene, actor, destination.location.x, destination.location.y, depthOf(destination.location))) {
      return result(world, 'blocked', '잡고 있는 대상에서 더 멀어질 수 없어요.', { ...trace, issue: 'out-of-reach' });
    }
    setActor(world, actor, destination.location.x, destination.location.y, depthOf(destination.location));
    return finish(world, scene, '사다리를 올라갔어요.', motion(actor, 'interact', [{ x: rawActor.location.x, y: rawActor.location.y, t: 0 }, { x: actor.location.x, y: actor.location.y, t: 1 }], target.id));
  }
  if (entry?.kind === 'transport' && (action.verb === 'board' || action.verb === 'dismount')) {
    if (action.verb === 'board') {
      const boardY = target.location.y + (scene.bodies.find((body) => body.entity === target.id)?.height ?? 0);
      if (heldReachHit(world, scene, actor, target.location.x, boardY, depthOf(target.location))) {
        return result(world, 'blocked', '잡고 있는 대상에서 더 멀어질 수 없어요.', { ...trace, issue: 'out-of-reach' });
      }
      actor.riding = target.id; setActor(world, actor, target.location.x, boardY, depthOf(target.location));
    }
    else actor.riding = null;
    return finish(world, scene, action.verb === 'board' ? '발판에 탔어요.' : '발판에서 내렸어요.', trace);
  }
  if (entry?.kind === 'gravity' && ['turn', 'push', 'pull'].includes(action.verb)) {
    target.properties.gravity = entry.gravity;
    target.location = { ...target.location, y: entry.destinationY };
    return finish(world, scene, `${target.name}의 중력 방향을 바꿨어요.`, trace);
  }
  return result(world, 'blocked', '이 대상에 연결된 공간 조작 규칙이 없어요.', trace);
}
export function advanceSpatialWorld(source: WorldState, chapter: SpatialChapterDefinition): EnvironmentStep {
  const scene = sceneFor(source, chapter);
  if (!scene) return { world: source, events: [], canChange: false };
  const world = structuredClone(source);
  world.tick++;
  const localTick = world.tick - (world.segmentStartedAt ?? 0);
  const temporalKey = () => {
    const phases = [
      ...(scene.cycles ?? []).map((cycle) => localTick % (cycle.values.length * Math.max(1, cycle.ticksPerValue ?? 1) || 1)),
      ...(scene.interactions ?? []).filter((entry): entry is Extract<SpatialInteraction, { kind: 'transport' }> => entry.kind === 'transport')
        .map((entry) => localTick % (Math.max(1, entry.period) * 2)),
      ...(scene.rules ?? []).map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.delayTicks).map(({ rule, index }) => {
        const owner = world.entities[rule.effects[0]?.entity ?? rule.locations?.[0]?.entity ?? ''];
        const since = owner?.properties[`__spatialRuleSince${index}`];
        return typeof since === 'number' ? Math.min(rule.delayTicks ?? 0, world.tick - since) : -1;
      }),
    ];
    return phases.length ? JSON.stringify(phases) : undefined;
  };
  for (const cycle of scene.cycles ?? []) {
    const item = world.entities[cycle.entity];
    if (item && cycle.values.length) {
      const index = Math.floor(localTick / Math.max(1, cycle.ticksPerValue ?? 1)) % cycle.values.length;
      item.properties[cycle.property] = cycle.values[index];
      const location = cycle.locations?.[index];
      if (location) item.location = { ...item.location, x: location.x, y: location.y, z: location.z ?? 0 };
    }
  }
  for (const entry of scene.interactions ?? []) {
    if (entry.kind !== 'transport' || (entry.enabled && !spatialCondition(world, entry.enabled))) continue;
    const platform = world.entities[entry.entity];
    if (!platform) continue;
    const period = Math.max(1, entry.period), phase = (localTick % (period * 2)) / period;
    const fraction = phase <= 1 ? phase : 2 - phase;
    const from = { ...platform.location };
    platform.location = { ...from, x: entry.from.x + (entry.to.x - entry.from.x) * fraction, y: entry.from.y + (entry.to.y - entry.from.y) * fraction };
    platform.location.z = (entry.from.z ?? 0) + ((entry.to.z ?? 0) - (entry.from.z ?? 0)) * fraction;
    const fromDistance = Math.hypot(platform.location.x - entry.from.x, platform.location.y - entry.from.y, depthOf(platform.location) - (entry.from.z ?? 0));
    const toDistance = Math.hypot(platform.location.x - entry.to.x, platform.location.y - entry.to.y, depthOf(platform.location) - (entry.to.z ?? 0));
    platform.properties.position = fromDistance <= 0.8 ? 'near' : toDistance <= 0.8 ? 'far' : 'moving';
    const dx = platform.location.x - from.x, dy = platform.location.y - from.y;
    for (const actor of Object.values(world.actors)) if (actor.riding === platform.id) {
      setActor(world, actor, actor.location.x + dx, actor.location.y + dy, depthOf(actor.location) + depthOf(platform.location) - depthOf(from));
      if (heldReachHit(world, scene, actor, actor.location.x, actor.location.y, depthOf(actor.location))) {
        const held = world.entities[actor.holding!];
        actor.holding = null;
        held.properties.held = false;
        delete held.properties.heldBy;
        const heldEntry = interaction(scene, held.id);
        if (heldEntry?.kind === 'door' && heldEntry.spring && held.properties.latched !== true) held.properties.open = false;
      }
    }
    for (const item of Object.values(world.entities)) if (item.parent === platform.id) item.location = { ...item.location, x: item.location.x + dx, y: item.location.y + dy };
  }
  applyRules(world, scene);
  const crush = mechanismCrush(source, world, scene);
  if (crush) {
    const trace = motion(crush.actor, 'crush', [{ ...crush.actor.location, t: 0 }], crush.hit.entity, crush.hit);
    const reason = '움직이는 구조물에 끼었어요.';
      return { world, events: [{ id: `spatial-crush-${world.tick}-${crush.actor.id}`, tick: world.tick, attempt: world.attempt,
        instructionId: null, actor: crush.actor.id, target: crush.hit.entity ?? null, outcome: 'failure', reason, changes: [], motion: trace }],
      failure: reason, canChange: true, waitKey: temporalKey() };
  }
  for (const actor of Object.values(world.actors)) {
    const hit = hitBody(world, scene, actor, actor.location.x, actor.location.y, depthOf(actor.location));
    if (hit?.kind === 'wind') {
      const pushed = sweptWalk(world, scene, actor, Math.max(0, actor.location.x - 1.2), depthOf(actor.location), hit.entity);
      const impact = pushed.hit ?? hit;
      const trace = motion(actor, impact.kind, pushed.points, hit.entity, impact);
      const failure = impact.kind === 'fall' || (impact.kind !== 'solid' && impact.kind !== 'wind') ? `${impact.kind}에 닿았어요.` : undefined;
      const reason = failure ?? '바람에 밀려 돌아왔어요.';
      return { world, events: [{ id: `spatial-wind-${world.tick}-${actor.id}`, tick: world.tick, attempt: world.attempt,
        instructionId: null, actor: actor.id, target: hit.entity ?? null, outcome: failure ? 'failure' : 'blocked', reason, changes: [], motion: trace }],
        ...(failure ? { failure } : {}), canChange: true, waitKey: temporalKey() };
    }
    if (hit && hit.kind !== 'solid') {
      const trace = motion(actor, hit.kind, [{ ...actor.location, t: 0 }], hit.entity, hit);
      const reason = `${hit.kind}에 닿았어요.`;
      return { world, events: [{ id: `spatial-${world.tick}-${actor.id}`, tick: world.tick, attempt: world.attempt,
        instructionId: null, actor: actor.id, target: hit.entity ?? null, outcome: 'failure', reason, changes: [], motion: trace }],
        failure: reason, canChange: true, waitKey: temporalKey() };
    }
  }
  return { world, events: [], canChange: !!scene.cycles?.length || !!scene.interactions?.some((entry) => entry.kind === 'transport') || !!scene.rules?.some((rule) => rule.delayTicks), waitKey: temporalKey() };
}
export function createSpatialStage(chapter: SpatialChapterDefinition): CampaignStageDefinition {
  const segments: SegmentDefinition[] = chapter.scenes.map((scene) => ({
    id: scene.id, title: scene.title, goal: scene.goal, description: scene.goal, hints: scene.hints ?? ['', '', ''],
    scene: { floors: scene.surfaces.map(({ from, to, y }) => ({ from, to, y })), ceiling: scene.ceiling !== undefined,
      spatial: { bodies: scene.bodies, surfaces: scene.surfaces, ceiling: scene.ceiling } },
    enter: (previous) => {
      const hero = makeHero(scene.id, scene.hero?.location?.x ?? 0);
      Object.assign(hero, scene.hero ?? {});
      hero.location = { region: scene.id, x: scene.hero?.location?.x ?? 0, y: scene.hero?.location?.y ?? 0 };
      const world = makeWorld(chapter.id, scene.id, structuredClone(scene.entities), hero);
      if (scene.keeper) {
        world.actors.keeper = { ...makeHero(scene.id), id: 'keeper', ...scene.keeper, location: { region: scene.id, x: scene.keeper.location?.x ?? 0, y: scene.keeper.location?.y ?? 0 } };
      }
      for (const link of scene.carry ?? []) {
        const existing = previous?.entities[link.from];
        const destination = world.entities[link.to];
        if (existing && destination) {
          if (link.properties) for (const [fromKey, toKey] of Object.entries(link.properties)) {
            const value = existing.properties[fromKey];
            if (value !== undefined) destination.properties[toKey] = value;
          }
          else destination.properties = { ...destination.properties, ...existing.properties };
          if (link.location ?? link.from === link.to) destination.location = { ...destination.location, x: existing.location.x, y: existing.location.y, z: depthOf(existing.location) };
          if (link.from === link.to) {
            const oldParent = existing.parent;
            destination.parent = oldParent && (oldParent === 'hero' || oldParent === 'keeper' || world.entities[oldParent]) ? oldParent : null;
            if (destination.parent === 'hero' || destination.parent === 'keeper') {
              const actor = world.actors[destination.parent];
              if (actor && !actor.carrying.includes(destination.id)) actor.carrying.push(destination.id);
            }
          }
        }
      }
      for (const actor of Object.values(world.actors)) {
        actor.carrying = actor.carrying.filter((id) => world.entities[id]?.parent === actor.id);
        for (const entity of Object.values(world.entities)) {
          if (entity.parent === actor.id && !actor.carrying.includes(entity.id)) actor.carrying.push(entity.id);
        }
      }
      applyRules(world, scene);
      return world;
    },
    execute: (world, action) => executeSpatialAction(world, action, chapter),
    advance: (world) => advanceSpatialWorld(world, chapter),
    complete: (world) => scene.goals.every((condition) => spatialCondition(world, condition)),
  }));
  return { id: chapter.id, title: chapter.title, objective: chapter.objective, contentRevision: 'spatial-v1', segments, practice: segments[0], story: chapter.story };
}
