import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../level";
import { executePhysicalAction } from "../physics";
import type { ActionResult } from "../program";
import type { Actor, Entity, PhysicalAction, Scalar, WorldState } from "../types";

const STAGE_ID = 8 as const;

function entity(
  id: string,
  name: string,
  description: string,
  region: string,
  x: number,
  kind: string,
  properties: Record<string, Scalar> = {},
  patch: Partial<Entity> = {},
): Entity {
  return makeEntity(id, name, region, x, {
    description,
    reach: 1,
    properties: { kind, publicLabel: name, ...properties },
    ...patch,
  });
}

function keeper(region: string, x = 0): Actor {
  return {
    id: "keeper",
    location: { region, x, y: 0 },
    holding: null,
    carrying: [],
    riding: null,
    capabilities: ["weight:0.3", "rail-only", "no-jump", "no-stairs", "max-weight:0.5", "carry-small:1"],
  };
}

function enterWorld(segmentId: string, current: Entity[], previous: WorldState | null, withKeeper = false): WorldState {
  const retained = previous ? Object.values(previous.entities).map((item) => structuredClone(item)) : [];
  const byId = new Map(retained.map((item) => [item.id, item]));
  for (const item of current) byId.set(item.id, item);
  const hero = makeHero(segmentId);
  hero.carrying = previous?.actors.hero?.carrying.filter((id) => id !== "letter" && byId.has(id)) ?? [];
  const world = makeWorld(STAGE_ID, segmentId, [...byId.values()], hero);
  if (withKeeper) world.actors.keeper = keeper(segmentId);
  const syncTree = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const item = world.entities[id];
    if (!item) return;
    item.parent = seen.size === 1 ? "hero" : item.parent;
    item.location = { ...hero.location };
    for (const child of Object.values(world.entities)) if (child.parent === id) syncTree(child.id, seen);
  };
  for (const id of hero.carrying) syncTree(id);
  world.visible = [...new Set([...current.map((item) => item.id), ...hero.carrying])];
  return world;
}

function clone(world: WorldState): WorldState {
  return structuredClone(world);
}

function result(world: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult {
  return { world, outcome, reason };
}

function clarification(world: WorldState, reason: string): ActionResult {
  return result(world, "clarification", reason);
}

function blocked(world: WorldState, reason: string): ActionResult {
  return result(world, "blocked", reason);
}

function failure(world: WorldState, reason: string): ActionResult {
  return result(clone(world), "failure", reason);
}

function tick(world: WorldState): WorldState {
  const next = clone(world);
  next.tick += 1;
  return next;
}

function movement(action: PhysicalAction): boolean {
  return action.verb === "move" || action.verb === "jump" || action.verb === "duck" || action.verb === "climb";
}

function hideObservationAfterFog(world: WorldState, action: PhysicalAction, observationId: string, fogX: number): ActionResult {
  const moved = executePhysicalAction(world, action);
  if ((moved.outcome === "done" || moved.outcome === "progress") && movement(action)) {
    if (moved.world.actors[action.actor].location.x >= fogX) {
      moved.world.visible = moved.world.visible.filter((id) => id !== observationId);
    } else if (moved.world.entities[observationId] && !moved.world.visible.includes(observationId)) {
      moved.world.visible.push(observationId);
    }
  }
  return moved;
}

function donePhysical(world: WorldState, action: PhysicalAction, refresh?: (world: WorldState) => void): ActionResult {
  const physical = executePhysicalAction(world, action);
  if (physical.outcome === "done" || physical.outcome === "progress") refresh?.(physical.world);
  return physical;
}

function observation(id: string, name: string, description: string, region: string, connectedTo: string): Entity {
  return entity(id, name, description, region, 0, "observation-scope", {
    connectedTo,
    safe: true,
  }, { material: "glass", reach: 20 });
}

function valve(id: string, name: string, region: string, x: number): Entity {
  return entity(id, name, `${name}. 한 번 당기면 붙어 있는 관에 힘을 보냅니다.`, region, x, "fixed-actuator", {
    actuator: true,
    strokes: 0,
    open: false,
  });
}

const practice: SegmentDefinition = {
  id: "08-practice",
  title: "안개 전 관측 모형",
  goal: "확대경으로 관 끝을 확인하고 그 손잡이를 한 번 당기기",
  description: "본편과 분리된 관 하나, 확대경 하나, 고정 손잡이 하나뿐인 무료 모형입니다.",
  hints: [
    "확대경의 연결 대상은 실제 관 끝과 같습니다.",
    "관측 사실은 이번 시도에만 남습니다.",
    "확대경을 관찰한 뒤 확인한 손잡이를 당기세요.",
  ],
  enter: () => enterWorld("08-practice", [
    observation("08-practice-observation", "난간 확대경", "갈림 없는 황동 관이 연습 손잡이까지 실제로 이어진 모습입니다.", "08-practice", "08-practice-handle"),
    valve("08-practice-handle", "연습 손잡이", "08-practice", 1),
  ], null),
  execute: (world, action) => {
    const physical = executePhysicalAction(world, action);
    if ((physical.outcome === "done" || physical.outcome === "progress") && action.verb === "pull" && action.target === "08-practice-handle") {
      physical.world.entities["08-practice-handle"].properties.open = true;
    }
    return physical;
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.entities["08-practice-handle"].properties.open === true,
};

const buoyLookout: SegmentDefinition = {
  id: "08-1",
  title: "삼각 부표 관측대",
  goal: "삼각 부표의 실제 관 끝을 확인하고 연결된 밸브로 문 열기",
  description: "볼트가 있는 접합만 이어진 세 황동 관과 삼각·원·사각 밸브를 안전 관측대에서 끝까지 볼 수 있습니다. 화면 표시는 8-4입니다.",
  hints: [
    "겹쳐 보이는 관 중 볼트가 있는 접합만 이어집니다.",
    "삼각 부표에서 시작한 관의 실제 끝을 관측 기록으로 남기세요.",
    "삼각 부표 절개도를 살펴본 뒤 세 밸브 앞 안전선으로 가서, 확인한 밸브를 당기고 열린 출구로 가세요.",
  ],
  enter: (previous) => enterWorld("08-1", [
    observation("08-1-triangle-observation", "삼각 부표 절개도", "삼각 부표의 관은 첫 교차부에서 틈을 지나고, 볼트 이음부를 거쳐 사각 밸브에 실제로 닿습니다.", "08-1", "08-1-square-valve"),
    entity("08-1-triangle-buoy", "삼각 부표", "삼각 표식에서 시작한 관은 안개 경계 전 관측대에서만 끝까지 따라갈 수 있습니다.", "08-1", 0, "buoy"),
    entity("08-1-fog-line", "얕은 안개 경계", "이 선을 지나면 관측대 절개도는 보이지 않지만 밸브 셋과 문은 보입니다.", "08-1", 2, "fog-boundary", { safe: true }),
    valve("08-1-triangle-valve", "삼각 밸브", "08-1", 3),
    valve("08-1-circle-valve", "원 밸브", "08-1", 4),
    entity("08-1-valve-bank", "세 밸브 앞 안전선", "세 밸브 모두에 손이 닿는 안개 속 안전선입니다.", "08-1", 4, "safe-line", { safe: true }, { reach: 2 }),
    valve("08-1-square-valve", "사각 밸브", "08-1", 5),
    entity("08-1-door", "삼각 문양 출구문", "실제로 이어진 밸브의 관이 밀어 올리는 문입니다.", "08-1", 6, "gate", { open: false }),
    entity("08-1-exit", "신호장 첫 출구", "열린 문 너머의 안전 종받침입니다.", "08-1", 7, "exit", { safe: true }),
  ], previous),
  execute: (world, action) => {
    if (action.verb === "pull" && ["08-1-triangle-valve", "08-1-circle-valve", "08-1-square-valve"].includes(action.target)) {
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      const chosen = physical.world.entities[action.target];
      chosen.properties.open = true;
      if (action.target === "08-1-square-valve") {
        physical.world.entities["08-1-door"].properties.open = true;
        return result(physical.world, "done", "사각 밸브의 실제 관이 삼각 문을 밀어 올렸어요.");
      }
      chosen.properties.open = false;
      chosen.properties.strokes = 0;
      return result(physical.world, "done", "선택한 관 끝에서 안개가 뿜고 밸브가 제자리로 돌아왔어요. 문은 그대로 닫혀 있어요.");
    }
    if (movement(action)) {
      if (action.target === "08-1-exit" && world.entities["08-1-door"].properties.open !== true) return blocked(world, "삼각 문양 출구문이 아직 닫혀 있어요.");
      return hideObservationAfterFog(world, action, "08-1-triangle-observation", 2);
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  idleAction: (world) => world.entities["08-1-door"].properties.open === true && !at(world, "hero", "08-1-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "08-1-exit" }
    : null,
  complete: (world) => at(world, "hero", "08-1-exit") && world.entities["08-1-door"].properties.open === true,
};

function refreshWaterRoute(world: WorldState): void {
  const openSupply = world.entities["08-2-center-supply"].properties.open === true;
  const committed = world.entities["08-2-inlet"].properties.route;
  const route = committed === "08-2-tank" || committed === "08-2-wheel"
    ? committed
    : world.entities["08-2-y-junction"].properties.route;
  const poured = world.entities["08-2-bucket"].properties.amount === 0;
  world.entities["08-2-tank"].properties.level = openSupply && route === "08-2-tank" && poured ? 1 : 0;
  world.entities["08-2-wheel"].properties.strokes = openSupply && route === "08-2-wheel" && poured ? 1 : 0;
  world.entities["08-2-left-door"].properties.open = world.entities["08-2-tank"].properties.level === 1;
  world.entities["08-2-right-door"].properties.open = world.entities["08-2-wheel"].properties.strokes === 1;
}

const waterBranch: SegmentDefinition = {
  id: "08-2",
  title: "물탱크 분기선",
  goal: "신호가 가리킨 공급관을 열고 물 한 칸을 수조나 수차로 보내 출구 하나 열기",
  description: "한 양동이의 순환수, 세 공급관, 회전 Y자 홈, 부표 수조와 수차가 한 화면의 실제 관으로 이어집니다. 화면 표시는 8-5입니다.",
  hints: [
    "깃발 포인터의 연결 대상이 지금 물이 오는 공급관입니다.",
    "Y자 홈은 수조와 수차 중 한쪽에만 맞습니다.",
    "공급 깃발 포인터를 살펴본 뒤 세 공급관 앞 안전선으로 가서 포인터에서 관찰한 연결 대상인 손잡이를 당기고, Y자 홈은 처음의 부표 수조 방향 그대로 둔 채 양동이 물을 투입구에 모두 부은 다음 부표 길 출구로 가세요.",
  ],
  enter: (previous) => enterWorld("08-2", [
    observation("08-2-signal-observation", "공급 깃발 포인터", "깃발 끝과 투명 점검관이 가운데 공급관에 실제로 붙어 있습니다.", "08-2", "08-2-center-supply"),
    entity("08-2-fog-line", "분기선 안개 경계", "경계 뒤에서도 공급관 셋과 Y자 홈의 손잡이는 보입니다.", "08-2", 2, "fog-boundary", { safe: true }),
    valve("08-2-left-supply", "왼쪽 공급관 손잡이", "08-2", 3),
    valve("08-2-center-supply", "가운데 공급관 손잡이", "08-2", 3),
    valve("08-2-right-supply", "오른쪽 공급관 손잡이", "08-2", 3),
    entity("08-2-supply-bank", "세 공급관 앞 안전선", "세 공급관 손잡이에 모두 손이 닿는 안전선입니다.", "08-2", 3, "safe-line", { safe: true }, { reach: 2 }),
    entity("08-2-y-junction", "회전 Y자 홈", "부표 수조 또는 수차 쪽으로 한 번에 한 갈래만 맞추는 홈입니다.", "08-2", 4, "routing-junction", { orientation: 0, route: "08-2-tank" }),
    entity("08-2-bucket", "순환수 한 칸 양동이", "바닥 홈을 통해 되돌아오는 물 한 칸입니다.", "08-2", 4, "water-container", { amount: 1, fluidDensity: 1, slot: "large", recoverable: true }, { material: "water", movable: true, weight: 0, capacity: 1 }),
    entity("08-2-inlet", "Y자 투입구", "양동이 물을 받아 현재 맞춘 장치에 보내는 투입구입니다.", "08-2", 4, "water-container", { amount: 0, route: "none" }, { capacity: 1 }),
    entity("08-2-tank", "밀폐 부표 수조", "물 한 칸이면 부표가 올라 왼쪽 문을 듭니다.", "08-2", 5, "float-tank", { amount: 0, level: 0, capacity: 1 }),
    entity("08-2-wheel", "한 바퀴 수차", "물 한 칸이면 한 바퀴 돌아 오른쪽 걸쇠를 풉니다.", "08-2", 5, "water-wheel", { strokes: 0 }),
    entity("08-2-left-door", "부표 왼쪽 문", "수조 부표가 한 칸 오르면 열립니다.", "08-2", 6, "gate", { open: false }),
    entity("08-2-right-door", "수차 오른쪽 문", "수차가 한 바퀴 돌면 열립니다.", "08-2", 6, "gate", { open: false }),
    entity("08-2-left-exit", "부표 길 출구", "왼쪽 열린 문 너머의 안전 발판입니다.", "08-2", 7, "exit", { safe: true }),
    entity("08-2-right-exit", "수차 길 출구", "오른쪽 열린 문 너머의 안전 발판입니다.", "08-2", 7, "exit", { safe: true }),
  ], previous),
  execute: (world, action) => {
    if (action.verb === "pull" && ["08-2-left-supply", "08-2-center-supply", "08-2-right-supply"].includes(action.target)) {
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      if (action.target === "08-2-center-supply") physical.world.entities[action.target].properties.open = true;
      else {
        physical.world.entities[action.target].properties.strokes = 0;
        return result(physical.world, "done", "막힌 투명 점검관에 물방울이 차올랐다 공급대로 돌아왔어요.");
      }
      return physical;
    }
    if (action.verb === "turn" && action.target === "08-2-y-junction") {
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["08-2-y-junction"].properties.route = Number(physical.world.entities["08-2-y-junction"].properties.orientation) % 2 === 0 ? "08-2-tank" : "08-2-wheel";
      return physical;
    }
    if (action.verb === "pour" && action.target === "08-2-bucket" && action.destination === "08-2-inlet") {
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["08-2-inlet"].properties.route = physical.world.entities["08-2-y-junction"].properties.route;
      refreshWaterRoute(physical.world);
      return physical;
    }
    if (movement(action)) {
      if (action.target === "08-2-left-exit" && world.entities["08-2-left-door"].properties.open !== true) return blocked(world, "부표 왼쪽 문이 아직 닫혀 있어요.");
      if (action.target === "08-2-right-exit" && world.entities["08-2-right-door"].properties.open !== true) return blocked(world, "수차 오른쪽 문이 아직 닫혀 있어요.");
      return hideObservationAfterFog(world, action, "08-2-signal-observation", 2);
    }
    return donePhysical(world, action, refreshWaterRoute);
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  idleAction: (world) => {
    const left = world.entities["08-2-left-door"].properties.open === true;
    const right = world.entities["08-2-right-door"].properties.open === true;
    if (left === right) return null;
    const target = left ? "08-2-left-exit" : "08-2-right-exit";
    return at(world, "hero", target) ? null : { kind: "action", actor: "hero", verb: "move", target };
  },
  complete: (world) => (at(world, "hero", "08-2-left-exit") && world.entities["08-2-left-door"].properties.open === true)
    || (at(world, "hero", "08-2-right-exit") && world.entities["08-2-right-door"].properties.open === true),
};

function refreshPiston(world: WorldState): void {
  const phase = Number(world.entities["08-3-clock"].properties.clockPhase) % 12;
  const retracted = phase >= 6;
  world.entities["08-3-clock"].properties.lowBell = retracted;
  world.entities["08-3-clock"].properties.highBell = !retracted;
  world.entities["08-3-piston"].properties.position = retracted ? "안으로 들어감" : "밖으로 나옴";
  const fixed = world.entities["08-3-wedge"].parent === "08-3-wedge-socket"
    && world.entities["08-3-axle"].properties.cooled === true;
  world.entities["08-3-piston"].properties.locked = fixed;
  world.entities["08-3-passage"].properties.safe = retracted || fixed;
}

const lowBellCrossing: SegmentDefinition = {
  id: "08-3",
  title: "저음종 전차대",
  goal: "낮은 종 안전 구간을 기다리거나 피스톤을 식혀 쐐기로 고정한 뒤 건너기",
  description: "높은 종·낮은 종의 네 박자 톱니 시계, 왕복 피스톤, 냉각수 한 칸과 쐐기 하나가 모두 보입니다. 화면 표시는 8-6입니다.",
  hints: [
    "낮은 종 뒤 긴 쉼에는 피스톤이 완전히 들어갑니다.",
    "기다리는 대신 나온 축을 식힌 뒤 쐐기를 받칠 수도 있습니다.",
    "투명 네 박자 시계를 살펴보고, 낮은 종 표시가 켜지면 전차대 건너편까지 걸어가세요.",
  ],
  enter: (previous) => {
    const world = enterWorld("08-3", [
      entity("08-3-clock", "투명 네 박자 시계", "높은 종 표시 뒤 짧은 쉼이 오고, 낮은 종 표시가 켜지면 통로 여섯 칸을 걷는 동안 피스톤이 들어가 있습니다.", "08-3", 0, "event-clock", { clockPhase: 0, lowBell: false, highBell: true }),
      entity("08-3-piston", "왕복 피스톤", "높은 종에는 통로를 쓸고 낮은 종에는 안으로 들어갑니다.", "08-3", 3, "piston", { position: "밖으로 나옴", locked: false }),
      entity("08-3-axle", "뜨거운 피스톤 축", "냉각수 한 칸을 받으면 쐐기를 안전하게 끼울 수 있습니다.", "08-3", 1, "axle", { amount: 0, cooled: false }, { capacity: 1 }),
      entity("08-3-jug", "냉각수 한 칸 주전자", "피스톤 축을 한 번 식힐 물 한 칸입니다.", "08-3", 0, "water-container", { amount: 1, fluidDensity: 1, slot: "small", recoverable: true }, { material: "water", movable: true, weight: 0, capacity: 1 }),
      entity("08-3-wedge", "고정 쐐기", "식은 피스톤의 바깥 고정 홈에 끼우는 작은 쐐기입니다.", "08-3", 0, "portable-small", { slot: "small", recoverable: true }, { material: "wood", movable: true, weight: 0.2 }),
      entity("08-3-wedge-socket", "바깥 피스톤 고정 홈", "피스톤이 나온 상태에서만 손이 닿는 쐐기 홈입니다.", "08-3", 2, "device-slot", { accepts: "08-3-wedge", capacity: 0.3 }),
      entity("08-3-passage", "전차대 통로", "피스톤이 들어가거나 식힌 축에 쐐기가 고정되면 안전합니다.", "08-3", 5, "passage", { safe: false }),
      entity("08-3-exit", "전차대 건너편", "피스톤 범위 밖 안전 발판입니다.", "08-3", 6, "exit", { safe: true }),
    ], previous);
    refreshPiston(world);
    return world;
  },
  execute: (world, action) => {
    if (action.verb === "pour" && action.target === "08-3-jug" && action.destination === "08-3-axle") {
      if (world.entities["08-3-piston"].properties.position !== "밖으로 나옴") return clarification(world, "안으로 들어간 피스톤 축에는 손이 닿지 않아요. 바깥에 나온 박자를 확인하세요.");
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["08-3-axle"].properties.cooled = true;
      refreshPiston(physical.world);
      return physical;
    }
    if (action.verb === "place" && action.target === "08-3-wedge" && action.destination === "08-3-wedge-socket") {
      if (world.entities["08-3-piston"].properties.position !== "밖으로 나옴") return clarification(world, "안으로 들어간 피스톤의 고정 홈에는 쐐기가 닿지 않아요.");
      if (world.entities["08-3-axle"].properties.cooled !== true) return failure(world, "뜨거운 축에 댄 쐐기가 튕겨 안전망으로 밀려났어요.");
      return donePhysical(world, action, refreshPiston);
    }
    if (movement(action) && action.target === "08-3-exit") {
      if (world.entities["08-3-passage"].properties.safe !== true) {
        return failure(world, "높은 종에 나온 피스톤이 용사를 옆 안전망으로 밀어냈어요.");
      }
      return executePhysicalAction(world, action, { movementStep: 1 });
    }
    return donePhysical(world, action, refreshPiston);
  },
  advance: (world) => {
    const next = tick(world);
    if (next.entities["08-3-piston"].properties.locked !== true) {
      next.entities["08-3-clock"].properties.clockPhase = (Number(next.entities["08-3-clock"].properties.clockPhase) + 1) % 12;
    }
    refreshPiston(next);
    return { world: next, events: [], canChange: next.entities["08-3-piston"].properties.locked !== true };
  },
  idleAction: (world) => world.entities["08-3-piston"].properties.locked === true && !at(world, "hero", "08-3-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "08-3-exit" }
    : null,
  complete: (world) => at(world, "hero", "08-3-exit"),
};

function refreshWindRoute(world: WorldState): void {
  const west = Number(world.entities["08-4-wind-lever"].properties.orientation) % 2 === 1;
  world.entities["08-4-wind-lever"].properties.position = west ? "west" : "east";
  world.entities["08-4-route-observation"].properties.connectedTo = west ? "08-4-lower-cartway" : "08-4-upper-lift";
  world.entities["08-4-upper-lift"].properties.open = !west;
  world.entities["08-4-lower-cartway"].properties.open = west;
}

const returnedVane: SegmentDefinition = {
  id: "08-4",
  title: "되돌아간 풍향기",
  goal: "레버 상태의 실제 연결을 확인하고 위 승강로나 아래 수레길 중 한 길로 통과하기",
  description: "동·서 풍향 레버가 회전 이음관 전체를 돌립니다. 위쪽은 고정 역중력, 아래쪽은 낮은 수레 통로입니다. 화면 표시는 8-7입니다.",
  hints: [
    "되감기 뒤 풍향 레버는 동쪽으로 돌아갑니다.",
    "회전 뒤 절개도를 다시 보면 현재 열린 길이 기록됩니다.",
    "회전 이음관 절개도로 현재 열린 길을 확인하고, 확인한 위쪽 쇠사슬 승강로로 간 뒤 천장 보행로 출구까지 올라가세요.",
  ],
  enter: (previous) => {
    const world = enterWorld("08-4", [
      entity("08-4-wind-lever", "동서 풍향 레버", "한 번 돌릴 때마다 동쪽과 서쪽 두 고정 위치를 오갑니다.", "08-4", 0, "route-lever", { orientation: 0, position: "east" }),
      observation("08-4-route-observation", "회전 이음관 절개도", "현재 회전한 볼트 이음관과 네 관 끝을 동시에 보여 줍니다.", "08-4", "08-4-upper-lift"),
      entity("08-4-fog-line", "회전관 안개 경계", "경계를 지나면 절개도는 보이지 않고 두 실제 길만 보입니다.", "08-4", 2, "fog-boundary", { safe: true }),
      entity("08-4-upper-lift", "위쪽 쇠사슬 승강로", "동쪽 이음관에 연결되는 고정 역중력 길입니다.", "08-4", 4, "route", { open: true, route: "upper", gravity: "up", climbable: true }),
      entity("08-4-upper-exit", "천장 보행로 출구", "위쪽 승강로 끝의 넓고 고정된 쇠사슬 보행판입니다.", "08-4", 7, "exit", { safe: true, climbable: true, stable: true }, { capacity: 2, reach: 3 }),
      entity("08-4-lower-cartway", "아래쪽 낮은 수레길", "서쪽 이음관에 연결되는 낮은 천장 길입니다.", "08-4", 4, "route", { open: false, route: "lower", clearance: "low" }),
      entity("08-4-lower-exit", "수레길 출구", "숙여 지나가는 아래쪽 안전 출구입니다.", "08-4", 7, "exit", { safe: true }),
    ], previous);
    refreshWindRoute(world);
    return world;
  },
  execute: (world, action) => {
    if (action.verb === "turn" && action.target === "08-4-wind-lever") return donePhysical(world, action, refreshWindRoute);
    if (movement(action)) {
      const upper = action.target === "08-4-upper-lift" || action.target === "08-4-upper-exit";
      const lower = action.target === "08-4-lower-cartway" || action.target === "08-4-lower-exit";
      if (upper && world.entities["08-4-upper-lift"].properties.open !== true) return blocked(world, "현재 회전 이음관은 위쪽 쇠사슬 승강로와 끊겨 있어요.");
      if (lower && world.entities["08-4-lower-cartway"].properties.open !== true) return blocked(world, "현재 회전 이음관은 아래쪽 수레길과 끊겨 있어요.");
      if (action.target === "08-4-upper-exit" && action.verb !== "climb") return clarification(world, "위쪽 고정 역중력 구역은 쇠사슬 승강로를 따라 올라야 해요.");
      if (action.target === "08-4-lower-exit" && action.verb !== "duck") return failure(world, "낮은 천장에 부딪혀 수레길 입구 안전망으로 밀려났어요.");
      return hideObservationAfterFog(world, action, "08-4-route-observation", 2);
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => at(world, "hero", "08-4-upper-exit") || at(world, "hero", "08-4-lower-exit"),
};

function refreshFinal(world: WorldState): void {
  const route = world.entities["08-5-route-selector"].properties.route;
  const charged = Number(world.entities["08-5-pressure-gauge"].properties.pressure) >= 1;
  world.entities["08-5-north-lift"].properties.open = charged && route === "북쪽";
  world.entities["08-5-south-water"].properties.level = charged && route === "남쪽" ? 1 : 0;
  world.entities["08-5-south-door"].properties.open = world.entities["08-5-south-water"].properties.level === 1
    && world.entities["08-5-counterweight"].properties.held === true;
}

const departureSignal: SegmentDefinition = {
  id: "08-5",
  title: "세 갈래 출발 신호",
  goal: "실제 연결 신호에 압력 한 칸을 보내 북쪽 승강로나 남쪽 운반로를 지나 출발 종 울리기",
  description: "압력 두 칸, 삼각·원·사각 신호, 북쪽 승강 선로와 남쪽 물길·등지기 추가 보입니다. 화면 표시는 8-8입니다.",
  hints: [
    "보일러 관측창은 실제로 붙은 신호를 가리킵니다.",
    "북쪽은 낮은 종과 승강로, 남쪽은 물 한 칸과 등지기 추를 씁니다.",
    "보일러 연결 관측창으로 실제 신호 손잡이를 확인하고, 북남 분기 손잡이는 돌리지 않은 채 안개 경계까지 가서 확인한 손잡이를 당긴 다음 낮은 종 표시가 켜지면 북쪽 중간 안전판까지 건너 출발 종을 당기세요.",
  ],
  enter: (previous) => {
    const world = enterWorld("08-5", [
      observation("08-5-boiler-observation", "보일러 연결 관측창", "보일러의 볼트 관이 사각 신호 손잡이에 실제로 붙어 있습니다.", "08-5", "08-5-square-signal"),
      entity("08-5-pressure-gauge", "두 칸 압력계", "보일러 압력 2/2와 안전통 압력 0/1이 큰 눈금으로 보입니다.", "08-5", 0, "pressure-gauge", { pressure: 0, capacity: 2, remaining: 2 }),
      entity("08-5-route-selector", "북남 분기 손잡이", "북쪽 승강 선로와 남쪽 운반 선로 사이를 돌려 맞춥니다.", "08-5", 1, "route-lever", { orientation: 0, route: "북쪽" }),
      entity("08-5-fog-line", "출발 신호 안개 경계", "경계 뒤에는 세 신호 손잡이와 압력 눈금이 계속 보입니다.", "08-5", 2, "fog-boundary", { safe: true }),
      valve("08-5-triangle-signal", "삼각 신호 손잡이", "08-5", 3),
      valve("08-5-circle-signal", "원 신호 손잡이", "08-5", 3),
      valve("08-5-square-signal", "사각 신호 손잡이", "08-5", 3),
      entity("08-5-recovery", "안전통 복귀 손잡이", "잘못 보낸 압력 한 칸을 보일러로 되돌립니다.", "08-5", 3, "fixed-actuator", { actuator: true, strokes: 0, pressure: 0 }),
      entity("08-5-north-lift", "북쪽 승강 선로", "압력 한 칸이면 올라가고 낮은 종 안전 구간에 건널 수 있습니다.", "08-5", 5, "lift-route", { open: false, route: "북쪽" }),
      entity("08-5-low-bell", "북쪽 종 표시판", "낮은 종 표시가 켜진 동안 북쪽 다섯 칸을 걷고도 한 박자 남도록 왕복대가 들어가 있습니다.", "08-5", 5, "event-clock", { clockPhase: 0, lowBell: false, highBell: true, safe: false }),
      entity("08-5-north-exit", "북쪽 중간 안전판", "승강 선로 너머 출발 종으로 이어지는 안전판입니다.", "08-5", 7, "exit", { safe: true }),
      entity("08-5-south-water", "남쪽 한 칸 물 홈", "압력 한 칸이면 물 한 칸이 남쪽 문까지 갑니다.", "08-5", 5, "water-channel", { level: 0, route: "남쪽" }),
      entity("08-5-counterweight", "남쪽 문 반대편 추", "등지기가 잡아 누르는 동안 남쪽 문 걸쇠를 유지합니다.", "08-5", 5, "hold-handle", { rail: true, holdable: true, held: false, heldBy: "" }),
      entity("08-5-south-door", "남쪽 운반 문", "물 한 칸과 등지기 추 유지가 함께 있으면 열립니다.", "08-5", 6, "gate", { open: false }),
      entity("08-5-south-exit", "남쪽 중간 안전판", "운반 문 너머 출발 종으로 이어지는 안전판입니다.", "08-5", 7, "exit", { safe: true }),
      entity("08-5-departure-bell", "신호장 출발 종", "어느 중간 안전판에서든 한 번 당기면 출발을 알립니다.", "08-5", 8, "fixed-actuator", { actuator: true, strokes: 0 }),
      entity("08-5-story-ticket", "오래된 화물표", "뒤에는 ‘먼저 보고 말해 주던 네가 있었지.’라고 적혀 있습니다.", "08-5", 7, "story-object", { open: false }, { material: "cloth" }),
    ], previous, true);
    refreshFinal(world);
    return world;
  },
  execute: (world, action) => {
    if (action.verb === "turn" && action.target === "08-5-route-selector") {
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities[action.target].properties.route = Number(physical.world.entities[action.target].properties.orientation) % 2 === 0 ? "북쪽" : "남쪽";
      refreshFinal(physical.world);
      return physical;
    }
    if (action.verb === "pull" && ["08-5-triangle-signal", "08-5-circle-signal", "08-5-square-signal"].includes(action.target)) {
      const remaining = Number(world.entities["08-5-pressure-gauge"].properties.remaining);
      if (remaining < 1) return blocked(world, "보일러 압력 눈금이 비어 있어요. 안전통에 든 압력이 있으면 복귀 손잡이를 당겨 주세요.");
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      const gauge = physical.world.entities["08-5-pressure-gauge"];
      gauge.properties.remaining = remaining - 1;
      if (action.target === "08-5-square-signal") gauge.properties.pressure = Number(gauge.properties.pressure) + 1;
      else {
        physical.world.entities["08-5-recovery"].properties.pressure = Number(physical.world.entities["08-5-recovery"].properties.pressure) + 1;
        physical.world.entities[action.target].properties.strokes = 0;
      }
      refreshFinal(physical.world);
      return physical;
    }
    if (action.verb === "pull" && action.target === "08-5-recovery") {
      if (Number(world.entities["08-5-recovery"].properties.pressure) < 1) return clarification(world, "투명 안전통에 돌려보낼 압력이 없어요.");
      const physical = executePhysicalAction(world, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["08-5-recovery"].properties.pressure = 0;
      physical.world.entities["08-5-pressure-gauge"].properties.remaining = Number(physical.world.entities["08-5-pressure-gauge"].properties.remaining) + 1;
      return physical;
    }
    if (action.actor === "keeper" && action.verb === "hold" && action.target === "08-5-counterweight") {
      const physical = executePhysicalAction(world, action);
      if (physical.outcome === "done") refreshFinal(physical.world);
      return physical;
    }
    if (movement(action)) {
      if ((action.target === "08-5-north-lift" || action.target === "08-5-north-exit") && world.entities["08-5-north-lift"].properties.open !== true) return blocked(world, "북쪽 승강 선로에 아직 압력이 오지 않았어요.");
      if (action.target === "08-5-north-exit" && world.entities["08-5-low-bell"].properties.safe !== true) return failure(world, "높은 종의 왕복대가 용사를 북쪽 난간망으로 밀어냈어요.");
      if (action.target === "08-5-south-exit" && world.entities["08-5-south-door"].properties.open !== true) return blocked(world, "남쪽 문은 물 한 칸과 등지기 추 유지가 함께 필요해요.");
      if (action.target === "08-5-departure-bell"
          && !at(world, "hero", "08-5-north-exit") && !at(world, "hero", "08-5-south-exit")) return blocked(world, "먼저 북쪽이나 남쪽 중간 안전판에 도착해야 출발 종에 닿아요.");
      if (action.target === "08-5-north-exit") return executePhysicalAction(world, action, { movementStep: 1 });
      return hideObservationAfterFog(world, action, "08-5-boiler-observation", 2);
    }
    if (action.verb === "pull" && action.target === "08-5-departure-bell") {
      if (!at(world, "hero", "08-5-north-exit") && !at(world, "hero", "08-5-south-exit")) return clarification(world, "출발 종은 중간 안전판에서만 손이 닿아요.");
      return executePhysicalAction(world, action);
    }
    return donePhysical(world, action, refreshFinal);
  },
  advance: (world) => {
    const next = tick(world);
    const bell = next.entities["08-5-low-bell"];
    bell.properties.clockPhase = (Number(bell.properties.clockPhase) + 1) % 12;
    bell.properties.lowBell = Number(bell.properties.clockPhase) >= 6;
    bell.properties.highBell = !bell.properties.lowBell;
    bell.properties.safe = bell.properties.lowBell;
    refreshFinal(next);
    return { world: next, events: [], canChange: true };
  },
  complete: (world) => Number(world.entities["08-5-departure-bell"].properties.strokes) >= 1
    && (at(world, "hero", "08-5-north-exit") || at(world, "hero", "08-5-south-exit")),
};

export const FOG_STAGE: CampaignStageDefinition = {
  id: STAGE_ID,
  title: "안개 신호장",
  practice,
  segments: [buoyLookout, waterBranch, lowBellCrossing, returnedVane, departureSignal],
  story: {
    afterSegment: "08-5",
    object: "08-5-story-ticket",
    text: "먼저 보고 말해 주던 네가 있었지.",
  },
};
