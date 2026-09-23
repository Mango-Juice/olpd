import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../../../src/campaign/level";
import { resolveActionReferences } from "../../../src/campaign/conditions";
import { currentLoad, executePhysicalAction } from "../../../src/campaign/physics";
import type { ActionResult } from "../../../src/campaign/program";
import type { Actor, Entity, PhysicalAction, Scalar, WorldState } from "../../../src/campaign/types";

const STAGE_ID = 9 as const;

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
  const hero = makeHero(segmentId, 0);
  hero.carrying = previous?.actors.hero?.carrying.filter((id) => id !== "letter" && byId.has(id)) ?? [];
  const state = makeWorld(STAGE_ID, segmentId, [...byId.values()], hero);
  if (withKeeper) {
    state.actors.keeper = keeper(segmentId);
    state.actors.keeper.carrying = previous?.actors.keeper?.carrying.filter((id) => byId.has(id)) ?? [];
  }
  for (const actor of Object.values(state.actors)) for (const id of actor.carrying) {
    const carried = state.entities[id];
    if (carried) { carried.parent = actor.id; carried.location = { ...actor.location }; }
  }
  state.visible = [...new Set([...current.map((item) => item.id), ...Object.values(state.actors).flatMap((actor) => actor.carrying), "letter"])];
  return state;
}

function clone(state: WorldState): WorldState { return structuredClone(state); }
function result(state: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult { return { world: state, outcome, reason }; }
function blocked(state: WorldState, reason: string): ActionResult { return result(state, "blocked", reason); }
function tick(state: WorldState): WorldState { const next = clone(state); next.tick += 1; return next; }
function physical(state: WorldState, action: PhysicalAction, refresh: (world: WorldState) => void): ActionResult {
  const moved = executePhysicalAction(state, action, { movementStep: 1 });
  if (moved.outcome === "done" || moved.outcome === "progress") refresh(moved.world);
  return moved;
}
const MOVEMENT = new Set<PhysicalAction["verb"]>(["move", "jump", "duck", "climb", "board", "dismount"]);
function nextStepX(state: WorldState, action: PhysicalAction): number | null {
  if (!MOVEMENT.has(action.verb)) return null;
  const actor = state.actors[action.actor]; const target = state.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return null;
  return actor.location.x + Math.sign(target.location.x - actor.location.x) * Math.min(1, Math.abs(target.location.x - actor.location.x));
}
function crosses(state: WorldState, action: PhysicalAction, x: number): boolean {
  const actor = state.actors[action.actor]; const next = nextStepX(state, action); if (!actor || next === null) return false;
  return (actor.location.x < x && next >= x) || (actor.location.x > x && next <= x);
}

function portable(id: string, name: string, description: string, region: string, x: number, slot: "small" | "large", weight = 0.3, material: Entity["material"] = "wood"): Entity {
  return entity(id, name, description, region, x, "portable-tool", { slot, recoverable: true }, { movable: true, weight, material });
}

const practice: SegmentDefinition = {
  id: "09-practice",
  title: "탑 단면 모형",
  goal: "아래 받침이 위 걸쇠에 이어지는 모습을 관찰하기",
  description: "본편과 분리된 작은 단면 모형입니다.",
  hints: ["아래 축과 위 걸쇠를 잇는 막대를 보세요.", "받침은 축의 높이를 바꿉니다.", "나무 받침을 축 홈에 두고 위 걸쇠를 관찰하세요."],
  enter: () => enterWorld("09-practice", [
    portable("09-practice-support", "나무 받침", "축 밑 홈에 맞는 큰 받침입니다.", "09-practice", 0, "large", 1),
    entity("09-practice-socket", "축 아래 홈", "받침의 하중이 종축으로 이어지는 홈입니다.", "09-practice", 1, "support-socket"),
    entity("09-practice-latch", "위 걸쇠", "아래 축과 한 막대로 연결된 공개 걸쇠입니다.", "09-practice", 2, "latch", { open: false, connectedTo: "09-practice-socket" }),
  ], null),
  execute: (state, action) => physical(state, action, (world) => {
    world.entities["09-practice-latch"].properties.open = world.entities["09-practice-support"].parent === "09-practice-socket";
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.entities["09-practice-latch"].properties.open === true,
};

function refreshShaft(state: WorldState): void {
  const supported = state.entities["09-1-support"].parent === "09-1-shaft-socket";
  const floated = Number(state.entities["09-1-tank"].properties.amount) >= 1;
  const shaft = state.entities["09-1-shaft"];
  state.entities["09-1-float"].properties.floated = floated;
  shaft.properties.level = supported || floated;
  shaft.properties.support = supported ? "09-1-support" : floated ? "09-1-float" : "none";
  state.entities["09-1-latch"].properties.open = shaft.properties.level;
}

const twoRoomShaft: SegmentDefinition = {
  id: "09-1",
  title: "두 방짜리 종축",
  goal: "아래에서 종축을 수평으로 유지한 뒤 위층 작은 문 통과하기",
  description: "받침과 물을 채우는 밀폐 부표가 같은 축을 서로 다른 힘으로 받칩니다.",
  hints: ["아래 축과 위 걸쇠는 한 막대입니다.", "축을 떠난 뒤에도 남는 지지를 만드세요.", "나무 받침을 종축 아래 홈에 놓아 수평으로 만든 뒤 위 종실 도착선까지 가세요."],
  enter: (previous) => enterWorld("09-1", [
    portable("09-1-support", "나무 받침", "종축 홈에 맞는 큰 받침입니다.", "09-1", 0, "large", 1),
    entity("09-1-shaft-socket", "종축 아래 홈", "받침의 하중을 축에 전달합니다.", "09-1", 1, "support-socket"),
    entity("09-1-water", "물 한 칸 들이 물병", "부표 수조를 한 눈금 채울 실제 물이 든 병입니다.", "09-1", 0, "water-vessel", { slot: "small", amount: 1, fluidDensity: 1, recoverable: true }, { movable: true, weight: 0.2, material: "water" }),
    entity("09-1-tank", "한 칸 부표 수조", "물 한 칸이면 밀폐 부표가 축 밑까지 뜹니다.", "09-1", 1, "float-tank", { amount: 0, capacityMarks: 1 }, { capacity: 1 }),
    entity("09-1-float", "밀폐 부표", "수조 안에서 뜨면 축을 받칩니다.", "09-1", 1, "sealed-float", { floated: false }),
    entity("09-1-shaft", "처진 종축", "아래 지지가 남으면 위 걸쇠까지 수평이 됩니다.", "09-1", 1, "bell-shaft", { level: false, support: "none", connectedTo: "09-1-latch" }),
    entity("09-1-latch", "위층 작은 문 걸쇠", "종축과 한 막대로 연결돼 있습니다.", "09-1", 3, "latch", { open: false, connectedTo: "09-1-shaft" }),
    entity("09-1-exit", "위 종실 도착선", "작은 문 너머 안전선입니다.", "09-1", 4, "exit", { safe: true }),
  ], previous),
  execute: (state, action) => {
    if (crosses(state, action, 2.5) && state.entities["09-1-latch"].properties.open !== true) {
      return blocked(state, "처진 종축 때문에 위 걸쇠가 절반에서 멈췄어요.");
    }
    return physical(state, action, refreshShaft);
  },
  advance: (state) => { const next = tick(state); refreshShaft(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => at(state, "hero", "09-1-exit") && state.entities["09-1-shaft"].properties.level === true,
};

function windPhase(state: WorldState): "strong" | "light" | "still" {
  return (["strong", "strong", "light", "still", "still", "still", "still", "still", "still"] as const)[state.tick % 9];
}
function refreshWind(state: WorldState): void {
  const phase = windPhase(state);
  const diverted = state.entities["09-2-diverter"].properties.route === "upper-pipe";
  state.entities["09-2-pinwheel"].properties.phase = phase;
  state.entities["09-2-corridor"].properties.wind = diverted ? "still" : phase;
}

const safeWindow: SegmentDefinition = {
  id: "09-2",
  title: "공개된 안전창",
  goal: "바람을 피해 반대편 종줄 점검대로 가기",
  description: "기다리는 사건 해법과 냉각 뒤 기류를 돌리는 상태 해법이 함께 보입니다.",
  hints: ["날개 아래 네 칸 중 길이 비는 칸을 보세요.", "기다리거나 바람이 가는 관을 바꿀 수 있습니다.", "바람개비가 멎음 칸에 오면 종줄 점검대까지 걸어가세요."],
  enter: (previous) => {
    const world = enterWorld("09-2", [
      entity("09-2-pinwheel", "네 상태 바람개비", "센 바람 둘, 잔바람 하나 뒤 멎음 안전창이 통로를 건너고도 한 박자 남도록 이어집니다.", "09-2", 0, "wind-clock", { phase: "strong", cycle: "strong|strong|light|still|still|still|still|still|still" }),
      entity("09-2-corridor", "가로 통로", "멎음 한 칸이면 건너고도 한 칸 여유가 있습니다.", "09-2", 2, "wind-corridor", { wind: "strong" }),
      entity("09-2-coolant", "냉각수 한 칸 들이 물병", "뜨거운 전환판을 식힐 실제 물이 든 병입니다.", "09-2", 0, "water-vessel", { slot: "small", amount: 1, fluidDensity: 1, recoverable: true }, { movable: true, weight: 0.2, material: "water" }),
      entity("09-2-diverter", "뜨거운 기류 전환판", "식힌 뒤 돌리면 바람을 위 관으로 고정합니다.", "09-2", 1, "wind-diverter", { amount: 0, cooled: false, orientation: 0, route: "corridor", connectedTo: "09-2-upper-pipe" }, { capacity: 1 }),
      entity("09-2-upper-pipe", "종축 위 관", "전환된 바람이 계속 흐르는 우회관입니다.", "09-2", 1, "wind-pipe", { flowing: false }),
      entity("09-2-exit", "종줄 점검대", "통로 반대편의 안전 점검대입니다.", "09-2", 4, "exit", { safe: true }),
    ], previous);
    refreshWind(world);
    return world;
  },
  execute: (state, action) => {
    if (action.verb === "pour" && action.target === "09-2-coolant" && action.destination === "09-2-diverter") {
      const poured = physical(state, action, () => {});
      if (poured.outcome === "done") poured.world.entities["09-2-diverter"].properties.cooled = Number(poured.world.entities["09-2-diverter"].properties.amount) >= 1;
      return poured;
    }
    if (action.verb === "turn" && action.target === "09-2-diverter") {
      if (state.entities["09-2-diverter"].properties.cooled !== true) return blocked(state, "열기 물결과 온도 눈금이 손을 막아요.");
      const turned = physical(state, action, () => {});
      if (turned.outcome !== "done") return turned;
      turned.world.entities["09-2-diverter"].properties.route = "upper-pipe";
      turned.world.entities["09-2-upper-pipe"].properties.flowing = true;
      refreshWind(turned.world);
      return result(turned.world, "done", "식은 전환판이 바람을 위 관으로 돌려 통로가 멎었어요.");
    }
    if (crosses(state, action, 1.5) && state.entities["09-2-corridor"].properties.wind !== "still") {
      return blocked(state, "난간망이 현재 안전 발판의 용사를 받아 냈어요. 바닥 눈금에 실제 출발 바람 칸이 남았어요.");
    }
    return physical(state, action, refreshWind);
  },
  advance: (state) => { const next = tick(state); refreshWind(next); return { world: next, events: [], canChange: true }; },
  complete: (state) => at(state, "hero", "09-2-exit"),
};

function refreshRecovery(state: WorldState): void {
  const support = state.entities["09-3-support"];
  const recovered = support.parent === null && support.location.x === state.entities["09-3-inside"].location.x;
  state.entities["09-3-front-door"].properties.open = support.parent === "09-3-front-socket" || state.entities["09-3-weight"].parent === "09-3-door-handle" || state.entities["09-3-front-door"].properties.locked === true;
  state.entities["09-3-front-door"].properties.supportedBy = support.parent === "09-3-front-socket" ? support.id : state.entities["09-3-weight"].parent === "09-3-door-handle" ? "09-3-weight" : state.entities["09-3-front-door"].properties.locked === true ? "09-3-moon-winch" : "none";
  if (state.entities["09-3-weight"].parent === "09-3-door-handle") state.entities["09-3-weight"].properties.usedForDoor = true;
  state.entities["09-3-bell-shaft"].properties.supported = support.parent === "09-3-bell-socket";
  state.entities["09-3-inside"].properties.supportRecovered = recovered || support.parent === "09-3-bell-socket";
}

const borrowedSupport: SegmentDefinition = {
  id: "09-3",
  title: "빌려 쓰는 지지물",
  goal: "앞문에 쓴 지지물을 되찾아 뒷방 종축 받침으로 다시 쓰기",
  description: "달 구역의 윈치와 별 구역의 추·바닥 갈고리가 같은 지지물을 다른 경로로 되찾습니다.",
  hints: ["지지물 고리와 회수 레일을 보세요.", "천장 윈치나 추와 바닥 갈고리 중 하나를 쓸 수 있습니다.", "달 구역 천장 보행로를 올라 회수 윈치까지 가서 돌리고, 안쪽으로 온 돌 지지물을 뒷방 종축 홈에 놓은 뒤 출구로 가세요."],
  enter: (previous) => enterWorld("09-3", [
    { ...portable("09-3-support", "돌 지지물", "앞문을 받치고 종축에도 맞는 유일한 큰 지지물입니다.", "09-3", 1, "large", 1, "stone"), parent: "09-3-front-socket" },
    entity("09-3-front-socket", "앞문 지지 홈", "유일한 돌 지지물이 실제로 앞문 하중을 받고 있습니다.", "09-3", 1, "support-socket"),
    entity("09-3-front-door", "앞문", "지지물을 빼면 닫히지만 안쪽 안전 홈이 있습니다.", "09-3", 2, "door", { open: true, locked: false, supportedBy: "09-3-support" }),
    entity("09-3-inside", "문 안쪽 안전 홈", "닫혀도 끼이지 않는 한 칸 홈입니다.", "09-3", 3, "safe-platform", { safe: true, supportRecovered: false }),
    entity("09-3-moon-path", "달 구역 천장 보행로", "역중력 돌 화살표와 천장 가장자리의 고정 가시가 보이는 윈치 길입니다.", "09-3", 1, "gravity-path", { climbable: true, gravity: "up", route: "moon", fixedSpike: true }),
    entity("09-3-star-spike", "별 구역 바닥 가시", "정상중력 바닥 중앙의 고정 가시로, 빈몸 점프 폭이 공개됩니다.", "09-3", 1, "gravity-hazard", { gravity: "normal", route: "star", fixedSpike: true }),
    entity("09-3-moon-winch", "달 구역 회수 윈치", "천장 레일에서 지지물 고리에 닿는 자동 잠금 윈치입니다.", "09-3", 3, "winch", { orientation: 0, route: "moon", connectedTo: "09-3-support" }),
    portable("09-3-weight", "별 구역 이동 추", "앞문 손잡이 장력 한 칸과 같은 큰 추입니다.", "09-3", 3, "large", 1, "metal"),
    entity("09-3-door-handle", "앞문 안쪽 손잡이", "추 한 칸이 걸리면 문을 유지합니다.", "09-3", 3, "weight-socket", { requiredWeight: 1 }),
    entity("09-3-floor-hook", "별 구역 바닥 갈고리", "문 밖 지지물 고리에 닿는 갈고리입니다.", "09-3", 3, "winch", { orientation: 0, route: "star", connectedTo: "09-3-support" }),
    entity("09-3-bell-socket", "뒷방 종축 홈", "회수한 지지물을 다시 받치는 홈입니다.", "09-3", 4, "support-socket"),
    entity("09-3-bell-shaft", "뒷방 종축", "지지물이 홈에 놓이면 수평이 됩니다.", "09-3", 4, "bell-shaft", { supported: false }),
    entity("09-3-exit", "종축 뒤 안전선", "받쳐진 종축 뒤의 출구입니다.", "09-3", 5, "exit", { safe: true }),
  ], previous),
  execute: (state, action) => {
    if ((action.verb === "climb" && action.target === "09-3-moon-path") || (action.verb === "jump" && action.target === "09-3-star-spike")) {
      if (action.verb === "jump" && state.actors[action.actor].carrying.includes("09-3-support")) return blocked(state, "용사와 같은 폭의 돌 지지물을 든 채 바닥 가시를 넘을 수 없어요.");
      const moved = physical(state, action, () => {});
      if (moved.outcome === "done") { moved.world.actors[action.actor].riding = null; moved.world.actors[action.actor].capabilities.push(action.target === "09-3-moon-path" ? "tower-route:moon" : "tower-route:star"); }
      return moved;
    }
    if (action.verb === "turn" && (action.target === "09-3-moon-winch" || action.target === "09-3-floor-hook")) {
      const route = action.target === "09-3-moon-winch" ? "tower-route:moon" : "tower-route:star";
      if (!state.actors[action.actor].capabilities.includes(route)) return blocked(state, "현재 중력 구역의 고정 가시를 실제 안전면으로 지나 회수 장치에 먼저 도착해야 해요.");
      if (action.target === "09-3-floor-hook" && state.entities["09-3-weight"].parent !== "09-3-door-handle") return blocked(state, "앞문 손잡이를 유지할 추 없이 갈고리까지 이동할 수 없어요.");
      const turned = physical(state, action, () => {});
      if (turned.outcome !== "done") return turned;
      turned.world.entities["09-3-support"].parent = null;
      turned.world.entities["09-3-support"].location = { ...turned.world.entities["09-3-inside"].location };
      turned.world.entities["09-3-support"].properties.route = action.target === "09-3-moon-winch" ? "moon-winch" : "star-hook";
      turned.world.entities["09-3-front-door"].properties.locked = action.target === "09-3-moon-winch";
      refreshRecovery(turned.world);
      return result(turned.world, "done", "회수 장치가 지지물 고리를 물어 문 안쪽 안전 홈까지 끌어왔어요.");
    }
    if (crosses(state, action, 1.5) && state.entities["09-3-front-door"].properties.open !== true) return blocked(state, "앞문을 받치던 유일한 지지물을 빼 문이 닫혔어요. 안쪽 유지나 회수 경로가 필요해요.");
    if (crosses(state, action, 4.5) && state.entities["09-3-bell-shaft"].properties.supported !== true) return blocked(state, "뒷방 종축이 아직 처져 출구를 막아요.");
    return physical(state, action, refreshRecovery);
  },
  advance: (state) => { const next = tick(state); refreshRecovery(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => at(state, "hero", "09-3-exit") && state.entities["09-3-bell-shaft"].properties.supported === true
    && (state.entities["09-3-weight"].properties.usedForDoor !== true || state.entities["09-3-weight"].parent === "hero"),
};

function refreshConnection(state: WorldState): void {
  const handle = state.entities["09-4-handle"];
  const weight = state.entities["09-4-weight"];
  const held = handle.properties.held === true || weight.parent === "09-4-handle-socket";
  if (weight.parent === "09-4-handle-socket") weight.properties.usedForHandle = true;
  const bell = state.entities["09-4-bell"];
  const panel = state.entities["09-4-lock-panel"];
  if (Number(panel.properties.orientation) >= 1 && bell.properties.rung === true) panel.properties.locked = true;
  state.entities["09-4-door"].properties.open = panel.properties.locked === true || (held && bell.properties.rung === true);
}

const hiddenPattern: SegmentDefinition = {
  id: "09-4",
  title: "가려지는 연결무늬",
  goal: "손잡이를 유지할 때 연결된 종줄을 당기고 영구 잠금한 뒤 둘 다 출구에 모이기",
  description: "관측한 실제 연결과 유지 역할을 합쳐 원격 문을 영구 고정합니다.",
  hints: ["열린 점검창에서 무늬와 종줄 연결을 보세요.", "한 주체가 유지하고 다른 주체가 종줄과 잠금을 맡습니다.", "다음 순서로 하세요. 용사는 연결 표본을 관찰하고 확인한 종줄 앞으로 이동하세요. 등지기는 중앙 손잡이로 이동해 잡아 유지하세요. 용사는 확인한 종줄을 당기고 원격 잠금판 앞으로 이동해 돌린 뒤 용사 출구로 이동하세요. 마지막으로 등지기는 등지기 출구로 이동하세요."],
  enter: (previous) => enterWorld("09-4", [
    entity("09-4-sample", "열린 연결 표본", "세 무늬 축의 실제 결합은 끝까지 관찰한 현재 시도 기록에서 확인합니다.", "09-4", 0, "connection-sample", { connectedTo: "unknown" }),
    entity("09-4-shutter", "방음 셔터", "연결 표본을 끝까지 보면 내려와 점검창을 가립니다.", "09-4", 0, "shutter", { open: true }),
    entity("09-4-handle", "중앙 연결 손잡이", "잡은 동안만 종줄 축이 큰 종에 맞물립니다.", "09-4", 1, "hold-handle", { holdable: true, held: false, heldBy: "", rail: true }),
    entity("09-4-handle-socket", "손잡이 추 고리", "평형추 한 칸으로 손잡이 장력을 대신합니다.", "09-4", 1, "weight-socket", { requiredWeight: 0.3 }),
    portable("09-4-weight", "고리 달린 평형추", "손잡이 장력 한 칸과 같은 작은 추입니다.", "09-4", 0, "small", 0.3, "metal"),
    entity("09-4-triangle-cord", "삼각 무늬 종줄", "중앙 손잡이에서 두 칸 떨어진 삼각 표식 고정 종줄입니다.", "09-4", 3, "bell-cord", { actuator: true, strokes: 0, rail: true }),
    entity("09-4-circle-cord", "원 무늬 종줄", "중앙 손잡이에서 두 칸 떨어진 원 표식 고정 종줄입니다.", "09-4", 3, "bell-cord", { actuator: true, strokes: 0, rail: true }),
    entity("09-4-square-cord", "사각 무늬 종줄", "중앙 손잡이에서 두 칸 떨어진 사각 표식 고정 종줄입니다.", "09-4", 3, "bell-cord", { actuator: true, strokes: 0, rail: true }),
    entity("09-4-empty-axis", "종에 닿지 않는 빈 축 끝", "원 종줄을 당기면 점검창에 드러나는 끊긴 축 끝입니다.", "09-4", 3, "connection-end", { connectedFrom: "09-4-circle-cord" }),
    entity("09-4-drain-axis", "안전 배출축 끝", "사각 종줄을 당기면 점검창에 드러나는 배출축입니다.", "09-4", 3, "connection-end", { connectedFrom: "09-4-square-cord" }),
    entity("09-4-bell", "큰 종", "점검창의 연결 중 하나가 닿는 종입니다.", "09-4", 3, "bell", { rung: false }),
    entity("09-4-door", "원격 작업문", "종 신호와 중앙 연결이 함께 있으면 열립니다.", "09-4", 4, "door", { open: false }),
    entity("09-4-lock-panel", "영구 잠금판", "종이 울린 뒤 한 번 돌리면 문 축을 고정합니다.", "09-4", 5, "lock-panel", { orientation: 0, locked: false, rail: true }),
    entity("09-4-hero-exit", "용사 출구", "잠금판 너머 안전선입니다.", "09-4", 6, "exit", { safe: true, rail: true }),
    entity("09-4-keeper-exit", "등지기 출구 레일", "잠금 뒤 등지기가 합류하는 레일입니다.", "09-4", 6, "rail-stop", { rail: true, safe: true }),
    entity("09-4-shadow", "두 인형의 종 그림자", "한 손이 축을 붙들면 다른 손이 종을 울린 오래된 그림입니다.", "09-4", 6, "story-object", { optional: true }, { material: "cloth" }),
  ], previous, true),
  execute: (state, action) => {
    const resolution = resolveActionReferences(state, action);
    if (resolution.outcome === "clarification") return result(state, "clarification", resolution.reason);
    action = resolution.action;
    if ((action.verb === "observe" || action.verb === "remember") && action.target === "09-4-sample") {
      const observable = clone(state);
      observable.entities["09-4-sample"].properties.connectedTo = "09-4-triangle-cord";
      const observed = physical(observable, action, () => {});
      if (observed.outcome === "done") {
        observed.world.entities["09-4-sample"].properties.connectedTo = "unknown";
        observed.world.entities["09-4-shutter"].properties.open = false;
        observed.world.visible = observed.world.visible.filter((id) => id !== "09-4-sample");
      }
      return observed;
    }
    if (crosses(state, action, 3.5) && state.entities["09-4-door"].properties.open !== true) return blocked(state, "중앙 연결과 실제 종 신호가 함께 없어 원격 작업문이 닫혀 있어요.");
    if (crosses(state, action, 5.5) && state.entities["09-4-lock-panel"].properties.locked !== true) return blocked(state, "원격 잠금판이 아직 종 연결을 영구 고정하지 않았어요.");
    const executed = physical(state, action, refreshConnection);
    if (executed.outcome === "done" && action.verb === "pull" && action.target === "09-4-triangle-cord") {
      const handle = executed.world.entities["09-4-handle"];
      const maintainedByOther = handle.properties.held === true && handle.properties.heldBy !== action.actor;
      const maintainedByWeight = executed.world.entities["09-4-weight"].parent === "09-4-handle-socket";
      if (maintainedByOther || maintainedByWeight) executed.world.entities["09-4-bell"].properties.rung = true;
      refreshConnection(executed.world);
    }
    if (executed.outcome === "done" && action.verb === "pull" && (action.target === "09-4-circle-cord" || action.target === "09-4-square-cord")) {
      const end = action.target === "09-4-circle-cord" ? "09-4-empty-axis" : "09-4-drain-axis";
      executed.world.entities[action.target].properties.connectedTo = end;
      executed.world.visible = [...new Set([...executed.world.visible, end])];
      return result(executed.world, "done", `${executed.world.entities[action.target].name}의 끝이 큰 종이 아닌 ${executed.world.entities[end].name}으로 드러났어요.`);
    }
    return executed;
  },
  advance: (state) => { const next = tick(state); refreshConnection(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => at(state, "hero", "09-4-hero-exit") && at(state, "keeper", "09-4-keeper-exit") && state.entities["09-4-lock-panel"].properties.locked === true
    && (state.entities["09-4-weight"].properties.usedForHandle !== true || state.entities["09-4-weight"].parent === "hero" || state.entities["09-4-weight"].parent === "keeper"),
};

function refreshTrial(state: WorldState): void {
  const wind = state.entities["09-5-wind-control"];
  const drive = state.entities["09-5-drive"];
  drive.properties.powered = String(wind.properties.route).startsWith("bell-shaft");
  state.entities["09-5-wind-corridor"].properties.wind = drive.properties.powered === true ? "still" : windPhase(state);
  state.entities["09-5-axis"].properties.supported = state.entities["09-3-support"].parent === "09-5-axis-socket";
  const handleHeld = state.entities["09-4-handle"].properties.held === true || currentLoad(state, "09-5-handle-socket") >= Number(state.entities["09-5-handle-socket"].properties.requiredWeight);
  state.entities["09-5-connection"].properties.engaged = handleHeld;
}

const bellTrial: SegmentDefinition = {
  id: "09-5",
  title: "큰 종의 시운전",
  goal: "기류, 종축 지지, 연결된 종줄을 함께 성립시켜 큰 종 울리기",
  description: "세 층의 결과가 탑 단면 모형에서 하나의 기계로 이어집니다.",
  hints: ["단면 모형의 동력·높이·연결 홈을 보세요.", "하층은 기류, 중층은 지지, 상층은 연결입니다.", "다음 순서로 하세요. 용사는 냉각수를 하층 기류판에 붓고 그 기류판을 돌려 바람을 종축 동력 톱니 쪽으로 보낸 뒤 하층 반대편 발판으로 이동하세요. 달 구역 천장길을 올라 회수 윈치를 돌리고, 안전 홈의 돌 지지물을 중층 축 홈에 놓으세요. 등지기는 중앙 연결 손잡이로 이동해 잡아 유지하세요. 용사는 삼각 무늬 종줄 앞으로 이동해 당기고 나선 계단으로 이동하세요. 마지막으로 등지기도 나선 계단으로 이동하세요."],
  enter: (previous) => {
    const support = previous?.entities["09-3-support"] ? structuredClone(previous.entities["09-3-support"]) : portable("09-3-support", "돌 지지물", "앞방에서 회수해 온 유일한 큰 지지물입니다.", "09-5", 2, "large", 1, "stone");
    support.location = { region: "09-5", x: 3, y: 0 }; support.parent = "09-5-front-socket";
    const weight = previous?.entities["09-3-weight"] ? structuredClone(previous.entities["09-3-weight"]) : portable("09-3-weight", "이동 추", "중층에서 회수해 온 장력 한 칸의 추입니다.", "09-5", 3, "large", 1, "metal");
    weight.location = { region: "09-5", x: 4, y: 0 }; weight.parent = null;
    const handle = previous?.entities["09-4-handle"] ? structuredClone(previous.entities["09-4-handle"]) : entity("09-4-handle", "중앙 연결 손잡이", "잡은 동안만 종줄 축이 맞물립니다.", "09-5", 3, "hold-handle", { holdable: true, held: false, heldBy: "", rail: true });
    handle.location = { region: "09-5", x: 4, y: 0 }; handle.properties.held = false; handle.properties.heldBy = ""; handle.properties.rail = true;
    const cord = previous?.entities["09-4-triangle-cord"] ? structuredClone(previous.entities["09-4-triangle-cord"]) : entity("09-4-triangle-cord", "삼각 무늬 종줄", "앞 관측실에서 실제 연결을 확인한 고정 종줄입니다.", "09-5", 3, "bell-cord", { actuator: true, strokes: 0, rail: true });
    cord.location = { region: "09-5", x: 6, y: 0 }; cord.properties.strokes = 0; cord.properties.actuator = true; cord.properties.rail = true;
    const circleCord = previous?.entities["09-4-circle-cord"] ? structuredClone(previous.entities["09-4-circle-cord"]) : entity("09-4-circle-cord", "원 무늬 종줄", "앞 관측실에서 빈 축으로 이어진 고정 종줄입니다.", "09-5", 4, "bell-cord", { actuator: true, strokes: 0, rail: true });
    circleCord.location = { region: "09-5", x: 6, y: 0 }; circleCord.properties.strokes = 0; circleCord.properties.actuator = true; circleCord.properties.rail = true;
    const squareCord = previous?.entities["09-4-square-cord"] ? structuredClone(previous.entities["09-4-square-cord"]) : entity("09-4-square-cord", "사각 무늬 종줄", "앞 관측실에서 안전 배출축으로 이어진 고정 종줄입니다.", "09-5", 4, "bell-cord", { actuator: true, strokes: 0, rail: true });
    squareCord.location = { region: "09-5", x: 6, y: 0 }; squareCord.properties.strokes = 0; squareCord.properties.actuator = true; squareCord.properties.rail = true;
    const world = enterWorld("09-5", [
      entity("09-5-section", "세 층 탑 단면", "동력, 높이, 연결의 세 빈 홈을 실제 장치와 이어 보여 줍니다.", "09-5", 0, "section-model", { connectedTo: "09-5-drive" }),
      entity("09-5-wind-control", "하층 기류판", "멎음 창을 쓰거나 식혀 종축 관으로 고정할 수 있습니다.", "09-5", 1, "wind-control", { amount: 0, cooled: false, orientation: 0, route: "corridor", windowCrossed: false }, { capacity: 1 }),
      entity("09-5-coolant", "하층 냉각수 한 칸 들이 물병", "기류판을 식힐 실제 물이 든 병입니다.", "09-5", 0, "water-vessel", { slot: "small", amount: 1, fluidDensity: 1, recoverable: true }, { movable: true, weight: 0.2, material: "water" }),
      entity("09-5-drive", "종축 동력 톱니", "공개된 기류가 남으면 회전합니다.", "09-5", 1, "drive", { powered: false }),
      entity("09-5-wind-corridor", "하층 안전창 통로", "멎음 안전창이나 우회된 기류에서만 건널 수 있습니다.", "09-5", 1, "wind-corridor", { wind: "strong" }),
      entity("09-5-lower-landing", "하층 반대편 발판", "기류판을 종축으로 돌리는 안전 발판입니다.", "09-5", 2, "safe-platform", { safe: true, rail: true }),
      support,
      entity("09-5-front-socket", "중층 앞문 지지 홈", "회수한 돌 지지물이 다시 앞문 하중을 받고 있습니다.", "09-5", 3, "support-socket"),
      entity("09-5-moon-path", "중층 달 구역 천장길", "역중력 화살표와 천장 가시의 안전면을 따라 윈치로 갑니다.", "09-5", 3, "gravity-path", { climbable: true, gravity: "up", route: "moon", fixedSpike: true }),
      entity("09-5-star-spike", "중층 별 구역 바닥 가시", "정상중력에서 빈몸으로 뛰어 바닥 갈고리에 갑니다.", "09-5", 3, "gravity-hazard", { gravity: "normal", route: "star", fixedSpike: true }),
      entity("09-5-moon-winch", "중층 달 구역 회수 윈치", "앞문 지지물 고리를 중층 안전 홈까지 끌어옵니다.", "09-5", 3, "winch", { orientation: 0, route: "moon", connectedTo: "09-3-support" }),
      entity("09-5-floor-hook", "중층 별 구역 바닥 갈고리", "이동 추가 앞문을 유지할 때 지지물을 회수합니다.", "09-5", 3, "winch", { orientation: 0, route: "star", connectedTo: "09-3-support" }),
      entity("09-5-door-handle", "중층 앞문 추 손잡이", "앞방에서 회수한 이동 추 한 칸으로 앞문을 유지합니다.", "09-5", 3, "weight-socket", { requiredWeight: 1 }),
      entity("09-5-middle-landing", "중층 회수 안전 홈", "윈치나 갈고리가 지지물을 옮기는 중층 안전 홈입니다.", "09-5", 3, "safe-platform", { safe: true }),
      entity("09-5-axis-socket", "중층 축 홈", "앞방에서 회수한 지지물을 받아 큰 종축 높이를 고정합니다.", "09-5", 3, "support-socket"),
      entity("09-5-axis", "큰 종축", "홈의 실제 지지물로 높이가 고정됩니다.", "09-5", 3, "bell-axis", { supported: false }),
      handle,
      entity("09-5-handle-socket", "상층 추 고리", "장력 0.3칸 이상의 실제 추로 손잡이를 대신할 수 있습니다.", "09-5", 4, "weight-socket", { requiredWeight: 0.3 }),
      weight,
      cord,
      circleCord,
      squareCord,
      entity("09-5-connection", "상층 연결축", "유지 장력과 두 칸 떨어진 종줄 동작이 함께 있어야 맞물립니다.", "09-5", 4, "connection", { engaged: false }),
      entity("09-5-bell", "탑의 큰 종", "동력, 지지, 연결 세 상태가 함께 성립할 때 울립니다.", "09-5", 7, "bell", { rung: false }),
      entity("09-5-exit", "나선 계단", "큰 종 뒤의 위험물 없는 감압 출구입니다.", "09-5", 8, "exit", { safe: true, rail: true }),
      entity("09-5-reminiscence", "지나온 탑의 단면", "성공 뒤 잔향 속에서만 천천히 살펴보는 선택 이야기 물체입니다.", "09-5", 8, "story-object", { optional: true }, { material: "stone" }),
    ], previous, true);
    refreshTrial(world);
    return world;
  },
  execute: (state, action) => {
    if (action.verb === "pour" && action.target === "09-5-coolant" && action.destination === "09-5-wind-control") {
      const poured = physical(state, action, () => {}); if (poured.outcome === "done") poured.world.entities["09-5-wind-control"].properties.cooled = Number(poured.world.entities["09-5-wind-control"].properties.amount) >= 1; refreshTrial(poured.world); return poured;
    }
    if (action.verb === "turn" && action.target === "09-5-wind-control") {
      if (state.entities["09-5-wind-control"].properties.cooled !== true && windPhase(state) !== "still") return blocked(state, "기류판은 뜨겁고 공개된 멎음 창도 아니에요.");
      const turned = physical(state, action, () => {});
      if (turned.outcome !== "done") return turned;
      const next = turned.world;
      if (next.entities["09-5-wind-control"].properties.cooled === true) next.entities["09-5-wind-control"].properties.route = "bell-shaft-diverted";
      else { next.entities["09-5-wind-control"].properties.windowCrossed = at(next, action.actor, "09-5-lower-landing"); if (next.entities["09-5-wind-control"].properties.windowCrossed !== true) return blocked(state, "멎음 안전창을 실제로 건너 반대편 발판에서 기류판을 돌려야 해요."); next.entities["09-5-wind-control"].properties.route = "bell-shaft-window"; }
      refreshTrial(next); return result(next, "done", "하층 기류가 종축 동력 톱니로 이어졌어요.");
    }
    if ((action.verb === "climb" && action.target === "09-5-moon-path") || (action.verb === "jump" && action.target === "09-5-star-spike")) {
      const moved = physical(state, action, () => {});
      if (moved.outcome === "done") { moved.world.actors[action.actor].riding = null; moved.world.actors[action.actor].capabilities.push(action.target === "09-5-moon-path" ? "tower-finale-route:moon" : "tower-finale-route:star"); }
      return moved;
    }
    if (action.verb === "turn" && (action.target === "09-5-moon-winch" || action.target === "09-5-floor-hook")) {
      const moon = action.target === "09-5-moon-winch";
      if (!state.actors[action.actor].capabilities.includes(moon ? "tower-finale-route:moon" : "tower-finale-route:star")) return blocked(state, "중층의 고정 중력 가시를 실제 안전면으로 지나 회수 장치에 도착해야 해요.");
      if (!moon && state.entities["09-3-weight"].parent !== "09-5-door-handle") return blocked(state, "별 구역 바닥 갈고리를 쓰려면 이동 추가 앞문 손잡이를 유지해야 해요.");
      const turned = physical(state, action, () => {}); if (turned.outcome !== "done") return turned;
      turned.world.entities["09-3-support"].parent = null; turned.world.entities["09-3-support"].location = { ...turned.world.entities["09-5-middle-landing"].location };
      turned.world.entities["09-3-support"].properties.route = moon ? "moon-winch" : "star-hook";
      if (!moon) turned.world.entities["09-5-door-handle"].properties.locked = true;
      refreshTrial(turned.world); return result(turned.world, "done", "중층 회수 장치가 같은 돌 지지물을 안전 홈으로 되가져왔어요.");
    }
    if (action.target === "09-3-support" && state.entities["09-3-support"].parent === "09-5-front-socket" && (action.verb === "take" || action.verb === "place" || action.verb === "push" || action.verb === "pull")) return blocked(state, "돌 지지물은 중층 앞문의 하중을 받고 있어 손으로 바로 뺄 수 없어요. 달 윈치나 별 갈고리로 안전 홈에 먼저 회수해야 해요.");
    if (crosses(state, action, 1.5) && state.entities["09-5-wind-corridor"].properties.wind !== "still") return blocked(state, "하층 난간망이 현재 안전 발판에서 용사를 받아 냈어요.");
    if (crosses(state, action, 7.5) && state.entities["09-5-bell"].properties.rung !== true) return blocked(state, "단면 모형의 세 홈 중 아직 비어 있는 상태가 있어요.");
    const executed = physical(state, action, refreshTrial);
    if (executed.outcome === "done" && action.verb === "pull" && action.target === "09-4-triangle-cord") {
      const maintainedByOther = executed.world.entities["09-4-handle"].properties.held === true && executed.world.entities["09-4-handle"].properties.heldBy !== action.actor;
      const maintainedByWeight = currentLoad(executed.world, "09-5-handle-socket") >= Number(executed.world.entities["09-5-handle-socket"].properties.requiredWeight);
      if (executed.world.entities["09-5-drive"].properties.powered === true && executed.world.entities["09-5-axis"].properties.supported === true && (maintainedByOther || maintainedByWeight)) executed.world.entities["09-5-bell"].properties.rung = true;
      refreshTrial(executed.world);
    }
    return executed;
  },
  advance: (state) => { const next = tick(state); refreshTrial(next); return { world: next, events: [], canChange: true }; },
  complete: (state) => at(state, "hero", "09-5-exit") && at(state, "keeper", "09-5-exit") && state.entities["09-5-bell"].properties.rung === true && state.entities.letter.parent === "hero",
};

export const TOWER_STAGE: CampaignStageDefinition = {
  contentRevision: "shared-v1",
  id: STAGE_ID,
  title: "종탑의 안쪽",
  practice,
  segments: [twoRoomShaft, safeWindow, borrowedSupport, hiddenPattern, bellTrial],
  story: {
    afterSegment: "09-5",
    object: "09-5-reminiscence",
    text: "큰 종의 잔향 사이로 지나온 탑의 모든 방이 하나의 기계였다는 윤곽이 남았다.",
  },
};
