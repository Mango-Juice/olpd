import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../level";
import { executePhysicalAction } from "../physics";
import type { ActionResult } from "../program";
import type { Actor, Entity, PhysicalAction, Scalar, WorldState } from "../types";

const STAGE_ID = 7 as const;

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

function enterWorld(segmentId: string, current: Entity[], previous: WorldState | null, heroX = 0, keeperX = 0): WorldState {
  const retained = previous ? Object.values(previous.entities).map((item) => structuredClone(item)) : [];
  const byId = new Map(retained.map((item) => [item.id, item]));
  for (const item of current) byId.set(item.id, item);
  const hero = makeHero(segmentId, heroX);
  hero.carrying = previous?.actors.hero?.carrying.filter((id) => id !== "letter" && byId.has(id)) ?? [];
  const state = makeWorld(STAGE_ID, segmentId, [...byId.values()], hero);
  const nextKeeper = keeper(segmentId, keeperX);
  nextKeeper.carrying = previous?.actors.keeper?.carrying.filter((id) => byId.has(id)) ?? [];
  state.actors.keeper = nextKeeper;
  for (const actor of [state.actors.hero, state.actors.keeper]) {
    for (const id of actor.carrying) state.entities[id].parent = actor.id;
    moveCarried(state, actor);
  }
  const visible = new Set([...current.map((item) => item.id), "letter"]);
  const exposed = new Set<string>();
  const exposeTree = (id: string): void => {
    if (exposed.has(id)) return;
    exposed.add(id);
    visible.add(id);
    for (const child of Object.values(state.entities)) if (child.parent === id) exposeTree(child.id);
  };
  for (const actor of [state.actors.hero, state.actors.keeper]) for (const id of actor.carrying) exposeTree(id);
  state.visible = [...visible];
  return state;
}

function clone(state: WorldState): WorldState { return structuredClone(state); }
function result(state: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult { return { world: state, outcome, reason }; }
function clarification(state: WorldState, reason: string): ActionResult { return result(state, "clarification", reason); }
function blocked(state: WorldState, reason: string): ActionResult { return result(state, "blocked", reason); }
function tick(state: WorldState): WorldState { const next = clone(state); next.tick += 1; return next; }
function movement(action: PhysicalAction): boolean { return action.verb === "move" || action.verb === "jump" || action.verb === "duck" || action.verb === "climb"; }
function distance(left: Actor["location"], right: Entity["location"]): number {
  return left.region === right.region ? Math.hypot(left.x - right.x, left.y - right.y) : Number.POSITIVE_INFINITY;
}
function nextStepX(state: WorldState, action: PhysicalAction): number | null {
  if (!movement(action)) return null;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return null;
  const delta = target.location.x - actor.location.x;
  return actor.location.x + Math.sign(delta) * Math.min(1, Math.abs(delta));
}
function crosses(state: WorldState, action: PhysicalAction, x: number): boolean {
  const actor = state.actors[action.actor];
  const nextX = nextStepX(state, action);
  if (!actor || nextX === null) return false;
  return (actor.location.x < x && nextX >= x) || (actor.location.x > x && nextX <= x);
}
function moveCarried(state: WorldState, actor: Actor): void {
  const moveTree = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const item = state.entities[id];
    if (!item) return;
    item.location = { ...actor.location };
    for (const child of Object.values(state.entities)) if (child.parent === id) moveTree(child.id, seen);
  };
  for (const id of actor.carrying) moveTree(id);
}
/** Stage seven exposes distance as time: one persisted cell is crossed per scheduler boundary. */
function executeTheatrePhysical(state: WorldState, action: PhysicalAction): ActionResult {
  return action.verb === "move" || action.verb === "jump" || action.verb === "duck"
    ? executePhysicalAction(state, action, { movementStep: 1 })
    : executePhysicalAction(state, action);
}
function donePhysical(state: WorldState, action: PhysicalAction, refresh: (world: WorldState) => void): ActionResult {
  const physical = executeTheatrePhysical(state, action);
  if (physical.outcome === "done" || physical.outcome === "progress") refresh(physical.world);
  return physical;
}
function bothAt(state: WorldState, heroExit: string, keeperExit = heroExit): boolean {
  return at(state, "hero", heroExit) && at(state, "keeper", keeperExit);
}
function portableWeight(id: string, name: string, region: string, x: number): Entity {
  return entity(id, name, "작은 고리 한 칸에 거는 0.3 눈금 평형추입니다.", region, x, "counterweight", {
    slot: "small", weightMark: 0.3, recoverable: true,
  }, { movable: true, weight: 0.3 });
}
function railStop(id: string, name: string, region: string, x: number, extra: Record<string, Scalar> = {}): Entity {
  return entity(id, name, "등지기의 톱니 발이 맞물리는 레일 표식입니다.", region, x, "rail-stop", { rail: true, safe: true, ...extra });
}

function refreshPractice(state: WorldState): void {
  const handle = state.entities["07-practice-handle"];
  const wedge = state.entities["07-practice-wedge"];
  const door = state.entities["07-practice-door"];
  const wedged = wedge.parent === "07-practice-socket";
  door.properties.wedged = wedged;
  door.properties.open = handle.properties.held === true || wedged;
  door.properties.support = wedged ? wedge.id : "none";
}

const practice: SegmentDefinition = {
  id: "07-practice",
  title: "손과 쐐기의 차이",
  goal: "손잡이로 문을 연 뒤 쐐기로 고정하고, 쐐기를 다시 빼 닫히는 관계까지 확인하기",
  description: "본편과 분리된 모형입니다. 손의 유지, 쐐기의 물리 고정, 해제 뒤 복귀가 나란히 보입니다.",
  hints: [
    "손잡이의 장력선과 문 아래 쐐기 홈을 함께 보세요.",
    "손은 떠나면 풀리지만, 홈에 놓인 쐐기는 실제 받침으로 남습니다.",
    "손잡이를 잡아 문을 열고 쐐기를 홈에 둔 뒤 손을 놓으세요. 마지막에는 쐐기를 회수하세요.",
  ],
  enter: () => enterWorld("07-practice", [
    railStop("07-practice-start", "연습 레일 시작", "07-practice", -1),
    entity("07-practice-wedge", "나무 쐐기", "작은 고리 한 칸으로 옮겨 문 아래 홈에 받칠 수 있습니다.", "07-practice", 0, "wedge", {
      slot: "small", recoverable: true, fits: "07-practice-socket",
    }, { material: "wood", movable: true, weight: 0.2 }),
    entity("07-practice-handle", "되돌아오는 손잡이", "잡은 동안만 용수철문을 들어 올리는 손잡이입니다.", "07-practice", 1, "spring-handle", {
      holdable: true, held: false, heldBy: "", causalTarget: "07-practice-door.open",
    }),
    entity("07-practice-socket", "문 아래 쐐기 홈", "열린 문 아래에 쐐기가 실제로 들어가는 홈입니다.", "07-practice", 1, "wedge-socket", { accepts: "counterweight" }, { capacity: 0.5 }),
    entity("07-practice-door", "작은 용수철문", "손 장력이나 홈의 쐐기 중 하나가 받치면 열립니다.", "07-practice", 2, "spring-door", { open: false, wedged: false, support: "none" }),
    railStop("07-practice-return", "연습 복귀 지점", "07-practice", 0),
  ], null),
  execute: (state, action) => {
    if (action.verb === "place" && action.target === "07-practice-wedge" && action.destination === "07-practice-socket" && state.entities["07-practice-door"].properties.open !== true) {
      return blocked(state, "문이 닫혀 있어 쐐기 홈이 드러나지 않았어요. 먼저 손잡이로 문을 들어야 해요.");
    }
    if (action.actor === "hero" && crosses(state, action, 1.5) && state.entities["07-practice-door"].properties.open !== true) {
      return blocked(state, "용수철문은 손이나 쐐기가 받치지 않아 닫혀 있어요.");
    }
    return donePhysical(state, action, refreshPractice);
  },
  advance: (state) => { const next = tick(state); refreshPractice(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => at(state, "hero", "07-practice-return")
    && state.entities["07-practice-wedge"].parent === null
    && state.entities["07-practice-door"].properties.open === false,
};

function refreshCurtain(state: WorldState, elapsed = false): void {
  const handle = state.entities["07-1-curtain-handle"];
  const curtain = state.entities["07-1-curtain"];
  if (handle.properties.held === true) {
    curtain.properties.open = true;
    curtain.properties.closingBeatsRemaining = 3;
  } else if (elapsed && curtain.properties.open === true) {
    curtain.properties.closingBeatsRemaining = Math.max(0, Number(curtain.properties.closingBeatsRemaining) - 1);
    curtain.properties.open = Number(curtain.properties.closingBeatsRemaining) > 0;
  }
  curtain.properties.heldBy = handle.properties.heldBy;
  state.entities["07-1-arrival"].properties.heroArrived = at(state, "hero", "07-1-arrival");
}

function releaseCurtainHandle(state: WorldState, actor: "hero" | "keeper"): ActionResult {
  const released = executePhysicalAction(state, { kind: "action", actor, verb: "release", target: "07-1-curtain-handle" });
  if (released.outcome !== "done") return released;
  released.world.entities["07-1-curtain"].properties.open = true;
  released.world.entities["07-1-curtain"].properties.closingBeatsRemaining = 3;
  refreshCurtain(released.world);
  return result(released.world, "done", "손잡이를 놓아 무대막이 세 박자 하강을 시작했어요.");
}

const openingHand: SegmentDefinition = {
  id: "07-1",
  title: "막이 오르는 손",
  goal: "등지기가 막을 유지하는 동안 용사가 통과하고, 도착 뒤 손을 놓아 둘 다 출구에 서기",
  description: "막까지 이어진 장력선, 두 주체의 위치, 용사 도착 사건이 공개된 안전한 도입입니다.",
  hints: [
    "막 손잡이에는 등지기 레일이, 통로에는 용사의 달 발자국이 이어집니다.",
    "등지기는 유지하고 용사는 이동해야 하므로 두 역할은 서로 다른 몸에 있어야 합니다.",
    "등지기는 용사가 도착할 때까지 손잡이를 잡고, 용사는 도착 지점으로 가세요. 그 뒤 놓고 둘 다 출구로 가세요.",
  ],
  enter: (previous) => enterWorld("07-1", [
    railStop("07-1-start", "무대 입구 안전 지점", "07-1", 0),
    entity("07-1-ability", "등지기 능력판", "레일 이동, 손잡이 하나 유지, 작은 추 하나 운반이 가능하고 점프와 계단은 불가능합니다.", "07-1", 0, "ability-board", {
      railOnly: true, holdCapacity: 1, carryCapacity: 1, carrySize: "small", maxWeight: 0.5, jump: false, stairs: false,
      keeperTravelCells: 3, heroTravelCells: 5, curtainCloseBeats: 3,
    }, { material: "cloth", reach: 8 }),
    entity("07-1-curtain-handle", "무대막 손잡이", "등지기 시작점에서 레일 세 칸 뒤, 잡은 동안만 막을 완전히 올리는 큰 손잡이입니다.", "07-1", 3, "hold-handle", {
      rail: true, holdable: true, held: false, heldBy: "", holdEffectEntity: "07-1-curtain", holdEffectProperty: "open", holdEffectValue: true, releaseEffectValue: false,
    }),
    entity("07-1-curtain", "세 박자 무대막", "손을 놓으면 정확히 세 박자에 걸쳐 내려오며 남은 박자가 표시됩니다.", "07-1", 4, "spring-door", { open: false, closingBeats: 3, closingBeatsRemaining: 0, causalControl: "07-1-curtain-handle" }),
    entity("07-1-arrival", "용사 도착 지점", "시작점에서 통로 다섯 칸 뒤의 달 문양 안전 지점입니다.", "07-1", 5, "safe-circle", { safe: true, heroArrived: false }),
    entity("07-1-hero-exit", "용사 출구", "용사가 기다리는 달 문양 출구입니다.", "07-1", 6, "exit", { safe: true }),
    railStop("07-1-keeper-exit", "등지기 출구", "07-1", 6, { exit: true }),
  ], previous),
  execute: (state, action) => {
    if (action.verb === "release" && action.target === "07-1-curtain-handle" && state.entities["07-1-curtain"].properties.open === true) {
      return releaseCurtainHandle(state, action.actor);
    }
    let base = state;
    if (movement(action) && state.actors[action.actor]?.holding === "07-1-curtain-handle") {
      const released = releaseCurtainHandle(state, action.actor);
      if (released.outcome !== "done") return released;
      base = released.world;
    }
    if (action.actor === "hero" && crosses(base, action, 4) && base.entities["07-1-curtain"].properties.open !== true) {
      return blocked(base, "무대막이 닫혀 있어 용사의 통로가 막혔어요. 손잡이의 현재 유지 주체를 확인하세요.");
    }
    return donePhysical(base, action, refreshCurtain);
  },
  advance: (state) => { const next = tick(state); refreshCurtain(next, true); return { world: next, events: [], canChange: next.entities["07-1-curtain"].properties.open === true && next.entities["07-1-curtain-handle"].properties.held !== true }; },
  complete: (state) => bothAt(state, "07-1-hero-exit", "07-1-keeper-exit") && state.actors.keeper.holding === null,
};

function refreshLift(state: WorldState): void {
  const axis = state.entities["07-2-axis"];
  const weight = state.entities["07-2-weight"];
  const livePosition = weight.parent === "07-2-left-stand" ? "right-high" : weight.parent === "07-2-right-stand" ? "left-high" : "neutral";
  if (axis.properties.locked !== true) axis.properties.position = livePosition;
  const position = String(axis.properties.position);
  state.entities["07-2-right-platform"].properties.high = position === "right-high";
  state.entities["07-2-left-rail"].properties.high = position === "left-high";
  state.entities["07-2-left-stand"].properties.loaded = weight.parent === "07-2-left-stand";
  state.entities["07-2-right-stand"].properties.loaded = weight.parent === "07-2-right-stand";
}

const crossedLift: SegmentDefinition = {
  id: "07-2",
  title: "엇갈린 승강 무대",
  goal: "한쪽 판을 올려 축을 잠그고 평형추를 회수한 뒤 두 주체가 각자 출구에 도착하기",
  description: "하나의 실제 추, 좌우 받침, 엇갈린 두 판, 측면 사다리와 축 걸쇠가 모두 보입니다.",
  hints: [
    "추가 어느 받침의 자식인지에 따라 반대쪽 판이 올라갑니다.",
    "축 걸쇠가 잠긴 뒤에는 추를 빼도 높이가 남습니다.",
    "오른쪽 용사 판을 올리거나, 용사가 측면 사다리로 먼저 올라 왼쪽 레일을 올리는 두 경로가 있습니다.",
  ],
  enter: (previous) => enterWorld("07-2", [
    railStop("07-2-start", "승강 무대 시작 지점", "07-2", 0),
    portableWeight("07-2-weight", "작은 평형추", "07-2", 0),
    entity("07-2-left-stand", "왼쪽 추 받침", "추가 놓이면 오른쪽 용사 승강판이 올라갑니다.", "07-2", 1, "weight-stand", { rail: true, loaded: false, raises: "07-2-right-platform" }, { capacity: 0.5 }),
    entity("07-2-side-ladder", "용사 측면 사다리", "용사만 발코니까지 오를 수 있고 등지기는 계단을 오르지 못합니다.", "07-2", 2, "ladder", { ladder: true, stairs: true, climbable: true, keeperAllowed: false }, { capacity: 2 }),
    entity("07-2-axis", "엇갈린 승강 축", "추의 실제 받침 위치에 따라 좌우 높이가 바뀌며 걸쇠 뒤 고정됩니다.", "07-2", 2, "counterweight-axis", { position: "neutral", locked: false, lockedPosition: "none" }),
    entity("07-2-right-stand", "오른쪽 추 받침", "추가 놓이면 왼쪽 등지기 출구 레일이 올라갑니다.", "07-2", 3, "weight-stand", { rail: true, loaded: false, raises: "07-2-left-rail" }, { capacity: 0.5 }),
    entity("07-2-right-platform", "오른쪽 용사 승강판", "오른쪽 판의 현재 높이 표식이 보입니다.", "07-2", 3, "lift-platform", { high: false, boardable: true }, { capacity: 2 }),
    entity("07-2-left-rail", "왼쪽 등지기 승강 레일", "등지기 레일 끝의 현재 높이 표식이 보입니다.", "07-2", 3, "lift-rail", { rail: true, high: false }),
    entity("07-2-balcony", "위 발코니", "용사가 승강판이나 측면 사다리로 도달하는 안전 발코니입니다.", "07-2", 4, "balcony", { safe: true, accessRoute: "none" }),
    entity("07-2-signal", "발코니 신호 종", "측면 사다리 경로에서 등지기에게 오른쪽 받침을 알리는 종입니다.", "07-2", 4, "signal-bell", { on: false }),
    entity("07-2-lock", "승강 축 걸쇠", "판이 올라간 상태에서 돌리면 현재 축 높이를 물리적으로 고정합니다.", "07-2", 4, "latch", { orientation: 0, locked: false, causalTarget: "07-2-axis" }),
    entity("07-2-return", "평형추 반납 받침", "잠근 뒤 회수한 하나의 추를 두 주체의 출구 옆에 반납합니다.", "07-2", 6, "return-tray", { rail: true, returned: false }, { capacity: 0.5 }),
    entity("07-2-hero-exit", "용사 발코니 출구", "축 걸쇠 뒤 용사가 도착할 출구입니다.", "07-2", 6, "exit", { safe: true }),
    railStop("07-2-keeper-exit", "등지기 아래 출구", "07-2", 6, { exit: true }),
  ], previous),
  execute: (state, action) => {
    if (action.actor === "hero" && action.verb === "climb" && action.target === "07-2-side-ladder") {
      const climbed = executeTheatrePhysical(state, { ...action, verb: "move", target: "07-2-balcony" });
      if (climbed.outcome === "done") climbed.world.entities["07-2-balcony"].properties.accessRoute = "side-ladder";
      climbed.reason = climbed.outcome === "done" ? "용사가 측면 사다리로 위 발코니에 올랐어요." : "용사가 측면 사다리를 한 칸 올랐어요.";
      return climbed;
    }
    if (action.actor === "hero" && action.verb === "move" && action.target === "07-2-balcony") {
      if (state.entities["07-2-right-platform"].properties.high !== true) return blocked(state, "오른쪽 용사 승강판이 아직 발코니 높이에 닿지 않았어요.");
      const physical = executeTheatrePhysical(state, action);
      if (physical.outcome === "done") physical.world.entities["07-2-balcony"].properties.accessRoute = "right-platform";
      return physical;
    }
    if (action.verb === "turn" && action.target === "07-2-lock") {
      if (action.actor !== "hero" || !at(state, "hero", "07-2-balcony")) return clarification(state, "축 걸쇠는 위 발코니의 용사만 닿을 수 있어요.");
      if (state.entities["07-2-axis"].properties.position === "neutral") return blocked(state, "어느 판도 올라오지 않아 축 걸쇠와 톱니가 맞물리지 않아요.");
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      const axis = physical.world.entities["07-2-axis"];
      axis.properties.locked = true;
      axis.properties.lockedPosition = axis.properties.position;
      physical.world.entities["07-2-lock"].properties.locked = true;
      refreshLift(physical.world);
      return result(physical.world, "done", "발코니 걸쇠가 현재 승강 축 높이에 맞물렸어요.");
    }
    const physical = donePhysical(state, action, refreshLift);
    if (physical.outcome === "done" && action.verb === "turn" && action.target === "07-2-signal") physical.world.entities["07-2-signal"].properties.on = true;
    return physical;
  },
  advance: (state) => { const next = tick(state); refreshLift(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => bothAt(state, "07-2-hero-exit", "07-2-keeper-exit")
    && state.entities["07-2-axis"].properties.locked === true
    && state.entities["07-2-weight"].parent === "07-2-return",
};

function refreshBridge(state: WorldState): void {
  const plate = state.entities["07-3-pressure"];
  const lock = state.entities["07-3-lock"];
  const bridge = state.entities["07-3-bridge"];
  bridge.properties.extended = plate.properties.held === true || lock.properties.locked === true;
  bridge.properties.support = lock.properties.locked === true ? "latch" : plate.properties.held === true ? `hand:${plate.properties.heldBy}` : "none";
  state.entities["07-3-ceiling-rope"].properties.lowered = plate.properties.held === true;
}

const twoPlaces: SegmentDefinition = {
  id: "07-3",
  title: "혼자서는 두 자리에",
  goal: "한 주체가 발판을 유지하고 다른 주체가 건너 잠근 뒤 둘 다 출구에 도착하기",
  description: "유지 발판, 전개 다리, 등지기 레일, 용사 천장 밧줄과 건너편 큰 걸쇠가 보입니다.",
  hints: [
    "한 몸은 발판을 누르면서 건너편에 설 수 없습니다.",
    "다른 주체가 큰 걸쇠를 잠그면 발판의 손을 놓아도 다리가 남습니다.",
    "용사가 발판을 맡고 등지기가 레일로 건너거나, 역할을 바꾸고 용사가 내려온 밧줄로 건너세요.",
  ],
  enter: (previous) => enterWorld("07-3", [
    railStop("07-3-start", "다리 앞 안전 지점", "07-3", 0),
    entity("07-3-pressure", "다리 유지 발판", "누르는 손이 있는 동안만 다리와 천장 밧줄을 펼칩니다.", "07-3", 1, "hold-plate", {
      holdable: true, held: false, heldBy: "", holdEffectEntity: "07-3-bridge", holdEffectProperty: "extended", holdEffectValue: true, releaseEffectValue: false,
    }),
    entity("07-3-bridge", "접이식 중앙 다리", "발판의 손 장력 또는 건너편 걸쇠로만 펼쳐져 있습니다.", "07-3", 3, "spring-bridge", { extended: false, support: "none", route: "none" }),
    entity("07-3-ceiling-rope", "내려오는 천장 밧줄", "발판이 눌리면 용사 손 높이까지 내려오는 별도 우회로입니다.", "07-3", 2, "climb-rope", { climbable: true, lowered: false }, { material: "cloth", capacity: 2 }),
    railStop("07-3-far-rail", "건너편 걸쇠 레일", "07-3", 5),
    entity("07-3-lock", "다리 큰 걸쇠", "다리가 펼쳐진 동안 돌리면 전개 상태를 손 대신 고정합니다.", "07-3", 5, "latch", { orientation: 0, locked: false, lockedBy: "none" }),
    entity("07-3-hero-exit", "용사 건너편 출구", "달 문양 출구입니다.", "07-3", 6, "exit", { safe: true }),
    railStop("07-3-keeper-exit", "등지기 건너편 출구", "07-3", 6, { exit: true }),
  ], previous),
  execute: (state, action) => {
    const pressure = state.entities["07-3-pressure"];
    const locked = state.entities["07-3-lock"].properties.locked === true;
    if (movement(action) && state.actors[action.actor]?.holding === pressure.id && !locked) {
      const failed = clone(state);
      failed.actors[action.actor].holding = null;
      failed.entities[pressure.id].properties.held = false;
      failed.entities[pressure.id].properties.heldBy = "";
      refreshBridge(failed);
      return result(failed, "failure", "유지 주체가 잠금 전에 발판을 떠나 다리가 실제로 접혔어요.");
    }
    if (action.actor === "hero" && action.verb === "climb" && action.target === "07-3-ceiling-rope") {
      if (state.entities["07-3-ceiling-rope"].properties.lowered !== true) return blocked(state, "천장 밧줄은 발판이 눌릴 때만 용사의 손 높이로 내려와요.");
      const climbed = executeTheatrePhysical(state, { ...action, verb: "move", target: "07-3-far-rail" });
      if (climbed.outcome === "done") climbed.world.entities["07-3-bridge"].properties.route = "ceiling-rope";
      climbed.reason = climbed.outcome === "done" ? "용사가 내려온 천장 밧줄을 타고 건너편 안전 지점에 닿았어요." : "용사가 천장 밧줄을 따라 한 칸 이동했어요.";
      return climbed;
    }
    if (crosses(state, action, 3) && state.entities["07-3-bridge"].properties.extended !== true) {
      return blocked(state, "중앙 다리가 펼쳐지지 않아 건너편까지 이어지지 않아요.");
    }
    if (action.verb === "turn" && action.target === "07-3-lock") {
      if (!at(state, action.actor, "07-3-far-rail")) return clarification(state, "큰 걸쇠는 건너편 레일 바로 옆에서만 닿아요.");
      if (state.entities["07-3-bridge"].properties.extended !== true) return blocked(state, "다리가 접힌 상태라 큰 걸쇠의 홈이 맞지 않아요.");
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["07-3-lock"].properties.locked = true;
      physical.world.entities["07-3-lock"].properties.lockedBy = action.actor;
      if (physical.world.entities["07-3-bridge"].properties.route === "none") physical.world.entities["07-3-bridge"].properties.route = action.actor === "keeper" ? "keeper-rail" : "hero-crossing";
      refreshBridge(physical.world);
      return result(physical.world, "done", "건너편 큰 걸쇠가 다리를 펼친 위치에 고정했어요.");
    }
    const physical = donePhysical(state, action, refreshBridge);
    if (physical.outcome === "done" && movement(action) && action.actor === "keeper" && crosses(state, action, 3)) physical.world.entities["07-3-bridge"].properties.route = "keeper-rail";
    return physical;
  },
  advance: (state) => { const next = tick(state); refreshBridge(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => bothAt(state, "07-3-hero-exit", "07-3-keeper-exit") && state.entities["07-3-lock"].properties.locked === true,
};

function barHolders(state: WorldState): ("hero" | "keeper")[] {
  return String(state.entities["07-4-windbreak"].properties.holders || "").split("|").filter((id): id is "hero" | "keeper" => id === "hero" || id === "keeper");
}
function refreshShow(state: WorldState): void {
  const holders = barHolders(state);
  const bar = state.entities["07-4-windbreak"];
  const lamp = state.entities["07-4-lamp"];
  bar.properties.held = holders.length > 0;
  bar.properties.heldBy = holders.join("|");
  lamp.properties.flame = holders.length > 0 && lamp.properties.snuffed !== true;
  const cart = state.entities["07-4-cart"];
  cart.properties.centered = cart.parent === "07-4-center" || cart.location.x === state.entities["07-4-center"].location.x;
  const crank = state.entities["07-4-crank"];
  state.entities["07-4-door"].properties.open = Number(crank.properties.orientation) >= 2;
}
function holdBar(state: WorldState, actorId: "hero" | "keeper"): ActionResult {
  const actor = state.actors[actorId];
  const bar = state.entities["07-4-windbreak"];
  if (!actor || distance(actor.location, bar.location) > bar.reach) return clarification(state, "넓은 가로대는 현재 손이 닿는 위치에서만 이어 잡을 수 있어요.");
  if (actor.holding && actor.holding !== bar.id) return clarification(state, "한 주체가 두 장치를 동시에 잡아 둘 수 없어요.");
  const next = clone(state);
  const holders = barHolders(next);
  if (!holders.includes(actorId)) holders.push(actorId);
  next.actors[actorId].holding = bar.id;
  next.entities[bar.id].properties.holders = holders.sort().join("|");
  if (holders.length > 1) next.entities[bar.id].properties.handoffs = Number(next.entities[bar.id].properties.handoffs) + 1;
  refreshShow(next);
  return result(next, "done", holders.length > 1 ? "두 주체가 가로대를 함께 잡아 불꽃을 끊지 않고 역할을 넘겨요." : `${actorId === "hero" ? "용사" : "등지기"}가 바람막이 가로대를 잡아 불꽃을 지켜요.`);
}
function releaseBar(state: WorldState, actorId: "hero" | "keeper"): ActionResult {
  const holders = barHolders(state);
  if (!holders.includes(actorId)) return clarification(state, "이 주체는 현재 바람막이 가로대를 잡고 있지 않아요.");
  const next = clone(state);
  const remaining = holders.filter((id) => id !== actorId);
  next.actors[actorId].holding = null;
  next.entities["07-4-windbreak"].properties.holders = remaining.join("|");
  if (remaining.length === 0 && next.entities["07-4-door"].properties.open !== true) next.entities["07-4-lamp"].properties.snuffed = true;
  refreshShow(next);
  return result(next, "done", remaining.length > 0 ? "다른 주체의 손이 남아 불꽃이 이어져요." : "가로대가 빈 한 박자 동안 조명 불꽃이 꺼졌어요.");
}

const threeScenes: SegmentDefinition = {
  id: "07-4",
  title: "세 장면 동시 상연",
  goal: "불꽃을 유지하며 수레를 중앙에 두고 크랭크 두 박자로 문을 연 뒤 둘 다 나가기",
  description: "두 손 폭 가로대, 레일 밧줄, 이동 조명 수레, 중앙 표식과 두 칸 크랭크가 보입니다.",
  hints: [
    "바람막이 가로대가 비는 박자가 생기면 불꽃이 꺼집니다.",
    "용사가 수레를 밀 수 있고, 등지기는 레일 밧줄로 끌 수 있습니다.",
    "등지기가 끝까지 가로대를 잡거나, 용사가 먼저 잡고 등지기가 이어 잡은 뒤 크랭크를 돌리세요.",
  ],
  enter: (previous) => enterWorld("07-4", [
    railStop("07-4-start", "회전 무대 시작 지점", "07-4", 0),
    entity("07-4-windbreak", "넓은 바람막이 가로대", "두 손잡이가 나란해 다른 주체가 이어 잡은 뒤 첫 손이 놓을 수 있습니다.", "07-4", 1, "wide-hold-bar", { holdable: true, held: false, heldBy: "", holders: "", handoffs: 0, causalTarget: "07-4-lamp.flame" }, { reach: 2 }),
    entity("07-4-lamp", "이동 조명 불꽃", "가로대에 손이 이어져 있을 때만 타며, 빈 박자가 생기면 꺼집니다.", "07-4", 2, "flame", { flame: false, snuffed: false }),
    entity("07-4-cart", "이동 조명 수레", "용사는 직접 밀고 등지기는 연결 밧줄로 네 칸 끌 수 있습니다.", "07-4", 1, "light-cart", { slot: "large", centered: false, route: "none", ropeConnected: true }, { movable: true, weight: 1, reach: 2 }),
    entity("07-4-rope-handle", "수레 밧줄 손잡이", "등지기 레일에서 수레와 연결된 손잡이입니다.", "07-4", 1, "rail-rope-handle", { rail: true, connectedTo: "07-4-cart" }, { material: "cloth", reach: 4 }),
    entity("07-4-center", "조명 중앙 표식", "수레 바퀴가 맞물리는 네 칸 거리 중앙 홈입니다.", "07-4", 3, "cart-socket", { centered: true }, { capacity: 2, reach: 4 }),
    entity("07-4-crank", "두 박자 문 크랭크", "각 원자 회전 뒤 안전 눈금이 남고 두 번 뒤 문이 열립니다.", "07-4", 4, "crank", { orientation: 0, requiredTurns: 2, safeBeat: 0 }),
    entity("07-4-door", "중앙 무대문", "불꽃 아래 크랭크 두 박자가 완료되면 열린 채 남습니다.", "07-4", 5, "latched-door", { open: false, causalControls: "lamp+cart+crank" }),
    entity("07-4-shadow-play", "두 인형의 그림자극 판", "두 인형이 손을 맞잡은 선택 소품입니다. 한 손이 막을 들면, 다른 손은 길을 건넜다.", "07-4", 5, "story-prop", { optional: true }, { material: "wood" }),
    entity("07-4-hero-exit", "용사 무대문 출구", "열린 문 뒤 달 문양 안전 지점입니다.", "07-4", 6, "exit", { safe: true }),
    railStop("07-4-keeper-exit", "등지기 무대문 출구", "07-4", 6, { exit: true }),
  ], previous),
  execute: (state, action) => {
    if (action.target === "07-4-windbreak" && action.verb === "hold") return holdBar(state, action.actor);
    if (action.target === "07-4-windbreak" && action.verb === "release") return releaseBar(state, action.actor);
    let base = state;
    if (movement(action) && state.actors[action.actor]?.holding === "07-4-windbreak") {
      const released = releaseBar(state, action.actor);
      if (released.outcome !== "done") return released;
      base = released.world;
    }
    if ((action.verb === "push" || action.verb === "pull") && action.target === "07-4-cart") {
      if (action.destination !== "07-4-center") return clarification(base, "조명 수레의 바퀴가 맞을 중앙 표식을 지정해 주세요.");
      if (action.actor === "hero" && action.verb !== "push") return clarification(base, "용사는 수레 손잡이를 직접 미는 동작을 할 수 있어요.");
      if (action.actor === "keeper" && action.verb !== "pull") return clarification(base, "등지기는 레일의 밧줄 손잡이로 수레를 당길 수 있어요.");
      const physical = executePhysicalAction(base, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["07-4-cart"].parent = "07-4-center";
      physical.world.entities["07-4-cart"].properties.route = action.actor === "keeper" ? "rail-rope" : "hero-push";
      refreshShow(physical.world);
      return physical;
    }
    if (action.verb === "turn" && action.target === "07-4-crank") {
      if (action.actor !== "hero") return clarification(base, "문 크랭크는 용사의 손높이와 힘 눈금에 맞아요.");
      if (base.entities["07-4-cart"].properties.centered !== true) return blocked(base, "조명 수레가 중앙 표식에 없어 크랭크가 드러나지 않았어요.");
      if (base.entities["07-4-lamp"].properties.flame !== true) return blocked(base, "조명 불꽃이 꺼져 크랭크 눈금을 볼 수 없어요.");
      const physical = executePhysicalAction(base, action);
      if (physical.outcome !== "done") return physical;
      physical.world.entities["07-4-crank"].properties.safeBeat = Math.min(2, Number(physical.world.entities["07-4-crank"].properties.orientation));
      refreshShow(physical.world);
      return physical;
    }
    if (crosses(base, action, 5) && base.entities["07-4-door"].properties.open !== true) return blocked(base, "중앙 무대문은 크랭크 두 박자 전이라 닫혀 있어요.");
    return donePhysical(base, action, refreshShow);
  },
  advance: (state) => { const next = tick(state); refreshShow(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => bothAt(state, "07-4-hero-exit", "07-4-keeper-exit") && state.entities["07-4-door"].properties.open === true,
};

function refreshFinale(state: WorldState): void {
  const left = state.entities["07-5-left-weight"];
  const right = state.entities["07-5-right-weight"];
  const bridge = state.entities["07-5-bridge"];
  const live = left.parent === "07-5-left-stand" ? "left" : right.parent === "07-5-right-stand" ? "right" : "neutral";
  if (state.entities["07-5-latch"].properties.locked !== true) bridge.properties.alignment = live;
  state.entities["07-5-left-stand"].properties.loaded = left.parent === "07-5-left-stand";
  state.entities["07-5-right-stand"].properties.loaded = right.parent === "07-5-right-stand";
  const returned = [left, right].filter((weight) => weight.parent === "07-5-return-home").length;
  state.entities["07-5-return-home"].properties.returned = returned;
  state.entities["07-5-curtain"].properties.open = state.entities["07-5-latch"].properties.locked === true && returned === 2;
  state.entities["07-5-spur"].properties.lowered = state.entities["07-5-latch"].properties.locked === true;
}

const finalAct: SegmentDefinition = {
  id: "07-5",
  title: "달의 마지막 막",
  goal: "교각을 맞추고 달빛을 유지해 걸쇠를 세 박자 잠근 뒤 두 추와 두 주체를 출구에 합류시키기",
  description: "두 평형추, 좌우 받침, 회전교, 달빛 손잡이, 세 칸 크랭크, 두 칸 반납 홈이 공개됩니다.",
  hints: [
    "걸쇠와 반납 2/2는 출구 조건판에서 서로 다른 아이콘입니다.",
    "등지기는 달빛을 유지하는 동안 추를 회수하러 갈 수 없습니다.",
    "추로 교각을 맞춘 뒤 등지기는 걸쇠가 잠길 때까지만 빛을 잡고, 완료 뒤 두 추를 반납하세요.",
  ],
  enter: (previous) => enterWorld("07-5", [
    railStop("07-5-start", "원형 무대 시작 지점", "07-5", 0),
    portableWeight("07-5-left-weight", "왼쪽 작은 추", "07-5", 0),
    portableWeight("07-5-right-weight", "오른쪽 작은 추", "07-5", 0),
    entity("07-5-moon-handle", "달 조명 손잡이", "등지기가 잡는 동안만 안쪽 크랭크의 달 문양이 켜집니다.", "07-5", 1, "hold-handle", {
      rail: true, holdable: true, held: false, heldBy: "", holdEffectEntity: "07-5-moon", holdEffectProperty: "on", holdEffectValue: true, releaseEffectValue: false,
    }),
    entity("07-5-moon", "천장 달 조명", "손잡이 장력이 있는 동안 켜지는 실제 조명입니다.", "07-5", 2, "moon-light", { on: false, causalControl: "07-5-moon-handle" }, { material: "light" }),
    entity("07-5-left-stand", "왼쪽 교각 받침", "왼쪽 추가 놓이면 회전교가 왼쪽 안쪽 길에 맞습니다.", "07-5", 2, "weight-stand", { rail: true, loaded: false, alignment: "left" }, { capacity: 0.5 }),
    entity("07-5-right-stand", "오른쪽 교각 받침", "오른쪽 추가 놓이면 회전교가 오른쪽 안쪽 길에 맞습니다.", "07-5", 3, "weight-stand", { rail: true, loaded: false, alignment: "right" }, { capacity: 0.5 }),
    entity("07-5-bridge", "중앙 회전교", "받침 위 실제 추의 위치에 따라 안쪽 길이 맞고, 걸쇠 뒤 그 위치가 남습니다.", "07-5", 3, "rotating-bridge", { alignment: "neutral", lockedAlignment: "none" }),
    entity("07-5-inner", "안쪽 안전 지점", "맞춰진 회전교를 건넌 용사가 세 박자 크랭크 앞에서 기다립니다.", "07-5", 4, "safe-circle", { safe: true }),
    entity("07-5-crank", "달 걸쇠 세 박자 크랭크", "각 회전 뒤 1/3 눈금이 남고 빛이 없어도 진행 눈금은 보존됩니다.", "07-5", 4, "crank", { orientation: 0, requiredTurns: 3, safeBeat: 0 }),
    entity("07-5-latch", "달 자체 걸쇠", "크랭크 세 박자 뒤 닫힌 고리 문양으로 잠깁니다.", "07-5", 4, "latch", { locked: false }),
    entity("07-5-spur", "중앙 반납 지선", "달 걸쇠 뒤 등지기 바깥 레일과 반납 홈을 잇습니다.", "07-5", 4, "rail-spur", { rail: true, lowered: false }),
    entity("07-5-return-home", "두 칸 중앙 반납 홈", "두 작은 추의 실제 부모 관계와 0/2 눈금을 표시합니다.", "07-5", 5, "return-home", { rail: true, returned: 0, required: 2 }, { capacity: 1 }),
    entity("07-5-curtain", "달 출구 커튼", "달 걸쇠와 추 반납 2/2가 함께 맞으면 열립니다.", "07-5", 5, "latched-door", { open: false, causalControls: "07-5-latch.locked+07-5-return-home.returned" }),
    entity("07-5-hero-exit", "용사 중앙 출구", "커튼 뒤 달 문양 합류 지점입니다.", "07-5", 6, "exit", { safe: true }),
    railStop("07-5-keeper-exit", "등지기 중앙 출구", "07-5", 6, { exit: true }),
  ], previous),
  execute: (state, action) => {
    if (action.verb === "hold" && action.target === "07-5-moon-handle" && action.actor !== "keeper") return clarification(state, "달 조명 손잡이는 등지기 레일과 낮은 손높이에 맞아요.");
    if (action.actor === "hero" && action.verb === "move" && action.target === "07-5-inner" && state.entities["07-5-bridge"].properties.alignment === "neutral") {
      return blocked(state, "두 받침이 비어 회전교가 중립 안전 위치라 안쪽 원까지 이어지지 않아요.");
    }
    if (action.verb === "turn" && action.target === "07-5-crank") {
      if (action.actor !== "hero" || !at(state, "hero", "07-5-inner")) return clarification(state, "안쪽 원의 용사만 세 박자 크랭크에 닿을 수 있어요.");
      if (state.entities["07-5-moon"].properties.on !== true) return blocked(state, `달빛이 없어 걸쇠 눈금 ${state.entities["07-5-crank"].properties.safeBeat}/3에서 안전하게 멈췄어요.`);
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      const crank = physical.world.entities["07-5-crank"];
      crank.properties.safeBeat = Math.min(3, Number(crank.properties.orientation));
      if (Number(crank.properties.orientation) >= 3) {
        physical.world.entities["07-5-latch"].properties.locked = true;
        physical.world.entities["07-5-bridge"].properties.lockedAlignment = physical.world.entities["07-5-bridge"].properties.alignment;
      }
      refreshFinale(physical.world);
      return physical;
    }
    if (crosses(state, action, 5.5) && state.entities["07-5-curtain"].properties.open !== true) return blocked(state, "출구 조건판이 달 걸쇠와 추 반납 2/2를 아직 함께 표시하지 않아요.");
    return donePhysical(state, action, refreshFinale);
  },
  advance: (state) => { const next = tick(state); refreshFinale(next); return { world: next, events: [], canChange: false }; },
  complete: (state) => bothAt(state, "07-5-hero-exit", "07-5-keeper-exit")
    && state.entities["07-5-latch"].properties.locked === true
    && state.entities["07-5-left-weight"].parent === "07-5-return-home"
    && state.entities["07-5-right-weight"].parent === "07-5-return-home"
    && state.entities["07-5-curtain"].properties.open === true
    && state.actors.keeper.holding === null,
};

export const THEATRE_STAGE: CampaignStageDefinition = {
  id: STAGE_ID,
  title: "평형 인형극장",
  practice,
  segments: [openingHand, crossedLift, twoPlaces, threeScenes, finalAct],
  story: {
    afterSegment: "07-4",
    object: "07-4-shadow-play",
    text: "한 손이 막을 들면, 다른 손은 길을 건넜다.",
  },
};

/** Public interpretation vocabulary contains readable affordances, limits, reach, and causal controls. */
export const THEATRE_PUBLIC_CATALOG = Object.fromEntries(
  [practice, ...THEATRE_STAGE.segments].map((segment) => {
    const initial = segment.enter(null);
    return [segment.id, initial.visible.map((id) => initial.entities[id]).filter(Boolean).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      kind: String(item.properties.kind),
      movable: item.movable,
      capacity: item.capacity,
      reach: item.reach,
      properties: Object.keys(item.properties).sort(),
    }))];
  }),
) as Readonly<Record<string, readonly {
  id: string;
  name: string;
  description: string;
  kind: string;
  movable: boolean;
  capacity: number;
  reach: number;
  properties: readonly string[];
}[]>>;
