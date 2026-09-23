import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../../../src/campaign/level";
import { executePhysicalAction } from "../../../src/campaign/physics";
import type { ActionResult } from "../../../src/campaign/program";
import type { Entity, PhysicalAction, Scalar, WorldState } from "../../../src/campaign/types";

const STAGE_ID = 4 as const;

function entity(
  id: string,
  name: string,
  region: string,
  x: number,
  properties: Record<string, Scalar>,
  patch: Partial<Entity> = {},
): Entity {
  return makeEntity(id, name, region, x, {
    description: name,
    reach: 2,
    properties,
    ...patch,
  });
}

function clone(state: WorldState): WorldState {
  return structuredClone(state);
}

function result(state: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult {
  return { world: state, outcome, reason };
}

function failure(state: WorldState, reason: string): ActionResult {
  return result(clone(state), "failure", reason);
}

function blocked(state: WorldState, reason: string): ActionResult {
  return result(state, "blocked", reason);
}

function moved(action: PhysicalAction): boolean {
  return action.verb === "move" || action.verb === "jump" || action.verb === "duck";
}

function crossesX(state: WorldState, action: PhysicalAction, x: number): boolean {
  if (!moved(action)) return false;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  return !!actor && !!target && actor.location.region === target.location.region
    && actor.location.x < x && target.location.x >= x;
}

function pathIntersects(state: WorldState, action: PhysicalAction, from: number, to: number): boolean {
  if (!moved(action)) return false;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return false;
  return Math.min(actor.location.x, target.location.x) < to && Math.max(actor.location.x, target.location.x) >= from;
}

/**
 * 04-4 is one encounter, but its cause chain spans separate physical rooms.
 * Keep the legacy region/segment ID while persisting each doorway and bridge
 * edge as an atomic movement boundary.
 */
const WIND_BRIDGE_STOPS = [0, 3, 5, 7, 10] as const;

function windBridgeStep(state: WorldState, action: PhysicalAction): number | null {
  if (!moved(action)) return null;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return null;
  const direction = Math.sign(target.location.x - actor.location.x);
  if (direction === 0) return null;
  const nextStop = direction > 0
    ? WIND_BRIDGE_STOPS.find((x) => x > actor.location.x && x <= target.location.x)
    : [...WIND_BRIDGE_STOPS].reverse().find((x) => x < actor.location.x && x >= target.location.x);
  return Math.abs((nextStop ?? target.location.x) - actor.location.x);
}

function windBridgeAtomicPathIntersects(state: WorldState, action: PhysicalAction, from: number, to: number): boolean {
  const actor = state.actors[action.actor];
  const step = windBridgeStep(state, action);
  if (!actor || step === null) return false;
  const target = state.entities[action.target];
  if (!target) return false;
  const nextX = actor.location.x + Math.sign(target.location.x - actor.location.x) * step;
  return Math.min(actor.location.x, nextX) < to && Math.max(actor.location.x, nextX) >= from;
}

function moveTree(state: WorldState, id: string, location: Entity["location"], seen = new Set<string>()): void {
  if (seen.has(id)) return;
  seen.add(id);
  const target = state.entities[id];
  if (!target) return;
  target.location = { ...location };
  for (const child of Object.values(state.entities)) {
    if (child.parent === id) moveTree(state, child.id, location, seen);
  }
  for (const actor of Object.values(state.actors)) {
    if (actor.riding !== id) continue;
    actor.location = { ...location };
    for (const carried of actor.carrying) moveTree(state, carried, location, seen);
  }
}

function carryWorld(segmentId: string, current: Entity[], previous: WorldState | null, heroX = 0): WorldState {
  const retained = previous ? Object.values(previous.entities).map((item) => cloneEntity(item)) : [];
  const byId = new Map(retained.map((item) => [item.id, item]));
  for (const item of current) byId.set(item.id, item);
  const hero = makeHero(segmentId, heroX);
  hero.carrying = previous?.actors.hero?.carrying.filter((id) => byId.has(id)) ?? [];
  const state = makeWorld(STAGE_ID, segmentId, [...byId.values()], hero);
  for (const item of Object.values(state.entities)) {
    if (item.parent === "hero" && !hero.carrying.includes(item.id)) item.parent = null;
  }
  for (const id of hero.carrying) {
    state.entities[id].parent = "hero";
    moveTree(state, id, hero.location);
  }
  state.visible = [...new Set([
    ...current.map((item) => item.id),
    ...retained.filter((item) => item.properties.causeMapVisible === true).map((item) => item.id),
    ...hero.carrying,
  ])];
  return state;
}

function cloneEntity(item: Entity): Entity {
  return structuredClone(item);
}

function ensureCurrentRegion(state: WorldState, action: PhysicalAction): ActionResult | null {
  if (!moved(action)) return null;
  const target = state.entities[action.target];
  if (target && target.location.region !== state.segmentId) {
    return result(state, "clarification", "출구 뒤 원인 지도는 이전 장치의 상태만 보여 줘요. 지난 방으로 순간이동할 수는 없어요.");
  }
  return null;
}

function advanceTick(state: WorldState): WorldState {
  const next = clone(state);
  next.tick += 1;
  return next;
}

function furnace(open: boolean, region = "04-1"): Entity {
  return entity("forge-furnace", "서쪽 화덕", region, 1, {
    kind: "furnace", open, latched: open, latchMark: open ? "moon-fixed" : "unfixed",
    suppliesWind: open, causeMapVisible: true,
  });
}

const practice: SegmentDefinition = {
  id: "04-practice",
  title: "작은 풍차와 바람판",
  goal: "바람판을 돌린 뒤 손을 떼도 한쪽 깃발에만 바람이 이어지는지 확인하기",
  description: "작은 풍차, 동·서 바람판, 두 깃발만 있는 본편과 분리된 무료 모형입니다.",
  hints: [
    "바람판의 화살표와 두 깃발의 정지·펄럭임 표시를 보세요.",
    "바람판 방향은 남고, 바람은 선택된 관으로만 흐릅니다.",
    "바람판을 돌린 뒤 반대편 관찰점으로 이동해 펄럭이는 깃발을 확인하세요.",
  ],
  enter: () => carryWorld("04-practice", [
    entity("forge-practice-start", "모형 관찰점", "04-practice", 0, { safe: true }),
    entity("forge-practice-wheel", "작은 풍차", "04-practice", 1, { powered: true, spinning: true }),
    entity("forge-practice-splitter", "두 방향 바람판", "04-practice", 1, { orientation: 0, route: "west", routes: "west|east", fixedDirection: true }),
    entity("forge-practice-west", "서쪽 깃발", "04-practice", 2, { fluttering: true, route: "west" }, { material: "cloth" }),
    entity("forge-practice-east", "동쪽 깃발", "04-practice", 2, { fluttering: false, route: "east" }, { material: "cloth" }),
    entity("forge-practice-view", "반대편 관찰점", "04-practice", 3, { safe: true }),
  ], null),
  execute: (state, action) => executePhysicalAction(state, action),
  advance: (state) => {
    const next = advanceTick(state);
    const splitter = next.entities["forge-practice-splitter"];
    const route = Number(splitter.properties.orientation) % 2 === 0 ? "west" : "east";
    splitter.properties.route = route;
    next.entities["forge-practice-west"].properties.fluttering = route === "west";
    next.entities["forge-practice-east"].properties.fluttering = route === "east";
    return { world: next, events: [], canChange: false };
  },
  complete: () => false,
};

const openFurnace: SegmentDefinition = {
  id: "04-1",
  title: "열린 화덕",
  goal: "서쪽 화덕을 물리 걸쇠에 고정한 채 다음 방 문을 통과하기",
  description: "레버의 끝 눈금, 큰 걸쇠, 열린 덮개, 달 고정 문양과 투명 공급 관이 한 화면에 보입니다.",
  hints: [
    "레버의 끝 눈금과 걸쇠가 맞물리는 위치를 보세요.",
    "잠깐 당긴 힘과 걸쇠에 저장된 열린 상태는 달라요.",
    "손잡이를 끝까지 당겨 걸쇠에 건 뒤 열린 화덕을 남기고 출구로 가세요.",
  ],
  enter: () => carryWorld("04-1", [
    entity("04-1-start", "안전 난간", "04-1", 0, { safe: true }),
    entity("04-1-lever", "서쪽 화덕 손잡이", "04-1", 1, { slot: "large", pullFraction: 0, endMark: 1 }, { movable: true }),
    entity("04-1-latch", "화덕 큰 걸쇠", "04-1", 1, { acceptsLever: true, locked: false }),
    furnace(false),
    entity("04-1-vane", "공급 바람개비", "04-1", 2, { spinning: false }),
    entity("04-1-pipe", "다음 방으로 가는 투명 관", "04-1", 3, { connectedFrom: "forge-furnace", flowing: false }),
    entity("04-1-door", "다음 방 문", "04-1", 4, { open: false }),
    entity("04-1-exit", "다음 방 안전턱", "04-1", 5, { safe: true }),
  ], null),
  execute: (state, action) => {
    if (crossesX(state, action, 4) && state.entities["forge-furnace"].properties.latched !== true) {
      return blocked(state, "화덕 덮개가 걸쇠에 고정되지 않아 다음 방 바람이 멈췄어요.");
    }
    if (action.verb === "pull" && action.target === "04-1-lever") {
      if (action.destination !== "04-1-latch") return result(state, "clarification", "레버를 어느 끝 위치까지 당길지 큰 걸쇠를 지정해 주세요.");
      if ((action.amount ?? 1) < 1) {
        const next = clone(state);
        next.entities["04-1-lever"].properties.pullFraction = action.amount ?? 0.5;
        next.entities["04-1-latch"].properties.locked = false;
        return result(next, "done", "레버가 끝 눈금 전에 멈춰 아직 걸쇠에 닿지 않았어요.");
      }
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["04-1-lever"].properties.pullFraction = 1;
      physical.world.entities["04-1-latch"].properties.locked = true;
      return result(physical.world, "done", "레버 끝이 큰 걸쇠에 물려 힘을 놓아도 열린 상태가 남아요.");
    }
    return executePhysicalAction(state, action);
  },
  advance: (state) => {
    const next = advanceTick(state);
    const locked = next.entities["04-1-latch"].properties.locked === true;
    const lever = next.entities["04-1-lever"];
    if (!locked) lever.properties.pullFraction = 0;
    const source = next.entities["forge-furnace"];
    source.properties.open = locked;
    source.properties.latched = locked;
    source.properties.suppliesWind = locked;
    source.properties.latchMark = locked ? "moon-fixed" : "unfixed";
    next.entities["04-1-vane"].properties.spinning = locked;
    next.entities["04-1-pipe"].properties.flowing = locked;
    next.entities["04-1-door"].properties.open = locked;
    return { world: next, events: [], canChange: false };
  },
  idleAction: (state) => state.entities["04-1-door"].properties.open === true
    && state.entities["forge-furnace"].properties.latched === true
    && !at(state, "hero", "04-1-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "04-1-exit" }
    : null,
  complete: (state) => at(state, "hero", "04-1-exit")
    && state.entities["forge-furnace"].properties.open === true
    && state.entities["forge-furnace"].properties.latched === true,
};

function forgeTwo(previous: WorldState | null): WorldState {
  const source = previous?.entities["forge-furnace"] ? [] : [furnace(true)];
  return carryWorld("04-2", [
    ...source,
    entity("04-2-start", "바람판 앞 안전 공간", "04-2", 0, { safe: true }),
    entity("04-2-inlet", "앞 방에서 오는 바람관", "04-2", 0, { connectedFrom: "forge-furnace", flowing: true }),
    hammerSplitter(),
    entity("04-2-hammer", "자동 망치", "04-2", 3, { powered: false, cycling: false, requiredHits: 3, dangerStart: 2, dangerEnd: 5 }),
    entity("04-2-anvil", "망치 아래 모루", "04-2", 3, { capacity: 2, station: "hammer" }),
    entity("04-2-plate", "부드러운 금속판", "04-2", 3, { slot: "large", soft: true, stampHits: 0, starStamp: "none", holdable: true, heldWith: "" }, { movable: true, parent: "04-2-anvil" }),
    entity("04-2-side-rail", "옆으로 빼는 받침", "04-2", 4, { capacity: 2, outsideHammerRange: true }),
    entity("04-2-tongs", "긴 집게", "04-2", 0, { slot: "small", tool: "tongs", safeHandle: true }, { material: "metal", movable: true, weight: 0.2, reach: 5 }),
    entity("04-2-service", "난간 밖 옆길", "04-2", 5, { safe: true, outsideHammerRange: true }),
    entity("04-2-pedestal", "별 문양 출구 발판", "04-2", 7, { capacity: 2, acceptsShape: "star" }, { reach: 2 }),
    entity("04-2-door", "별 문양 잠금문", "04-2", 8, { open: false }),
    entity("04-2-exit", "예열 관 앞 안전턱", "04-2", 8, { safe: true }),
  ], previous);
}

function hammerSplitter(): Entity {
  return entity("04-2-splitter", "망치·옆길 바람판", "04-2", 1, {
    orientation: 0, route: "bypass", routes: "bypass|hammer", causeMapVisible: true,
  });
}

const hammerTransfer: SegmentDefinition = {
  id: "04-2",
  title: "반대편의 망치",
  goal: "금속판에 세 번 타격한 별 문양을 남겨 출구 발판에 놓고 안전하게 통과하기",
  description: "바람관, 바람판, 세 칸 타격 눈금, 옆으로 빼는 받침과 긴 집게의 범위가 모두 보입니다.",
  hints: [
    "망치의 세 칸 타격 눈금과 옆으로 빼는 받침을 보세요.",
    "세 번째 타격 결과는 바람을 우회해도 금속판에 남습니다.",
    "세 번 찍고 망치를 우회시키거나 긴 집게로 판을 옆 레일에 빼서 별 발판으로 옮기세요.",
  ],
  enter: forgeTwo,
  execute: (state, action) => {
    const wrongRegion = ensureCurrentRegion(state, action);
    if (wrongRegion) return wrongRegion;
    const hammerOn = state.entities["04-2-hammer"].properties.powered === true;
    if (crossesX(state, action, 8) && state.entities["04-2-door"].properties.open !== true) {
      return blocked(state, "별 문양 금속판이 출구 발판의 물리 홈을 누르기 전에는 잠금문을 통과할 수 없어요.");
    }
    const actorAtService = at(state, action.actor, "04-2-service");
    const targetX = state.entities[action.target]?.location.x;
    const entersHammerPath = pathIntersects(state, action, 2, 5)
      && action.target !== "04-2-service"
      && !(actorAtService && targetX !== undefined && targetX >= 5);
    if (hammerOn && entersHammerPath) {
      return failure(state, "왕복 중인 망치의 주 통로에 들어가 실제 타격 범위에 부딪혔어요.");
    }
    if (action.verb === "place" && action.target === "04-2-plate" && action.destination === "04-2-pedestal"
      && state.entities["04-2-plate"].properties.starStamp !== "complete") {
      return failure(state, "두 칸 이하로 찍힌 반쪽 문양은 별 발판의 물리 홈과 맞지 않아요.");
    }
    if ((action.verb === "pull" || action.verb === "push") && action.target === "04-2-plate" && hammerOn
      && action.destination !== "04-2-side-rail") {
      return failure(state, "움직이는 망치 아래에서 금속판을 주 통로로 당겨 실제 압착 범위에 걸렸어요.");
    }
    if (action.verb === "pull" && action.target === "04-2-plate" && action.destination === "04-2-side-rail") {
      const plate = state.entities["04-2-plate"];
      if (hammerOn && (state.actors[action.actor].holding !== plate.id || plate.properties.heldWith !== "04-2-tongs")) {
        return result(state, "clarification", "망치 밖 받침에는 긴 집게로 판을 잡아당겨야 손이 닿아요.");
      }
      if (state.actors[action.actor].holding === plate.id && plate.properties.heldWith === "04-2-tongs") {
        const next = clone(state);
        next.entities[plate.id].parent = null;
        next.entities[plate.id].location = { ...next.entities["04-2-side-rail"].location };
        next.entities[plate.id].properties.transportRoute = "service";
        return result(next, "done", "긴 집게가 닿는 거리만큼 금속판을 망치 밖 옆 받침까지 당겼어요.");
      }
    }
    const physical = executePhysicalAction(state, action);
    if (physical.outcome !== "done") return physical;
    const next = physical.world;
    if (action.verb === "turn" && action.target === "04-2-splitter") {
      const splitter = next.entities["04-2-splitter"];
      splitter.properties.route = Number(splitter.properties.orientation) % 2 === 0 ? "bypass" : "hammer";
    }
    if ((action.verb === "pull" || action.verb === "push") && action.target === "04-2-plate" && action.destination === "04-2-side-rail") {
      next.entities["04-2-plate"].properties.transportRoute = "service";
    }
    if (action.verb === "place" && action.target === "04-2-plate" && action.destination === "04-2-pedestal") {
      next.entities["04-2-door"].properties.open = true;
    }
    return physical;
  },
  advance: (state) => {
    const next = advanceTick(state);
    const supplied = next.entities["forge-furnace"]?.properties.open === true;
    const splitter = next.entities["04-2-splitter"];
    const hammer = next.entities["04-2-hammer"];
    const powered = supplied && splitter.properties.route === "hammer";
    hammer.properties.powered = powered;
    hammer.properties.cycling = powered;
    next.entities["04-2-inlet"].properties.flowing = supplied;
    const plate = next.entities["04-2-plate"];
    if (powered && plate.parent === "04-2-anvil") {
      const hits = Math.min(3, Number(plate.properties.stampHits) + 1);
      plate.properties.stampHits = hits;
      plate.properties.starStamp = hits === 3 ? "complete" : hits === 0 ? "none" : "partial";
    }
    return { world: next, events: [], canChange: powered };
  },
  idleAction: (state) => state.entities["04-2-door"].properties.open === true
    && state.entities["04-2-plate"].parent === "04-2-pedestal"
    && state.entities["04-2-plate"].properties.starStamp === "complete"
    && !at(state, "hero", "04-2-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "04-2-exit" }
    : null,
  complete: (state) => at(state, "hero", "04-2-exit")
    && state.entities["04-2-plate"].parent === "04-2-pedestal"
    && state.entities["04-2-plate"].properties.starStamp === "complete"
    && state.entities["04-2-door"].properties.open === true,
};

function forgeThree(previous: WorldState | null): WorldState {
  const source = previous?.entities["forge-furnace"] ? [] : [furnace(true)];
  const splitter = previous?.entities["04-2-splitter"] ? [] : [hammerSplitter()];
  return carryWorld("04-3", [
    ...source,
    ...splitter,
    entity("04-3-start", "열기 관찰 자리", "04-3", 0, { safe: true }),
    entity("04-3-preheat", "앞 방에서 오는 열기관", "04-3", 1, { flowing: true, heatMarks: 3 }),
    entity("04-3-damper", "열기 차단판", "04-3", 0, { open: true, controls: "04-3-preheat", cutoffState: "heat-on", handleVisible: true }),
    entity("04-3-cooling-valve", "찬 바람 손잡이", "04-3", 0, { on: false, route: "closed", routes: "closed|cold-nozzle" }),
    entity("04-3-nozzle", "눈꽃 찬 바람 구멍", "04-3", 2, { powered: false, coolingPerTick: 1, reachArc: 2 }),
    entity("04-3-key", "뜨거운 반달 쇳조각", "04-3", 2, {
      slot: "large", temperature: 3, heatState: "hot", heatMarks: 3, width: 2, cooledWidth: 1,
      moonMark: false, holdable: true, heldWith: "", coolingMethod: "none",
    }, { movable: true }),
    entity("04-3-grille", "손으로 쓰는 식힘판", "04-3", 3, {
      capacity: 2, passiveCooling: true, coolingPerTick: 1, requiresHeatCutoff: true,
      grilleOpenings: "dry-air", visibleFunction: "cools-when-damper-closed",
    }),
    entity("04-3-tongs", "긴 방열 집게", "04-3", 0, { slot: "small", tool: "tongs", safeHandle: true }, { movable: true, weight: 0.2, reach: 4 }),
    entity("04-3-wide-outline", "뜨거울 때 크기 표시", "04-3", 5, { width: 2, fitsWhen: "hot" }),
    entity("04-3-lock", "좁은 자물쇠 홈", "04-3", 6, { capacity: 2, apertureWidth: 1, open: false }),
    entity("04-3-exit", "찬 자물쇠 뒤 출구", "04-3", 7, { safe: true }),
  ], previous);
}

function heldWithTongs(state: WorldState, workpiece: string, tongs: string): boolean {
  const actor = state.actors.hero;
  return actor.holding === workpiece && state.entities[workpiece]?.properties.heldWith === tongs;
}

const coolingKey: SegmentDefinition = {
  id: "04-3",
  title: "뜨거운 열쇠, 차가운 자물쇠",
  goal: "반달 쇳조각을 달 문양의 좁은 크기로 식혀 자물쇠 홈에 넣기",
  description: "열기 차단판과 손으로 쓰는 식힘판의 냉각 조건, 온도 세 칸, 뜨거울 때와 식었을 때의 크기가 모두 보입니다.",
  hints: [
    "좁은 홈과 식었을 때 크기 표시, 열기 차단판과 식힘판의 표시를 비교하세요.",
    "찬 바람을 직접 보내거나 열원을 끊고 마른 격자에서 수동 방열할 수 있어요.",
    "찬 바람 구멍으로 달 문양까지 식히거나 열기 차단판을 닫고 식힘판에서 식힌 뒤 좁은 홈에 넣으세요.",
  ],
  enter: forgeThree,
  execute: (state, action) => {
    const wrongRegion = ensureCurrentRegion(state, action);
    if (wrongRegion) return wrongRegion;
    const key = state.entities["04-3-key"];
    const hot = Number(key.properties.temperature) > 0;
    if (crossesX(state, action, 7) && state.entities["04-3-lock"].properties.open !== true) {
      return blocked(state, "좁은 자물쇠 홈이 열리지 않아 닫힌 문을 지나갈 수 없어요.");
    }
    if (action.target === key.id && hot && action.verb === "take") {
      return failure(state, "뜨거운 쇳조각을 맨손으로 들자 열 문양과 화상 연기가 나타났어요. 안전 손잡이 집게가 필요해요.");
    }
    if (action.target === key.id && hot && (action.verb === "push" || action.verb === "pull" || action.verb === "place")
      && !heldWithTongs(state, key.id, "04-3-tongs")) {
      return failure(state, "뜨거운 쇳조각을 맨손으로 옮겨 열 문양이 손에 닿았어요. 긴 집게로 먼저 잡아야 해요.");
    }
    if (action.verb === "place" && action.target === key.id && action.destination === "04-3-lock"
      && Number(key.properties.width) > Number(state.entities["04-3-lock"].properties.apertureWidth)) {
      const next = clone(state);
      next.entities["04-3-key"].properties.jammedOutline = "too-wide";
      return result(next, "failure", "뜨거운 크기가 좁은 자물쇠 홈보다 넓어 중간에서 실제로 걸렸어요.");
    }
    if (action.verb === "pull" && action.target === key.id && action.destination === "04-3-grille"
      && heldWithTongs(state, key.id, "04-3-tongs")) {
      const next = clone(state);
      next.entities[key.id].parent = null;
      next.entities[key.id].location = { ...next.entities["04-3-grille"].location };
      next.entities[key.id].properties.coolingMethod = "passive-grille";
      return result(next, "done", "긴 방열 집게로 쇳조각을 식힘판에 올렸어요.");
    }
    const physical = executePhysicalAction(state, action);
    if (physical.outcome !== "done") return physical;
    const next = physical.world;
    if (action.verb === "turn" && action.target === "04-3-cooling-valve") {
      next.entities["04-3-cooling-valve"].properties.route = next.entities["04-3-cooling-valve"].properties.on === true ? "cold-nozzle" : "closed";
    }
    if ((action.verb === "pull" || action.verb === "push") && action.target === key.id && action.destination === "04-3-grille") {
      next.entities["04-3-key"].properties.coolingMethod = "passive-grille";
    }
    if (action.verb === "place" && action.target === key.id && action.destination === "04-3-lock") {
      next.entities["04-3-lock"].properties.open = true;
    }
    return physical;
  },
  advance: (state) => {
    const next = advanceTick(state);
    const key = next.entities["04-3-key"];
    const nozzleOn = next.entities["04-3-cooling-valve"].properties.on === true;
    const damperOpen = next.entities["04-3-damper"].properties.open === true;
    next.entities["04-3-preheat"].properties.flowing = damperOpen;
    next.entities["04-3-damper"].properties.cutoffState = damperOpen ? "heat-on" : "heat-cut-off";
    next.entities["04-3-nozzle"].properties.powered = nozzleOn;
    const onGrille = key.location.x === next.entities["04-3-grille"].location.x;
    const cooling = nozzleOn || (onGrille && !damperOpen);
    if (cooling && Number(key.properties.temperature) > 0) {
      key.properties.temperature = Number(key.properties.temperature) - 1;
      key.properties.coolingMethod = nozzleOn ? "cold-nozzle" : "passive-grille";
    }
    if (damperOpen && !nozzleOn && !onGrille && Number(key.properties.temperature) < 3 && key.parent !== "04-3-lock") {
      key.properties.temperature = Math.min(3, Number(key.properties.temperature) + 1);
    }
    const temperature = Number(key.properties.temperature);
    key.properties.heatMarks = temperature;
    key.properties.heatState = temperature === 0 ? "cool" : "hot";
    key.properties.width = temperature === 0 ? Number(key.properties.cooledWidth) : 2;
    key.properties.moonMark = temperature === 0;
    return { world: next, events: [], canChange: cooling };
  },
  idleAction: (state) => state.entities["04-3-lock"].properties.open === true
    && state.entities["04-3-key"].parent === "04-3-lock"
    && state.entities["04-3-key"].properties.temperature === 0
    && !at(state, "hero", "04-3-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "04-3-exit" }
    : null,
  complete: (state) => at(state, "hero", "04-3-exit")
    && state.entities["04-3-key"].parent === "04-3-lock"
    && state.entities["04-3-key"].properties.temperature === 0
    && state.entities["04-3-lock"].properties.open === true,
};

const windBridge: SegmentDefinition = {
  id: "04-4",
  title: "두 방 뒤의 바람",
  goal: "바람으로 잠금핀을 뺀 뒤 공급을 낮추거나 사슬로 고정한 다리를 건너기",
  description: "첫 압력방, 중간 바람방, 현재 다리방이 큰 바람관으로 이어집니다. 압력 한·두·세 칸, 배출구, 남는 잠금핀, 다리 끝 고리와 무거운 모루가 보입니다.",
  hints: [
    "잠금핀은 충분 이상의 압력에서 빠지고 빠진 상태는 남아요.",
    "배출구는 공급을 한 단계 낮추고, 고정 사슬은 다리의 움직임 자체를 막아요.",
    "충분 압력으로 핀을 뺀 뒤 배출하거나, 과한 압력에서도 다리 끝을 모루추에 사슬로 고정하세요.",
  ],
  enter: (previous) => carryWorld("04-4", [
    entity("04-4-start", "압력추 앞 안전 공간", "04-4", 0, { safe: true, zone: "upstream-pressure-room" }),
    entity("04-4-pressure", "세 칸 압력추", "04-4", 0, { orientation: 0, pressure: 0, marks: "low|enough|excessive", causeMapVisible: true, zone: "upstream-pressure-room", connectedTo: "04-4-main-pipe" }),
    entity("04-4-main-pipe", "세 방을 잇는 큰 바람관", "04-4", 2, { connectedFrom: "04-4-pressure", through: "04-4-splitter", connectedTo: "04-4-pin|04-4-bridge", effectivePressure: 0, zonePath: "upstream-pressure-room|routing-room|bridge-room" }),
    entity("04-4-routing-room", "중간 바람방 안전 통로", "04-4", 3, { safe: true, zone: "routing-room" }),
    entity("04-4-splitter", "중간 바람방 방향판", "04-4", 3, { route: "bridge", routes: "bridge", fixedDirection: true, connectedFrom: "04-4-main-pipe", connectedTo: "04-4-pin|04-4-bridge", zone: "routing-room" }),
    entity("04-4-approach", "다리 앞 안전 공간", "04-4", 5, { safe: true, zone: "bridge-room" }),
    entity("04-4-vent", "현재 방 배출구", "04-4", 5, { open: false, pressureReduction: 1, connectedTo: "04-4-main-pipe", zone: "bridge-room" }),
    entity("04-4-chain", "고정 사슬", "04-4", 5, { slot: "small", tool: "rope", chainLinks: 3, zone: "bridge-room" }, { material: "metal", movable: true, weight: 0.5, reach: 3 }),
    entity("04-4-anvil-weight", "무거운 모루", "04-4", 5, { tiePoint: true, fixed: true, weightMark: 3, zone: "bridge-room" }, { material: "stone", weight: 3 }),
    entity("04-4-pin", "떠오르는 다리 잠금핀", "04-4", 6, { released: false, releasesAtPressure: 1, staysReleased: true, connectedFrom: "04-4-splitter", zone: "bridge-room" }),
    entity("04-4-bridge-end", "다리 끝 고리", "04-4", 7, { tiePoint: true, zone: "bridge-room" }),
    entity("04-4-bridge", "떠오르는 다리", "04-4", 7, { extended: false, stability: "folded", pressure: 0, safeToCross: false, connectedFrom: "04-4-splitter", zone: "bridge-room" }, { material: "wood" }),
    entity("04-4-net", "다리 아래 안전망", "04-4", 7, { catchesFall: true, safe: true, zone: "bridge-room" }, { material: "cloth" }),
    entity("04-4-exit", "다리 건너 출구", "04-4", 10, { safe: true, zone: "bridge-room" }),
  ], previous),
  execute: (state, action) => {
    const wrongRegion = ensureCurrentRegion(state, action);
    if (wrongRegion) return wrongRegion;
    if (windBridgeAtomicPathIntersects(state, action, 6, 10)) {
      const bridge = state.entities["04-4-bridge"];
      if (bridge.properties.extended !== true) return failure(state, "낮은 바람으로 잠금핀이 남아 다리 판이 펼쳐지지 않았어요.");
      if (bridge.properties.safeToCross !== true) return failure(state, "고정되지 않은 다리가 강한 바람에 뒤집혀 아래 안전망으로 떨어졌어요.");
    }
    const step = windBridgeStep(state, action);
    const physical = step === null ? executePhysicalAction(state, action) : executePhysicalAction(state, action, { movementStep: step });
    if (physical.outcome !== "done") return physical;
    if (action.verb === "turn" && action.target === "04-4-pressure") {
      const pressure = physical.world.entities["04-4-pressure"];
      pressure.properties.orientation = Math.min(2, Number(pressure.properties.orientation));
      pressure.properties.pressure = Number(pressure.properties.orientation);
    }
    return physical;
  },
  advance: (state) => {
    const next = advanceTick(state);
    const base = Number(next.entities["04-4-pressure"].properties.pressure);
    const effective = Math.max(0, base - (next.entities["04-4-vent"].properties.open === true ? 1 : 0));
    next.entities["04-4-main-pipe"].properties.effectivePressure = effective;
    const pin = next.entities["04-4-pin"];
    if (effective >= Number(pin.properties.releasesAtPressure)) pin.properties.released = true;
    const bridge = next.entities["04-4-bridge"];
    bridge.properties.extended = pin.properties.released === true;
    bridge.properties.pressure = effective;
    const chained = next.entities["04-4-bridge-end"].properties.tiedTo === "04-4-anvil-weight";
    bridge.properties.stability = !bridge.properties.extended ? "folded" : chained ? "chain-fixed" : effective === 0 ? "wind-lowered" : effective === 1 ? "shaking" : "overturning";
    bridge.properties.safeToCross = bridge.properties.extended === true && (chained || effective === 0);
    return { world: next, events: [], canChange: false };
  },
  idleAction: (state) => state.entities["04-4-pin"].properties.released === true
    && state.entities["04-4-bridge"].properties.safeToCross === true
    && !at(state, "hero", "04-4-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "04-4-exit" }
    : null,
  complete: (state) => at(state, "hero", "04-4-exit")
    && state.entities["04-4-pin"].properties.released === true
    && state.entities["04-4-bridge"].properties.safeToCross === true,
};

function workpieceAtCarrier(state: WorldState): boolean {
  let parent = state.entities["04-5-strip"].parent;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    if (parent === "04-5-carrier") return true;
    seen.add(parent);
    parent = state.entities[parent]?.parent ?? null;
  }
  return false;
}

const moonBell: SegmentDefinition = {
  id: "04-5",
  title: "달바람 종 제작",
  goal: "세 번 찍고 식힌 달바람 종을 운반대에 실어 출구 아치에 걸고 함께 건너기",
  description: "부드러운 금속, 세 타격 눈금, 식은 종의 형태 유지, 두 작업 정거장, 호스 사거리와 운반대 종 하나 용량이 공개됩니다.",
  hints: [
    "망치 정거장, 호스의 두 도달 원, 운반대 적재선과 갈고리를 보세요.",
    "완성품을 운반대로 옮기거나, 종 받침과 도구의 작업 위치를 운반대에 맞출 수 있어요.",
    "고정 모루에서 완성해 싣거나 운반대의 종 받침에서 완성한 뒤, 식은 종만 띄워 갈고리로 고정하세요.",
  ],
  enter: (previous) => carryWorld("04-5", [
    entity("04-5-start", "원형 대장간 아래층", "04-5", 0, { safe: true }),
    entity("04-5-fixed-anvil", "고정 모루", "04-5", 1, { capacity: 2, station: "fixed" }),
    entity("04-5-strip", "뜨거운 금속 띠", "04-5", 1, {
      slot: "large", temperature: 3, heatState: "hot", soft: true, stampHits: 0,
      moonStamp: "none", form: "strip", shape: "straight", cooled: false,
      holdable: true, heldWith: "", formedAt: "none",
    }, { movable: true, parent: "04-5-fixed-anvil" }),
    entity("04-5-hammer", "천장 레일 이동 망치", "04-5", 2, { orientation: 0, station: "fixed", stations: "fixed|carrier|safe", powered: false, requiredHits: 3 }),
    entity("04-5-selector", "바람 방향판", "04-5", 3, { orientation: 0, route: "off", routes: "off|hammer|cooling|carrier" }),
    entity("04-5-hose", "긴 냉각 호스", "04-5", 3, { powered: false, reaches: "fixed|carrier", coolingPerTick: 1 }),
    entity("04-5-tongs", "대장간 긴 집게", "04-5", 0, { slot: "small", tool: "tongs", safeHandle: true }, { movable: true, weight: 0.2, reach: 5 }),
    entity("04-5-frame", "이동식 종 받침", "04-5", 0, { slot: "large", capacity: 2, station: "portable", locksToCarrier: true }, { material: "wood", movable: true, weight: 1 }),
    entity("04-5-carrier", "떠오르는 운반대", "04-5", 4, { boardable: true, level: "low", bellCapacity: 1, powered: false, hooked: false }, { material: "wood", capacity: 3.5 }),
    entity("04-5-carrier-end", "운반대 고정 고리", "04-5", 4, { tiePoint: true }, { parent: "04-5-carrier", weight: 0 }),
    entity("04-5-hook-chain", "출구 고정 갈고리", "04-5", 4, { slot: "small", tool: "rope", hook: true }, { material: "metal", movable: true, weight: 0, parent: "04-5-carrier" }),
    entity("04-5-exit-anchor", "출구 높이 고정점", "04-5", 8, { tiePoint: true, fixed: true }),
    entity("04-5-heater-damper", "재가열 차단판", "04-5", 1, { open: false, warning: "cooled-pattern-will-sag" }),
    entity("04-5-exit", "출구 높이 발판", "04-5", 8, { safe: true }),
    entity("04-5-arch", "달바람 종 출구 아치", "04-5", 9, { capacity: 2, accepts: "cooled-bell" }, { reach: 2 }),
    entity("04-5-handprints", "종 받침 안쪽 두 손자국", "04-5", 4, { story: "이건 혼자 들면 자꾸 기울었는데." }),
  ], previous),
  execute: (state, action) => {
    const wrongRegion = ensureCurrentRegion(state, action);
    if (wrongRegion) return wrongRegion;
    const strip = state.entities["04-5-strip"];
    const hot = Number(strip.properties.temperature) > 0;
    if (moved(action) && state.entities[action.target]?.location.x >= 8 && state.actors[action.actor].location.x < 8) {
      return result(state, "clarification", "출구는 운반대의 도달 높이에 있어 아래층에서 바로 이동할 수 없어요.");
    }
    if (action.target === strip.id && hot && action.verb === "take") {
      return failure(state, "뜨거운 금속 띠를 맨손으로 들어 화상 연기가 났어요. 긴 집게의 안전 손잡이가 필요해요.");
    }
    if (action.target === strip.id && hot && (action.verb === "push" || action.verb === "pull" || action.verb === "place")
      && !heldWithTongs(state, strip.id, "04-5-tongs")) {
      return failure(state, "뜨거운 금속 띠를 맨손으로 옮겨 열 문양이 손에 닿았어요.");
    }
    if (action.verb === "place" && action.target === strip.id && action.destination === "04-5-arch"
      && (strip.properties.form !== "bell" || strip.properties.cooled !== true || strip.properties.shape !== "rigid")) {
      return failure(state, "세 번 찍어 달 문양을 만들고 완전히 식힌 단단한 종만 출구 아치에 걸 수 있어요.");
    }
    if ((action.verb === "pull" || action.verb === "push") && action.target === strip.id && action.destination === "04-5-frame"
      && heldWithTongs(state, strip.id, "04-5-tongs")) {
      const next = clone(state);
      next.entities[strip.id].parent = "04-5-frame";
      next.entities[strip.id].location = { ...next.entities["04-5-frame"].location };
      return result(next, "done", "대장간 긴 집게로 금속 띠를 운반대의 종 받침에 옮겼어요.");
    }
    const physical = executePhysicalAction(state, action);
    if (physical.outcome !== "done") return physical;
    const next = physical.world;
    if (action.verb === "turn" && action.target === "04-5-selector") {
      const selector = next.entities["04-5-selector"];
      const orientation = ((Number(selector.properties.orientation) % 4) + 4) % 4;
      selector.properties.orientation = orientation;
      selector.properties.route = ["off", "hammer", "cooling", "carrier"][orientation];
    }
    if (action.verb === "turn" && action.target === "04-5-hammer") {
      const hammer = next.entities["04-5-hammer"];
      const orientation = Number(hammer.properties.orientation) % 3;
      hammer.properties.orientation = orientation;
      hammer.properties.station = ["fixed", "carrier", "safe"][orientation];
    }
    if (action.verb === "place" && action.target === "04-5-frame" && action.destination === "04-5-carrier") {
      next.entities["04-5-frame"].properties.lockedToCarrier = true;
    }
    if ((action.verb === "pull" || action.verb === "push") && action.target === "04-5-strip" && action.destination === "04-5-frame") {
      next.entities["04-5-strip"].parent = "04-5-frame";
      next.entities["04-5-strip"].location = { ...next.entities["04-5-frame"].location };
    }
    return physical;
  },
  advance: (state) => {
    const next = advanceTick(state);
    const selector = next.entities["04-5-selector"];
    const hammer = next.entities["04-5-hammer"];
    const strip = next.entities["04-5-strip"];
    const route = String(selector.properties.route);
    hammer.properties.powered = route === "hammer";
    next.entities["04-5-hose"].properties.powered = route === "cooling";
    next.entities["04-5-carrier"].properties.powered = route === "carrier";

    const atFixed = strip.parent === "04-5-fixed-anvil";
    const atCarrierStation = strip.parent === "04-5-frame" && next.entities["04-5-frame"].parent === "04-5-carrier";
    const hammerAligned = (atFixed && hammer.properties.station === "fixed") || (atCarrierStation && hammer.properties.station === "carrier");
    if (route === "hammer" && hammerAligned && Number(strip.properties.temperature) > 0) {
      const hits = Math.min(3, Number(strip.properties.stampHits) + 1);
      strip.properties.stampHits = hits;
      strip.properties.moonStamp = hits === 3 ? "complete" : "partial";
      if (hits === 3) {
        strip.properties.form = "bell";
        strip.properties.shape = "soft-bell";
        strip.properties.formedAt = atFixed ? "fixed-anvil" : "carrier-station";
      }
    }

    if (next.entities["04-5-heater-damper"].properties.open === true && strip.properties.cooled === true) {
      strip.properties.temperature = 2;
      strip.properties.heatState = "hot";
      strip.properties.cooled = false;
      strip.properties.shape = "sagging";
      strip.properties.moonStamp = "drooped";
      return { world: next, events: [], canChange: false, failure: "완성 종을 다시 예열해 달 문양과 형태가 실제로 처졌어요." };
    }

    const hoseReaches = atFixed || atCarrierStation;
    if (route === "cooling" && hoseReaches && Number(strip.properties.temperature) > 0) {
      strip.properties.temperature = Number(strip.properties.temperature) - 1;
    }
    if (Number(strip.properties.temperature) === 0 && strip.properties.form === "bell") {
      strip.properties.heatState = "cool";
      strip.properties.cooled = true;
      strip.properties.shape = "rigid";
    }

    const carrier = next.entities["04-5-carrier"];
    if (route === "carrier" && carrier.properties.level === "low") {
      if (workpieceAtCarrier(next) && strip.properties.cooled !== true) {
        strip.properties.shape = "dented";
        return { world: next, events: [], canChange: false, failure: "식기 전 운반대를 띄워 부드러운 종이 적재 진동에 찌그러졌어요." };
      }
      carrier.properties.level = "exit";
      moveTree(next, carrier.id, next.entities["04-5-exit"].location);
    }
    carrier.properties.hooked = next.entities["04-5-carrier-end"].properties.tiedTo === "04-5-exit-anchor";
    return { world: next, events: [], canChange: route === "hammer" || route === "cooling" };
  },
  complete: (state) => at(state, "hero", "04-5-exit")
    && state.entities["04-5-strip"].parent === "04-5-arch"
    && state.entities["04-5-strip"].properties.form === "bell"
    && state.entities["04-5-strip"].properties.moonStamp === "complete"
    && state.entities["04-5-strip"].properties.cooled === true
    && state.entities["04-5-strip"].properties.shape === "rigid"
    && state.entities["04-5-carrier"].properties.hooked === true,
};

export const FORGE_STAGE: CampaignStageDefinition = {
  contentRevision: "shared-v1",
  id: STAGE_ID,
  title: "바람 대장간",
  practice,
  segments: [openFurnace, hammerTransfer, coolingKey, windBridge, moonBell],
  story: {
    afterSegment: "04-5",
    object: "04-5-handprints",
    text: "이건 혼자 들면 자꾸 기울었는데.",
  },
};

/** Public entity/property vocabulary for interpretation; the world state remains authoritative. */
export const FORGE_PUBLIC_CATALOG = Object.fromEntries(
  [practice, ...FORGE_STAGE.segments].map((segment) => {
    const initial = segment.enter(null);
    return [segment.id, initial.visible.map((id) => initial.entities[id]).filter(Boolean).map((item) => ({
      id: item.id,
      name: item.name,
      properties: Object.keys(item.properties).sort(),
    }))];
  }),
) as Readonly<Record<string, readonly { id: string; name: string; properties: readonly string[] }[]>>;
