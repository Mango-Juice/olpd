import { at, makeEntity, makeWorld, type SegmentDefinition } from "../level";
import { currentLoad, executePhysicalAction } from "../physics";
import type { ActionResult } from "../program";
import type { Entity, PhysicalAction, WorldState } from "../types";

function clarification(world: WorldState, reason: string): ActionResult {
  return { world, outcome: "clarification", reason };
}

function failed(world: WorldState, reason: string): ActionResult {
  return { world, outcome: "failure", reason };
}

function distance(left: Entity, right: Entity): number {
  if (left.location.region !== right.location.region) return Number.POSITIVE_INFINITY;
  return Math.hypot(left.location.x - right.location.x, left.location.y - right.location.y);
}

function moveEntityTree(world: WorldState, entityId: string, location: Entity["location"], visited = new Set<string>()): void {
  if (visited.has(entityId)) return;
  visited.add(entityId);
  const entity = world.entities[entityId];
  if (!entity) return;
  entity.location = { ...location };
  for (const child of Object.values(world.entities)) {
    if (child.parent === entityId) moveEntityTree(world, child.id, location, visited);
  }
  for (const actor of Object.values(world.actors)) {
    if (actor.riding !== entityId) continue;
    actor.location = { ...location };
    for (const carried of actor.carrying) moveEntityTree(world, carried, location, visited);
  }
}

function tick(world: WorldState): WorldState {
  const next = structuredClone(world);
  next.tick += 1;
  return next;
}

function crosses(world: WorldState, action: PhysicalAction, from: number, to: number): boolean {
  if (!(["move", "jump", "duck"] as PhysicalAction["verb"][]).includes(action.verb)) return false;
  const actor = world.actors[action.actor];
  const target = world.entities[action.target];
  if (!actor || !target) return false;
  return Math.min(actor.location.x, target.location.x) < to && Math.max(actor.location.x, target.location.x) > from;
}

export const RAIN_REACH: SegmentDefinition = {
  id: "02-3",
  title: "닿지 않는 손잡이",
  goal: "통을 실제로 안정시켜 높은 손잡이를 당기고 마른 출구로 내려오기",
  description: "빈 통은 떠서 흔들립니다. 눈금은 물 2칸이 안정선, 3칸이 적재 초과임을 보여 주며, 짧은 밧줄은 통과 벽 고리 사이에 닿습니다.",
  hints: [
    "통의 안정선과 짧은 밧줄의 길이 원호를 살펴보세요.",
    "알맞은 무게나 고정점은 서로 다른 원인으로 통의 움직임을 막아요.",
    "통에 물 두 칸을 붓거나 벽 고리에 묶은 뒤 올라 손잡이를 당겨.",
  ],
  enter: () => makeWorld(2, "02-3", [
    makeEntity("reach-start", "얕은 수조 입구", "02-3", 0, { material: "stone", properties: { kind: "platform", safe: true } }),
    makeEntity("reach-pedestal", "고정된 낮은 받침", "02-3", 1, { material: "stone", capacity: 2, properties: { kind: "support", climbable: true, stable: true, height: 1 } }),
    makeEntity("reach-basin", "세 칸 얕은 대야", "02-3", 1, { material: "water", movable: true, capacity: 3, properties: { kind: "container", amount: 3, fluidDensity: 1, marks: "1|2|3", slot: "large" } }),
    makeEntity("reach-barrel", "떠 있는 빈 통", "02-3", 2, { description: "빈 통 · 물 2칸 안정 · 물 3칸 적재 초과", material: "wood", movable: true, weight: 1, capacity: 3, reach: 2, properties: { kind: "barrel", slot: "large", boardable: true, climbable: true, buoyant: true, afloat: true, amount: 0, fluidDensity: 1, safeAmount: 2, overloadAmount: 3, stable: false, tiePoint: true, tipped: false } }),
    makeEntity("reach-rope", "짧은 밧줄", "02-3", 2, { material: "cloth", movable: true, weight: 0.1, reach: 2, properties: { kind: "rope", tool: "rope", ropeLength: 2, slot: "small" } }),
    makeEntity("reach-anchor", "손잡이 아래 벽 고리", "02-3", 4, { material: "metal", reach: 4, properties: { kind: "anchor", tiePoint: true, fixed: true } }),
    makeEntity("reach-ruler", "손끝 높이 자", "02-3", 2, { material: "metal", properties: { kind: "ruler", heroHeight: 1, handleHeight: 2, barrelHeight: 1 } }),
    makeEntity("reach-handle", "높은 손잡이", "02-3", 2, { material: "metal", reach: 1, properties: { kind: "handle", height: 2, pulled: false } }),
    makeEntity("reach-door", "회랑 끝 문", "02-3", 4, { material: "metal", properties: { kind: "door", open: false } }),
    makeEntity("reach-exit", "마른 출구 턱", "02-3", 4, { material: "stone", reach: 2, properties: { kind: "platform", safe: true } }),
  ]),
  execute: (world, action) => {
    if (crosses(world, action, 1, 4)) return failed(world, "얕은 물받이를 걸어서 건너다 편지가 젖었어요. 통에서 마른 턱으로 내려와야 해요.");
    if ((action.verb === "board" || action.verb === "climb") && action.target === "reach-barrel" && world.entities["reach-barrel"].properties.stable !== true) {
      const next = structuredClone(world);
      next.entities["reach-barrel"].properties.tipped = true;
      return failed(next, "고정되지 않은 통에 오르자 실제로 기울어 얕은 물받이에 빠졌어요.");
    }
    if (action.verb === "pull" && action.target === "reach-handle") {
      const actor = world.actors[action.actor];
      const barrel = world.entities["reach-barrel"];
      if (!actor || actor.riding !== barrel.id || barrel.properties.stable !== true) {
        return clarification(world, "높은 손잡이에 닿으려면 실제로 안정된 통 위에 올라야 해요.");
      }
      const next = structuredClone(world);
      next.entities["reach-handle"].properties.pulled = true;
      next.entities["reach-door"].properties.open = true;
      return { world: next, outcome: "done", reason: "안정된 통 위에서 높은 손잡이를 당겨 문을 열었어요." };
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => {
    const next = tick(world);
    const barrel = next.entities["reach-barrel"];
    const amount = Number(barrel.properties.amount);
    const anchored = barrel.properties.tiedTo === "reach-anchor";
    barrel.properties.afloat = amount < 2;
    barrel.properties.stable = amount === Number(barrel.properties.safeAmount) || anchored;
    if (amount >= Number(barrel.properties.overloadAmount)) {
      barrel.properties.stable = false;
      barrel.properties.tipped = true;
      return { world: next, events: [], canChange: false, failure: `통의 물 ${amount}칸이 적재선 ${barrel.properties.safeAmount}칸을 넘어 실제로 기울었어요.` };
    }
    return { world: next, events: [], canChange: false };
  },
  complete: (world) => world.entities["reach-door"].properties.open === true &&
    at(world, "hero", "reach-exit") && world.actors.hero.riding === null &&
    world.entities["reach-barrel"].properties.tipped !== true,
};

function isBoat(entity: Entity | undefined): entity is Entity {
  return entity?.properties.kind === "boat";
}

function normalizeFixedRope(result: ActionResult, boatId: string, fixedId: string, ropeId: string): ActionResult {
  if (result.outcome !== "done") return result;
  const next = structuredClone(result.world);
  const boat = next.entities[boatId];
  const fixed = next.entities[fixedId];
  const rope = next.entities[ropeId];
  delete boat.properties.tiedTo;
  boat.properties.anchoredTo = fixedId;
  boat.properties.tiedWith = ropeId;
  delete fixed.properties.tiedTo;
  delete fixed.properties.tiedWith;
  rope.properties.connectsToBoat = boatId;
  rope.properties.connectsToFixed = fixedId;
  return { world: next, outcome: "done", reason: `${rope.name}(으)로 ${boat.name}과(와) ${fixed.name}을(를) 연결했어요.` };
}

function untieFixed(world: WorldState, action: PhysicalAction): ActionResult | null {
  if (action.verb !== "untie") return null;
  const actor = world.actors[action.actor];
  const boat = world.entities[action.target];
  if (!actor || !isBoat(boat) || typeof boat.properties.anchoredTo !== "string") return null;
  const fixedId = String(boat.properties.anchoredTo);
  const ropeId = String(boat.properties.tiedWith);
  if (action.destination && action.destination !== fixedId) return clarification(world, `${boat.name}은 지정한 고정점에 묶여 있지 않아요.`);
  if (action.instrument && action.instrument !== ropeId) return clarification(world, "지정한 밧줄은 이 연결에 쓰인 밧줄이 아니에요.");
  if (actor.location.region !== boat.location.region || Math.abs(actor.location.x - boat.location.x) > Math.max(1, boat.reach)) {
    return clarification(world, `${boat.name}의 매듭은 현재 손이 닿지 않아요.`);
  }
  const next = structuredClone(world);
  const nextBoat = next.entities[boat.id];
  const rope = next.entities[ropeId];
  delete nextBoat.properties.anchoredTo;
  delete nextBoat.properties.tiedWith;
  delete rope.properties.connectsToBoat;
  delete rope.properties.connectsToFixed;
  delete rope.properties.connects;
  rope.parent = null;
  rope.location = { ...next.actors[action.actor].location };
  return { world: next, outcome: "done", reason: `${boat.name}과(와) ${next.entities[fixedId].name}의 연결을 풀었어요.` };
}

function pullConnectedBoat(world: WorldState, action: PhysicalAction): ActionResult | null {
  if (action.verb !== "pull") return null;
  const rope = world.entities[action.target];
  const destination = action.destination ? world.entities[action.destination] : undefined;
  if (!rope || rope.properties.tool !== "rope" || typeof rope.properties.connectsToBoat !== "string") return null;
  if (!destination || destination.id !== rope.properties.connectsToFixed) return clarification(world, "밧줄이 연결된 고정점을 도착 대상으로 지정해 주세요.");
  const boat = world.entities[String(rope.properties.connectsToBoat)];
  const actor = world.actors[action.actor];
  if (!isBoat(boat) || !actor) return clarification(world, "밧줄 끝의 배를 현재 세계에서 확인할 수 없어요.");
  if (actor.location.region !== rope.location.region || Math.abs(actor.location.x - rope.location.x) > Math.max(1, rope.reach)) {
    return clarification(world, `${rope.name}의 당기는 끝은 현재 도달 범위 밖에 있어요.`);
  }
  const next = structuredClone(world);
  moveEntityTree(next, boat.id, destination.location);
  next.entities[boat.id].properties.lastPulledTo = destination.id;
  return { world: next, outcome: "done", reason: `${rope.name}을(를) 당겨 ${boat.name}을(를) ${destination.name}까지 옮겼어요.` };
}

export const RAIN_BOATS: SegmentDefinition = {
  id: "02-4",
  title: "서로 묶인 배",
  goal: "문 무게추와 용사를 서로 과적하지 않고 건너편으로 보내 문 받침을 누르기",
  description: "두 배의 용량은 각각 1입니다. 짧은 밧줄은 배 두 척 또는 인접 고정점을, 긴 밧줄은 건너편 도르래까지 연결할 수 있어요.",
  hints: [
    "두 배의 적재선, 밧줄 길이 원호, 가운데 바위 고리를 비교해 보세요.",
    "하중을 두 배에 나누거나, 화물 배와 용사 배를 서로 다른 운반 관계로 보낼 수 있어요.",
    "두 배를 짧은 밧줄로 묶어 문 무게추와 용사를 나눠 싣거나, 무게추를 실은 배는 긴 도르래로 보내고 빈 배는 바위 고리를 이어 써.",
  ],
  enter: () => makeWorld(2, "02-4", [
    makeEntity("boats-dock", "시작 선착장", "02-4", 0, { material: "stone", reach: 2, properties: { kind: "platform", safe: true } }),
    makeEntity("boat-striped", "세로 줄무늬 작은 배", "02-4", 1, { material: "wood", movable: true, weight: 1, capacity: 1, reach: 2, properties: { kind: "boat", slot: "large", boardable: true, buoyant: true, afloat: true, loadMark: 1, tiePoint: true, tipped: false } }),
    makeEntity("boat-dotted", "점무늬 작은 배", "02-4", 1, { material: "wood", movable: true, weight: 1, capacity: 1, reach: 2, properties: { kind: "boat", slot: "large", boardable: true, buoyant: true, afloat: true, loadMark: 1, tiePoint: true, tipped: false } }),
    makeEntity("boat-door-weight", "문 무게추", "02-4", 0, { material: "stone", movable: true, weight: 1, capacity: 0, reach: 2, properties: { kind: "weight", slot: "large", load: 1 } }),
    makeEntity("boat-short-rope", "한 매듭 짧은 밧줄", "02-4", 0, { description: "한 매듭 · 길이 3칸 · 적재 눈금에 영향을 주지 않는 가벼운 밧줄", material: "cloth", movable: true, weight: 0, reach: 3, properties: { kind: "rope", tool: "rope", ropeLength: 3, knots: 1, slot: "small" } }),
    makeEntity("boat-long-rope", "세 매듭 긴 밧줄", "02-4", 0, { description: "세 매듭 · 길이 8칸 · 적재 눈금에 영향을 주지 않는 가벼운 밧줄", material: "cloth", movable: true, weight: 0, reach: 8, properties: { kind: "rope", tool: "rope", ropeLength: 8, knots: 3, slot: "small" } }),
    makeEntity("boat-rock", "가운데 바위 고리", "02-4", 4, { material: "stone", reach: 4, properties: { kind: "anchor", tiePoint: true, fixed: true } }),
    makeEntity("boat-exit-ring", "건너편 배 고리", "02-4", 7, { material: "metal", reach: 4, properties: { kind: "anchor", tiePoint: true, fixed: true } }),
    makeEntity("boat-pulley", "건너편 도르래 고리", "02-4", 8, { material: "metal", reach: 8, properties: { kind: "pulley", tiePoint: true, fixed: true, returnsToStart: true } }),
    makeEntity("boat-current", "출구 방향 물살", "02-4", 4, { material: "water", reach: 8, properties: { kind: "current", direction: "right", flowDistance: 7 } }),
    makeEntity("boat-exit", "건너편 선착장", "02-4", 8, { material: "stone", reach: 2, properties: { kind: "platform", safe: true } }),
    makeEntity("boat-pedestal", "문 무게추 받침", "02-4", 8, { material: "stone", capacity: 1, reach: 2, properties: { kind: "support", requiredWeight: 1 } }),
    makeEntity("boat-door", "출구 문", "02-4", 9, { material: "metal", properties: { kind: "door", open: false } }),
  ]),
  execute: (world, action) => {
    if (crosses(world, action, 1, 8)) return failed(world, "넓은 수로에는 걸어서 디딜 곳이 없어요. 배와 밧줄 관계를 이용해야 해요.");
    const fixedUntie = untieFixed(world, action);
    if (fixedUntie) return fixedUntie;
    const ropePull = pullConnectedBoat(world, action);
    if (ropePull) return ropePull;
    if (action.verb === "tie" && action.destination && action.instrument) {
      const target = world.entities[action.target];
      const destination = world.entities[action.destination];
      const rope = world.entities[action.instrument];
      if (isBoat(target) && destination && rope && (destination.properties.kind === "anchor" || destination.properties.kind === "pulley")) {
        if (distance(target, destination) > rope.reach) return clarification(world, `${rope.name}의 공개 길이가 ${destination.name}까지 닿지 않아요.`);
        return normalizeFixedRope(executePhysicalAction(world, action), target.id, destination.id, rope.id);
      }
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => {
    const next = tick(world);
    const hero = next.actors.hero;
    if (hero.riding) {
      const ridden = next.entities[hero.riding];
      if (isBoat(ridden) && typeof ridden.properties.tiedTo === "string") {
        const peer = next.entities[String(ridden.properties.tiedTo)];
        if (isBoat(peer)) {
          moveEntityTree(next, ridden.id, next.entities["boat-exit"].location);
          moveEntityTree(next, peer.id, next.entities["boat-exit"].location);
          ridden.properties.carriedByCurrent = true;
          peer.properties.carriedByCurrent = true;
        }
      }
    }
    const pedestal = next.entities["boat-pedestal"];
    const weight = next.entities["boat-door-weight"];
    next.entities["boat-door"].properties.open = weight.parent === pedestal.id;
    const canChange = Object.values(next.actors).some((actor) => actor.riding !== null &&
      next.entities[actor.riding!]?.properties.tiedTo !== undefined &&
      next.entities[actor.riding!].location.x < next.entities["boat-exit"].location.x);
    return { world: next, events: [], canChange };
  },
  complete: (world) => at(world, "hero", "boat-exit") && world.actors.hero.riding === null &&
    world.entities["boat-door-weight"].parent === "boat-pedestal" &&
    world.entities["boat-door"].properties.open === true &&
    ["boat-striped", "boat-dotted"].every((id) => world.entities[id].properties.overloaded !== true && world.entities[id].properties.tipped !== true),
};

export const RAIN_ORGAN: SegmentDefinition = {
  id: "02-5",
  title: "빗물 오르간",
  goal: "큰 물레로 문을 든 상태를 실제 받침으로 보존하고, 흐름을 작은 물레로 돌려 떠오르는 발판으로 출구에 닿기",
  description: "물은 물레 하나만 돌립니다. 큰 물레는 문 무게추를 들고, 돌주머니나 물 2칸 통은 힘이 끊긴 뒤에도 문을 받칩니다. 작은 물레는 아래 걸쇠가 풀린 발판을 올려요.",
  hints: [
    "홈통 경로, 무게추 줄 끝 고리, 통 받침 자리의 같은 무게·폭 표시를 살펴보세요.",
    "물의 힘으로 문을 든 뒤 결과를 다른 물체로 고정해야 같은 물을 승강대에 쓸 수 있어요.",
    "큰 물레로 문 무게추를 들고 돌주머니를 끝 고리에 걸거나 채운 통을 문 아래에 둔 뒤, 홈통을 작은 물레로 돌려.",
  ],
  enter: () => makeWorld(2, "02-5", [
    makeEntity("organ-start", "아래층 마른 발판", "02-5", 0, { material: "stone", reach: 2, properties: { kind: "platform", safe: true } }),
    makeEntity("organ-gutter", "세 갈래 긴 홈통", "02-5", 0, { description: "방향 0 배출 · 1 큰 물레 · 2 작은 물레. 유량 1은 한 물레만 작동함.", material: "metal", reach: 8, properties: { kind: "gutter", orientation: 0, route: "drain", routes: "drain|large|small", flow: 1 } }),
    makeEntity("organ-big-wheel", "문 무게추를 드는 큰 물레", "02-5", 2, { material: "wood", properties: { kind: "wheel", requiredFlow: 1, powered: false } }),
    makeEntity("organ-small-wheel", "작은 승강 물레", "02-5", 4, { material: "wood", properties: { kind: "wheel", requiredFlow: 1, powered: false } }),
    makeEntity("organ-counterweight", "출구 문 무게추", "02-5", 3, { material: "stone", movable: false, weight: 1, properties: { kind: "counterweight", raised: false } }),
    makeEntity("organ-hook", "무게추 줄 끝 고리", "02-5", 1, { material: "metal", capacity: 1, reach: 2, properties: { kind: "support", requiredWeight: 1, loweredWhenRaised: true, accessible: false } }),
    makeEntity("organ-stone-bag", "같은 무게 돌주머니", "02-5", 0, { material: "cloth", movable: true, weight: 1, reach: 2, properties: { kind: "weight", slot: "small", markedWeight: 1 } }),
    makeEntity("organ-water-source", "두 칸 수도", "02-5", 0, { material: "water", capacity: 2, properties: { kind: "source", amount: 2, fluidDensity: 1, marks: "1|2" } }),
    makeEntity("organ-barrel", "중간 선반의 빈 통", "02-5", 0, { material: "wood", movable: true, weight: 1, capacity: 2, reach: 2, properties: { kind: "container", slot: "large", amount: 0, fluidDensity: 1, requiredAmount: 2, baseShape: "semicircle" } }),
    makeEntity("organ-door-socket", "문 아래 반원 받침 자리", "02-5", 1, { material: "stone", capacity: 3, reach: 2, properties: { kind: "support", shape: "semicircle", dry: true, accessible: false } }),
    makeEntity("organ-lift", "아래층 떠오르는 발판", "02-5", 0, { material: "cork", movable: false, capacity: 1, reach: 2, properties: { kind: "lift", boardable: true, buoyant: true, level: 0, exitLevel: 1, lowerLatch: true, powered: false } }),
    makeEntity("organ-door", "들어 올리는 출구 문", "02-5", 6, { material: "metal", properties: { kind: "door", open: false, supported: false } }),
    makeEntity("organ-exit", "위층 출구", "02-5", 6, { material: "stone", reach: 2, properties: { kind: "platform", safe: true, level: 1 } }),
    makeEntity("organ-net", "승강대 아래 안전망", "02-5", 3, { material: "cloth", properties: { kind: "net", safe: true } }),
  ]),
  execute: (world, action) => {
    if (crosses(world, action, 0, 6)) return failed(world, "세 층 사이에는 걸어서 건널 길이 없어요. 떠오르는 발판을 이용해야 해요.");
    if (action.verb === "place" && action.target === "organ-stone-bag" && action.destination === "organ-hook" && world.entities["organ-hook"].properties.accessible !== true) {
      return clarification(world, "문 무게추가 올라가야 줄 끝 고리가 손 높이까지 내려와요.");
    }
    if (action.verb === "place" && action.target === "organ-barrel" && action.destination === "organ-door-socket" && world.entities["organ-door-socket"].properties.accessible !== true) {
      return clarification(world, "문이 올라가야 마른 반원 받침 자리에 통을 밀어 넣을 수 있어요.");
    }
    const result = executePhysicalAction(world, action);
    if (result.outcome !== "done") return result;
    if (action.verb === "board" && action.target === "organ-lift") {
      const next = structuredClone(result.world);
      next.entities["organ-lift"].properties.lowerLatch = false;
      return { world: next, outcome: "done", reason: "떠오르는 발판에 올라 아래 걸쇠를 풀었어요." };
    }
    return result;
  },
  advance: (world) => {
    const next = tick(world);
    const gutter = next.entities["organ-gutter"];
    const orientation = ((Number(gutter.properties.orientation) % 3) + 3) % 3;
    const route = orientation === 1 ? "large" : orientation === 2 ? "small" : "drain";
    gutter.properties.route = route;
    const big = next.entities["organ-big-wheel"];
    const small = next.entities["organ-small-wheel"];
    big.properties.powered = route === "large";
    small.properties.powered = route === "small";

    const counterweight = next.entities["organ-counterweight"];
    counterweight.properties.raised = big.properties.powered === true;
    next.entities["organ-hook"].properties.accessible = counterweight.properties.raised;
    const bagLatched = currentLoad(next, "organ-hook") === Number(next.entities["organ-hook"].properties.requiredWeight);
    const barrel = next.entities["organ-barrel"];
    const barrelSupported = barrel.parent === "organ-door-socket" && Number(barrel.properties.amount) === Number(barrel.properties.requiredAmount);
    const supported = bagLatched || barrelSupported;
    const door = next.entities["organ-door"];
    door.properties.supported = supported;
    door.properties.supportMethod = bagLatched ? "counterweight" : barrelSupported ? "water-barrel" : "none";
    door.properties.open = counterweight.properties.raised === true || supported;
    next.entities["organ-door-socket"].properties.accessible = door.properties.open;

    if (route === "small" && !supported) {
      return { world: next, events: [], canChange: false, failure: "큰 물레의 힘을 끊기 전에 문을 받치지 않아 문 무게추가 내려오고 출구가 다시 닫혔어요." };
    }

    const lift = next.entities["organ-lift"];
    lift.properties.powered = small.properties.powered;
    if (small.properties.powered === true && lift.properties.lowerLatch === false && Number(lift.properties.level) < Number(lift.properties.exitLevel)) {
      lift.properties.level = Number(lift.properties.exitLevel);
      moveEntityTree(next, lift.id, next.entities["organ-exit"].location);
    }
    return { world: next, events: [], canChange: false };
  },
  complete: (world) => at(world, "hero", "organ-exit") && world.actors.hero.riding === null &&
    world.entities["organ-door"].properties.open === true &&
    world.entities["organ-door"].properties.supported === true &&
    world.entities["organ-gutter"].properties.route === "small" &&
    world.entities["organ-lift"].properties.level === world.entities["organ-lift"].properties.exitLevel,
};
