import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../level";
import { executePhysicalAction } from "../physics";
import type { ActionResult } from "../program";
import type { Entity, PhysicalAction, Scalar, WorldState } from "../types";

const STAGE_ID = 5 as const;
type Gravity = "down" | "up" | "left" | "right" | "normal";
type SeedShape = "sun" | "leaf" | "moon" | "drop";

const GRAVITY_LABEL: Record<Gravity, string> = {
  down: "아래",
  up: "위",
  left: "왼쪽",
  right: "오른쪽",
  normal: "바닥",
};
const SHAPE_LABEL: Record<SeedShape, string> = {
  sun: "해",
  leaf: "잎",
  moon: "달",
  drop: "물방울",
};

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

function room(id: string, name: string, region: string, gravity: Gravity): Entity {
  return entity(
    id,
    name,
    `${name}의 돌 화살표와 흙가루가 ${GRAVITY_LABEL[gravity]} 방향의 고정 중력을 함께 보여 줍니다.`,
    region,
    0,
    "room-gravity-marker",
    { gravity, fixedGravity: true, arrowVisible: true, dustVisible: true },
    { material: "stone" },
  );
}

function railPot(
  id: string,
  name: string,
  description: string,
  region: string,
  x: number,
  track: string,
  weight = 1,
): Entity {
  return entity(id, name, description, region, x, "rail-pot", {
    railFixed: true,
    fixedHooks: 2,
    track,
    slot: "large",
    climbable: true,
    boardable: false,
  }, { material: "stone", movable: true, weight, capacity: 1 });
}

function railSocket(
  id: string,
  name: string,
  description: string,
  region: string,
  x: number,
  track: string,
  extra: Record<string, Scalar> = {},
): Entity {
  return entity(id, name, description, region, x, "rail-socket", {
    acceptsTrack: track,
    railSocket: true,
    ...extra,
  });
}

function seed(id: string, name: string, region: string, x: number, shape: SeedShape): Entity {
  return entity(
    id,
    name,
    `${SHAPE_LABEL[shape]} 문양 돌기가 난 작은 계절 씨앗입니다. 한 손에 하나만 들 수 있습니다.`,
    region,
    x,
    "season-seed",
    { slot: "small", shape, handSlots: 1, heldSlots: 0 },
    { material: "wood", movable: true, weight: 0.1 },
  );
}

function clone(state: WorldState): WorldState {
  return structuredClone(state);
}

function result(state: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult {
  return { world: state, outcome, reason };
}

function blocked(state: WorldState, reason: string): ActionResult {
  return result(state, "blocked", reason);
}

function clarification(state: WorldState, reason: string): ActionResult {
  return result(state, "clarification", reason);
}

function isMovement(action: PhysicalAction): boolean {
  return action.verb === "move" || action.verb === "jump" || action.verb === "duck";
}

function distance(left: Entity["location"], right: Entity["location"]): number {
  return left.region === right.region ? Math.hypot(left.x - right.x, left.y - right.y) : Number.POSITIVE_INFINITY;
}

function gravityOf(state: WorldState, region: string): Gravity | null {
  const marker = Object.values(state.entities).find((item) =>
    item.location.region === region && item.properties.kind === "room-gravity-marker",
  );
  const gravity = marker?.properties.gravity;
  return gravity === "down" || gravity === "up" || gravity === "left" || gravity === "right" || gravity === "normal"
    ? gravity
    : null;
}

function setActorGravity(state: WorldState, gravity: Gravity): void {
  const hero = state.actors.hero;
  hero.capabilities = [...hero.capabilities.filter((item) => !item.startsWith("gravity:")), `gravity:${gravity}`];
}

function baseWorld(segmentId: string, entities: Entity[], region = segmentId): WorldState {
  const hero = makeHero(region, 0);
  hero.capabilities.push(`gravity:${gravityOf(makeWorld(STAGE_ID, segmentId, entities), region) ?? "normal"}`);
  const state = makeWorld(STAGE_ID, segmentId, entities, hero);
  const letter = state.entities.letter;
  if (letter) letter.properties.publicLabel = letter.name;
  return state;
}

function advanceTick(state: WorldState): WorldState {
  const next = clone(state);
  next.tick += 1;
  return next;
}

function moveEntityTree(state: WorldState, id: string, location: Entity["location"], seen = new Set<string>()): void {
  if (seen.has(id)) return;
  seen.add(id);
  const item = state.entities[id];
  if (!item) return;
  item.location = { ...location };
  for (const child of Object.values(state.entities)) {
    if (child.parent === id) moveEntityTree(state, child.id, location, seen);
  }
}

function syncActorCargo(state: WorldState, actorId: PhysicalAction["actor"]): void {
  const actor = state.actors[actorId];
  if (!actor) return;
  for (const id of actor.carrying) moveEntityTree(state, id, actor.location);
}

function releaseActorHold(state: WorldState, actorId: PhysicalAction["actor"]): void {
  const actor = state.actors[actorId];
  if (!actor?.holding) return;
  const device = state.entities[actor.holding];
  actor.holding = null;
  if (!device) return;
  device.properties.held = false;
  device.properties.heldBy = "";
  device.properties.heldWith = "";
  const effectEntity = device.properties.holdEffectEntity;
  const effectProperty = device.properties.holdEffectProperty;
  const releaseValue = device.properties.releaseEffectValue;
  if (typeof effectEntity === "string" && typeof effectProperty === "string" && releaseValue !== undefined) {
    const affected = state.entities[effectEntity];
    if (affected) affected.properties[effectProperty] = releaseValue;
  }
}

function moveActorOnly(state: WorldState, action: PhysicalAction, targetId: string): ActionResult {
  const target = state.entities[targetId];
  if (!target) return clarification(state, "표시된 중력 경계를 찾을 수 없어요.");
  const next = clone(state);
  const hero = next.actors[action.actor];
  releaseActorHold(next, action.actor);
  hero.location = { ...target.location };
  hero.riding = null;
  syncActorCargo(next, action.actor);
  const gravity = gravityOf(next, hero.location.region);
  if (gravity) setActorGravity(next, gravity);
  return result(next, "done", `${target.name}을 지나 용사에게만 ${gravity ? GRAVITY_LABEL[gravity] : "표시된"} 방향 중력이 적용됐어요.`);
}

function railPush(state: WorldState, action: PhysicalAction): ActionResult {
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  const destination = action.destination ? state.entities[action.destination] : undefined;
  if (!actor || !target || !destination) return clarification(state, "밀 대상과 한 칸 뒤 레일 홈을 함께 지정해 주세요.");
  if (target.properties.railFixed !== true) return executePhysicalAction(state, action);
  if (actor.riding !== null) {
    return clarification(state, `${state.entities[actor.riding]?.name ?? "올라탄 물체"}에서 먼저 내려야 레일 물체를 밀 수 있어요.`);
  }
  if (actor.location.region !== target.location.region || distance(actor.location, target.location) > 1) {
    return clarification(state, `${target.name}은 손이 닿는 한 칸 밖에 있어요. 먼저 가까이 가 주세요.`);
  }
  if (distance(target.location, destination.location) > 1) {
    return clarification(state, "레일 화분은 맞닿은 홈으로 한 번에 한 칸만 밀 수 있어요.");
  }
  if (destination.properties.acceptsTrack !== target.properties.track) {
    return clarification(state, `${destination.name}은 ${target.name}의 고정 레일과 이어지지 않아요.`);
  }
  const previous = { ...target.location };
  const next = clone(state);
  releaseActorHold(next, action.actor);
  moveEntityTree(next, action.target, next.entities[action.destination!].location);
  next.entities[action.target].parent = destination.properties.railSocket === true ? destination.id : null;
  next.actors[action.actor].location = previous;
  syncActorCargo(next, action.actor);
  return result(next, "done", `${target.name}을(를) 맞닿은 ${destination.name}까지 레일을 따라 한 칸 옮겼어요.`);
}

function fixedRailPreflight(state: WorldState, action: PhysicalAction): ActionResult | null {
  const target = state.entities[action.target];
  if (!target || target.properties.railFixed !== true) return null;
  if (action.verb === "take" || action.verb === "pull") {
    return clarification(state, `${target.name}의 굵은 고정 고리가 레일을 붙잡아 들거나 당길 수 없고, 좌우 한 칸씩 밀 수 있어요.`);
  }
  if (action.verb === "push") return railPush(state, action);
  if (action.verb === "place") return railPush(state, { ...action, verb: "push" });
  return null;
}

function rejectCrossRegionMove(state: WorldState, action: PhysicalAction): ActionResult | null {
  if (!isMovement(action)) return null;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  if (actor && target && actor.location.region !== target.location.region) {
    return clarification(state, "금빛 경계를 통하지 않고 다른 방으로 바로 이동할 수 없어요.");
  }
  return null;
}

function commonExecute(state: WorldState, action: PhysicalAction): ActionResult {
  const fixed = fixedRailPreflight(state, action);
  if (fixed) return fixed;
  const crossing = rejectCrossRegionMove(state, action);
  if (crossing) return crossing;
  if (isMovement(action)) {
    const riddenId = state.actors[action.actor]?.riding;
    const ridden = riddenId ? state.entities[riddenId] : undefined;
    if (ridden && (ridden.movable === false || ridden.properties.railFixed === true)) {
      const steppedOff = clone(state);
      steppedOff.actors[action.actor].riding = null;
      return executePhysicalAction(steppedOff, action);
    }
  }
  return executePhysicalAction(state, action);
}

const practice: SegmentDefinition = {
  id: "05-practice",
  title: "두 방향 돌 화살표",
  goal: "금빛 경계를 건너 용사의 중력만 바뀌고 두 고정 화분은 제자리에 남는지 확인하기",
  description: "서로 다른 돌 화살표가 있는 두 작은 방과 금빛 경계만 둔 본편과 분리된 무료 모형입니다.",
  hints: [
    "두 방의 돌 화살표와 고정 화분의 레일 고리를 비교하세요.",
    "금빛 경계는 방을 움직이지 않고 통과한 용사의 아래 방향만 바꿉니다.",
    "경계를 건너 반대편 관찰점까지 이동해 중력 표식과 화분 위치를 확인하세요.",
  ],
  enter: () => baseWorld("05-practice", [
    room("05-practice-down-room", "아래 화살표 모형방", "05-practice-down", "down"),
    room("05-practice-up-room", "위 화살표 모형방", "05-practice-up", "up"),
    railPot("05-practice-down-pot", "아래 방 고정 화분", "두 고리가 아래 방 레일에 고정된 화분입니다.", "05-practice-down", 1, "practice-down"),
    railPot("05-practice-up-pot", "위 방 고정 화분", "두 고리가 위 방 레일에 고정된 화분입니다.", "05-practice-up", 1, "practice-up"),
    entity("05-practice-boundary", "금빛 양면 경계", "양면 화살표가 통과자의 중력 전환을 알립니다.", "05-practice-up", 0, "gravity-boundary", { actorOnly: true, fromRegion: "05-practice-down", toRegion: "05-practice-up" }),
    entity("05-practice-view", "위 방 관찰점", "위쪽 흙가루와 고정 화분을 함께 볼 수 있는 안전 지점입니다.", "05-practice-up", 2, "safe-platform", { safe: true }),
  ], "05-practice-down"),
  execute: (state, action) => {
    if (isMovement(action) && action.target === "05-practice-boundary" && state.actors.hero.location.region === "05-practice-down") {
      return moveActorOnly(state, action, action.target);
    }
    return commonExecute(state, action);
  },
  advance: (state) => ({ world: advanceTick(state), events: [], canChange: false }),
  complete: (state) => at(state, "hero", "05-practice-view") && state.actors.hero.capabilities.includes("gravity:up"),
};

const rootsWay: SegmentDefinition = {
  id: "05-1",
  title: "뿌리가 향한 곳",
  goal: "고정 화분을 덩굴턱 아래 홈까지 밀고 출구에 도달하기",
  description: "위중력 돌 화살표, 천장 보행로, 한 칸 눈금 레일, 낮은 덩굴턱과 출구가 모두 보입니다.",
  hints: [
    "덩굴턱은 용사의 키보다 높고 화분 윗면은 용사 무게를 버팁니다.",
    "화분의 고리는 레일을 놓지 않지만 화분은 맞닿은 홈으로 밀립니다.",
    "화분 가까이 간 뒤 턱 아래 홈까지 한 칸 밀고 출구로 가세요.",
  ],
  enter: () => baseWorld("05-1", [
    room("05-1-room", "역중력 온실", "05-1", "up"),
    entity("05-1-start", "천장 보행로 입구", "흙가루가 천장 화단으로 떨어지는 안전한 시작점입니다.", "05-1", 0, "safe-platform", { safe: true }),
    railPot("05-1-pot", "고정 레일 화분", "굵은 고리 두 개로 천장 레일에 고정되어 한 칸씩만 밀리는 받침 화분입니다.", "05-1", 1, "05-1-pot-track"),
    railSocket("05-1-step-slot", "덩굴턱 아래 홈", "화분 윗면이 턱 바로 아래에 오도록 표시된 레일 홈입니다.", "05-1", 2, "05-1-pot-track", { underThreshold: true }),
    entity("05-1-threshold", "낮은 덩굴턱", "용사의 키보다 높아 화분 받침 없이 넘을 수 없는 턱입니다.", "05-1", 3, "obstacle", { height: 2, heroReach: 1 }),
    entity("05-1-exit", "온실 출구", "덩굴턱 너머의 안전한 출구입니다.", "05-1", 4, "exit", { safe: true }),
  ]),
  execute: (state, action) => {
    if (isMovement(action) && action.target === "05-1-exit" && state.entities["05-1-pot"].parent !== "05-1-step-slot") {
      return blocked(state, "덩굴턱은 발보다 높고, 화분 레일은 턱 아래 홈까지 이어져 있어요.");
    }
    return commonExecute(state, action);
  },
  advance: (state) => ({ world: advanceTick(state), events: [], canChange: false }),
  complete: (state) => at(state, "hero", "05-1-exit") && state.entities["05-1-pot"].parent === "05-1-step-slot",
};

function lowerDoorOpen(state: WorldState): boolean {
  return state.entities["05-2-lower-pot"].parent === "05-2-pressure-plate";
}

function updateGreenhouse(state: WorldState): void {
  const open = lowerDoorOpen(state);
  state.entities["05-2-door"].properties.open = open;
  state.entities["05-2-pressure-plate"].properties.pressed = open;
}

const twoDirections: SegmentDefinition = {
  id: "05-2",
  title: "두 방향의 온실",
  goal: "아래 방 문을 화분으로 고정하고 위 방 씨앗 주머니를 챙겨 출구로 가기",
  description: "아래·위 중력방의 돌 화살표, 경계 양쪽 고정 화분, 누름판 문, 측면 덩굴 사다리와 씨앗 주머니가 보입니다.",
  hints: [
    "아래 방 화분과 위 방 화분은 이름이 비슷해도 서로 다른 고정 레일에 있습니다.",
    "문은 아래 화분이 누름판에 남아 있을 때만 열리고, 경계에서는 용사만 뒤집힙니다.",
    "위 방에서는 화분 받침 또는 측면 덩굴 사다리로 주머니에 닿을 수 있습니다.",
  ],
  enter: () => baseWorld("05-2", [
    room("05-2-lower-room", "아래중력 온실", "05-2-lower", "down"),
    room("05-2-upper-room", "위중력 온실", "05-2-upper", "up"),
    railPot("05-2-lower-pot", "아래 방 고정 화분", "아래 방 문 누름판과 같은 레일에 고정된 화분입니다.", "05-2-lower", 1, "05-2-lower-track"),
    railSocket("05-2-pressure-plate", "화분 누름판", "화분 무게가 계속 놓여 있어야 문을 유지하는 누름판입니다.", "05-2-lower", 2, "05-2-lower-track", { pressed: false, requiredWeight: 1 }),
    entity("05-2-door", "누름판 문", "압력이 풀리면 한 장치 박자 뒤 닫히는 문입니다.", "05-2-lower", 3, "door", { open: false, closesAfterTicks: 1 }),
    entity("05-2-boundary", "금빛 중력 경계", "통과한 용사에게만 위 방향 중력을 적용하는 두꺼운 아치입니다.", "05-2-upper", 0, "gravity-boundary", { actorOnly: true, fromRegion: "05-2-lower", toRegion: "05-2-upper" }),
    railPot("05-2-upper-pot", "위 방 고정 화분", "위 방 선반 아래 레일에 고정된 발판 화분입니다.", "05-2-upper", 1, "05-2-upper-track"),
    railSocket("05-2-upper-slot", "주머니 아래 홈", "화분을 씨앗 주머니 한 칸 아래에 맞추는 홈입니다.", "05-2-upper", 2, "05-2-upper-track", { belowSeed: true }),
    entity("05-2-side-vine", "측면 덩굴 사다리", "화분을 건드리지 않고 높은 주머니까지 오르는 고정 덩굴입니다.", "05-2-upper", 2, "ladder", { climbable: true, ladder: true, stable: true }, { material: "wood", capacity: 1 }),
    entity("05-2-seed-bag", "매달린 종자 주머니", "위 방 높은 선반에 매달린 작은 종자 주머니입니다.", "05-2-upper", 3, "seed-bag", { slot: "small" }, { material: "cloth", movable: true, weight: 0.2 }),
    entity("05-2-exit", "위 방 출구", "종자 주머니를 챙긴 뒤 도달할 수 있는 안전 출구입니다.", "05-2-upper", 5, "exit", { safe: true }),
  ], "05-2-lower"),
  execute: (state, action) => {
    if (isMovement(action) && action.target === "05-2-boundary" && state.actors.hero.location.region === "05-2-lower") {
      if (!lowerDoorOpen(state)) return blocked(state, "아래 방 누름판 문이 화분 무게로 고정되지 않았어요.");
      return moveActorOnly(state, action, action.target);
    }
    if (isMovement(action) && action.target === "05-2-exit" && !state.actors.hero.carrying.includes("05-2-seed-bag")) {
      return blocked(state, "높은 선반의 종자 주머니를 아직 챙기지 않았어요.");
    }
    if (action.verb === "take" && action.target === "05-2-seed-bag") {
      const supported = (state.actors.hero.riding === "05-2-upper-pot" && state.entities["05-2-upper-pot"].parent === "05-2-upper-slot")
        || state.actors.hero.riding === "05-2-side-vine";
      if (!supported) return clarification(state, "종자 주머니는 높은 선반에 있어 위 방 화분 발판이나 측면 덩굴 사다리를 실제로 올라야 닿아요.");
    }
    const next = commonExecute(state, action);
    if (next.outcome === "done") updateGreenhouse(next.world);
    return next;
  },
  advance: (state) => {
    const next = advanceTick(state);
    updateGreenhouse(next);
    return { world: next, events: [], canChange: false };
  },
  complete: (state) => at(state, "hero", "05-2-exit")
    && state.actors.hero.carrying.includes("05-2-seed-bag")
    && lowerDoorOpen(state),
};

function updateBalance(state: WorldState): void {
  const heavy = state.entities["05-3-heavy-pot"].parent === "05-3-large-stand" ? 3 : 0;
  const first = state.entities["05-3-empty-a"].parent === "05-3-small-a" ? 1 : 0;
  const second = state.entities["05-3-empty-b"].parent === "05-3-small-b" ? 1 : 0;
  const reading = heavy + first + second;
  state.entities["05-3-balance"].properties.reading = reading;
  state.entities["05-3-door"].properties.open = reading >= 2;
  state.entities["05-3-grate"].properties.reinforced = state.entities["05-3-plate"].parent === "05-3-grate";
  state.entities["05-3-grate"].properties.capacity = state.entities["05-3-grate"].properties.reinforced === true ? 4 : 2;
}

const brokenLabel: SegmentDefinition = {
  id: "05-3",
  title: "깨진 표찰",
  goal: "배수 격자를 부수지 않고 균형막대 눈금을 2 이상 채워 문 열기",
  description: "돌열매 화분 하나, 빈 화분 둘, 하중 눈금 배수 격자, 철제 보강판과 세 받침의 연결선이 보입니다.",
  hints: [
    "돌열매 화분의 실제 하중은 3이고 보강 전 격자의 허용 하중은 2입니다.",
    "철판을 격자에 놓으면 허용 하중이 4가 되며, 빈 화분 받침은 격자를 지나지 않습니다.",
    "보강 뒤 큰 받침에 돌열매 화분을 놓거나, 빈 화분 둘을 작은 받침에 하나씩 놓으세요.",
  ],
  enter: () => baseWorld("05-3", [
    room("05-3-room", "정상중력 회랑", "05-3", "normal"),
    entity("05-3-start", "안전 관찰선", "세 화분과 하중 눈금을 한꺼번에 볼 수 있는 시작선입니다.", "05-3", 0, "safe-platform", { safe: true }),
    railPot("05-3-heavy-pot", "갈라진 표찰 화분", "흰 갈라진 표찰과 떼어낼 수 없는 돌열매가 달린 레일 화분입니다.", "05-3", 1, "05-3-heavy-track", 0),
    entity("05-3-stone-fruit", "돌열매", "화분에 고정된 무게 3칸 돌열매입니다.", "05-3", 1, "fixed-load", { fixedToPot: true, load: 3 }, { material: "stone", movable: false, weight: 3, parent: "05-3-heavy-pot" }),
    entity("05-3-plate", "철제 보강판", "배수 격자를 덮으면 허용 하중을 2에서 4로 높이는 레일 판입니다.", "05-3", 1, "reinforcement-plate", { railFixed: true, track: "05-3-plate-track", slot: "large" }, { movable: true, weight: 1 }),
    railSocket("05-3-grate", "약한 배수 격자", "보강 전 허용 하중 2, 철판이 놓이면 허용 하중 4인 격자입니다.", "05-3", 2, "05-3-plate-track", { capacity: 2, reinforced: false }),
    railSocket("05-3-large-stand", "돌열매용 큰 받침", "배수 격자 너머에서 돌열매 화분 3눈금을 균형막대에 전달합니다.", "05-3", 2, "05-3-heavy-track", { scaleContribution: 3 }),
    railPot("05-3-empty-a", "첫째 빈 화분", "별도 레일의 하중 1칸 빈 화분입니다.", "05-3", 1, "05-3-empty-a-track"),
    railSocket("05-3-small-a", "첫째 작은 받침", "첫째 빈 화분의 1눈금을 균형막대에 전달합니다.", "05-3", 2, "05-3-empty-a-track", { scaleContribution: 1 }),
    railPot("05-3-empty-b", "둘째 빈 화분", "다른 별도 레일의 하중 1칸 빈 화분입니다.", "05-3", 3, "05-3-empty-b-track"),
    railSocket("05-3-small-b", "둘째 작은 받침", "둘째 빈 화분의 1눈금을 균형막대에 전달합니다.", "05-3", 4, "05-3-empty-b-track", { scaleContribution: 1 }),
    entity("05-3-balance", "문 앞 균형막대", "현재 눈금과 문이 열리는 2눈금 기준을 표시합니다.", "05-3", 5, "scale", { reading: 0, opensAt: 2 }),
    entity("05-3-door", "균형문", "균형막대가 2눈금 이상일 때 열리는 문입니다.", "05-3", 5, "door", { open: false }),
    entity("05-3-exit", "회랑 출구", "열린 균형문 너머의 안전 지점입니다.", "05-3", 6, "exit", { safe: true }),
  ]),
  execute: (state, action) => {
    if (isMovement(action) && action.target === "05-3-exit" && state.entities["05-3-door"].properties.open !== true) {
      return blocked(state, "균형막대가 2눈금에 못 미쳐 문이 닫혀 있어요.");
    }
    if (action.verb === "push" && action.target === "05-3-heavy-pot" && action.destination === "05-3-large-stand"
      && state.entities["05-3-plate"].parent !== "05-3-grate") {
      const next = clone(state);
      next.entities["05-3-grate"].properties.broken = true;
      next.entities["05-3-grate"].properties.observedLoad = 3;
      return result(next, "failure", "돌열매 하중 3이 보강 전 배수 격자 허용 2를 넘어 격자와 화분 레일이 꺾였어요.");
    }
    const next = commonExecute(state, action);
    if (next.outcome === "done") updateBalance(next.world);
    return next;
  },
  advance: (state) => {
    const next = advanceTick(state);
    updateBalance(next);
    return { world: next, events: [], canChange: false };
  },
  complete: (state) => at(state, "hero", "05-3-exit")
    && Number(state.entities["05-3-balance"].properties.reading) >= 2
    && state.entities["05-3-grate"].properties.broken !== true,
};

function updateCrossedBranches(state: WorldState): void {
  const doorOpen = state.entities["05-4-door-pot"].parent === "05-4-door-slot";
  const coverLocked = state.entities["05-4-cover-pot"].parent === "05-4-cover-slot";
  state.entities["05-4-door"].properties.open = doorOpen;
  state.entities["05-4-cover"].properties.position = coverLocked ? "covered" : "exposed";
  state.entities["05-4-cover"].properties.locked = coverLocked;
  state.entities["05-4-spikes"].properties.danger = !coverLocked;
}

const crossedBranches: SegmentDefinition = {
  id: "05-4",
  title: "교차 가지 회랑",
  goal: "문을 연 뒤 석판으로 덮은 바닥길 또는 측면 덩굴길로 출구에 도달하기",
  description: "문 고정 화분, 방호막 화분, 중앙 중력 경계, 노출 가시, 석판 걸쇠와 측면 덩굴길이 보입니다.",
  hints: [
    "왼쪽 화분은 문, 오른쪽 화분은 가시 위 석판과 각각 연결됩니다.",
    "오른쪽 화분을 바깥 홈에 두면 석판이 덮인 채 잠기고, 덩굴길은 화분 없이도 오를 수 있습니다.",
    "문 화분을 먼저 고정한 뒤 방호막 바닥길 또는 측면 덩굴길 중 하나를 선택하세요.",
  ],
  enter: () => baseWorld("05-4", [
    room("05-4-left-room", "왼쪽 정상중력 방", "05-4-left", "down"),
    room("05-4-right-room", "오른쪽 역중력 방", "05-4-right", "up"),
    railPot("05-4-door-pot", "문 고정 화분", "안쪽 홈에 놓으면 중앙 문을 열린 채 유지하는 왼쪽 레일 화분입니다.", "05-4-left", 1, "05-4-door-track"),
    railSocket("05-4-door-slot", "문 안쪽 홈", "문 고정쇠와 톱니선으로 연결된 안쪽 레일 홈입니다.", "05-4-left", 2, "05-4-door-track", { holdsDoor: true }),
    entity("05-4-door", "중앙 고정문", "왼쪽 화분이 안쪽 홈에 있을 때 열린 채 유지되는 문입니다.", "05-4-left", 3, "door", { open: false }),
    entity("05-4-boundary", "중앙 금빛 문턱", "화분은 건널 수 없고 통과한 용사의 중력만 뒤집는 고정 문턱입니다.", "05-4-right", 0, "gravity-boundary", { actorOnly: true, potsCross: false }),
    railPot("05-4-cover-pot", "방호막 연결 화분", "바깥 홈까지 밀면 석판 방호막을 가시 위로 움직이는 오른쪽 레일 화분입니다.", "05-4-right", 1, "05-4-cover-track"),
    railSocket("05-4-cover-slot", "방호막 바깥 홈", "석판 방호막을 덮인 위치에서 기계 걸쇠로 잠그는 홈입니다.", "05-4-right", 2, "05-4-cover-track", { locksCover: true }),
    entity("05-4-cover", "수평 이동 석판", "현재 노출 또는 덮임과 기계 걸쇠 잠김을 실루엣으로 보여 줍니다.", "05-4-right", 3, "hazard-cover", { position: "exposed", locked: false }),
    entity("05-4-spikes", "바닥 가시", "석판이 잠기지 않으면 접촉 시 부활하는 노출 가시입니다.", "05-4-right", 3, "hazard", { danger: true, coveredBy: "05-4-cover" }),
    entity("05-4-vine", "측면 덩굴길", "화분을 운반할 수 없을 만큼 좁지만 용사는 출구까지 오를 수 있는 길입니다.", "05-4-right", 2, "climb-route", { climbable: true, stable: true, capacity: 1 }, { material: "wood" }),
    entity("05-4-floor-path", "가시 위 바닥길", "석판이 덮여 잠겼을 때만 안전한 평평한 길입니다.", "05-4-right", 4, "floor-route", { safe: false }),
    entity("05-4-route", "선택 경로 표지", "현재 선택 경로를 바닥 또는 덩굴로 표시합니다.", "05-4-right", 4, "route-marker", { selected: "none" }),
    entity("05-4-exit", "교차 회랑 출구", "두 안전 경로가 다시 만나는 출구입니다.", "05-4-right", 5, "exit", { safe: true }),
  ], "05-4-left"),
  execute: (state, action) => {
    if (isMovement(action) && action.target === "05-4-boundary" && state.actors.hero.location.region === "05-4-left") {
      if (state.entities["05-4-door"].properties.open !== true) return blocked(state, "문 고정 화분이 안쪽 홈에 없어 중앙 문이 닫혀 있어요.");
      return moveActorOnly(state, action, action.target);
    }
    if (action.verb === "climb" && action.target === "05-4-vine") {
      const climbed = executePhysicalAction(state, action);
      if (climbed.outcome === "done") climbed.world.entities["05-4-route"].properties.selected = "vine";
      return climbed;
    }
    if (isMovement(action) && (action.target === "05-4-floor-path" || action.target === "05-4-exit")) {
      const route = String(state.entities["05-4-route"].properties.selected);
      const covered = state.entities["05-4-cover"].properties.locked === true;
      if (route !== "vine" && !covered) {
        const next = clone(state);
        next.entities["05-4-spikes"].properties.contact = true;
        return result(next, "failure", "문은 열렸지만 방호막이 미잠금인 노출 가시 바닥에 닿았어요.");
      }
      const moved = commonExecute(state, action);
      if (moved.outcome === "done" && route !== "vine") moved.world.entities["05-4-route"].properties.selected = "floor";
      return moved;
    }
    const next = commonExecute(state, action);
    if (next.outcome === "done") updateCrossedBranches(next.world);
    return next;
  },
  advance: (state) => {
    const next = advanceTick(state);
    updateCrossedBranches(next);
    return { world: next, events: [], canChange: false };
  },
  complete: (state) => at(state, "hero", "05-4-exit")
    && state.entities["05-4-door"].properties.open === true
    && (state.entities["05-4-route"].properties.selected === "vine"
      || (state.entities["05-4-route"].properties.selected === "floor" && state.entities["05-4-cover"].properties.locked === true)),
};

const seedShapes: readonly SeedShape[] = ["sun", "leaf", "moon", "drop"];
const roomGravity: Record<string, Gravity> = {
  "05-5-normal": "down",
  "05-5-left": "left",
  "05-5-inverted": "up",
  "05-5-right": "right",
  "05-5-central": "normal",
};

function updateCeilingGarden(state: WorldState): void {
  const normalReady = state.entities["05-5-normal-pot"].parent === "05-5-normal-slot";
  const leftReady = state.entities["05-5-left-carrier"].parent === "05-5-left-harvest";
  const rightReady = state.entities["05-5-right-pot"].parent === "05-5-right-pot-slot";
  state.entities["05-5-normal-pot"].properties.accessReady = normalReady;
  state.entities["05-5-left-carrier"].properties.accessReady = leftReady;
  state.entities["05-5-right-lift"].properties.raised = rightReady;
  state.entities["05-5-right-lift"].properties.stable = rightReady;
  if (leftReady && state.entities["05-5-leaf-seed"].parent !== "hero" && state.entities["05-5-leaf-seed"].parent !== "05-5-leaf-slot") {
    state.entities["05-5-leaf-seed"].parent = "05-5-left-carrier";
    state.entities["05-5-leaf-seed"].location = { ...state.entities["05-5-left-carrier"].location };
  }
  const ladder = state.entities["05-5-ladder"];
  ladder.properties.connectedRegion = Number(ladder.properties.orientation) % 2 === 0 ? "05-5-normal" : "05-5-left";
  const placed = seedShapes.filter((shape) => state.entities[`05-5-${shape}-seed`].parent === `05-5-${shape}-slot`).length;
  state.entities["05-5-pedestal"].properties.placed = placed;
  state.entities["05-5-exit"].properties.open = placed === 4;
}

function crossGardenBoundary(state: WorldState, action: PhysicalAction): ActionResult | null {
  if (!isMovement(action)) return null;
  const heroRegion = state.actors.hero.location.region;
  const target = state.entities[action.target];
  if (!target || target.properties.kind !== "gravity-boundary") return null;
  const from = String(target.properties.fromRegion);
  const to = String(target.properties.toRegion);
  if (heroRegion !== from) return clarification(state, `${target.name}은 현재 방에서 이어지는 경계가 아니에요.`);
  const next = moveActorOnly(state, action, action.target);
  if (next.outcome === "done") {
    next.world.actors.hero.location.region = to;
    syncActorCargo(next.world, "hero");
    setActorGravity(next.world, roomGravity[to]);
  }
  return next;
}

function seedAccessReady(state: WorldState, target: Entity): boolean {
  const region = target.location.region;
  if (region === "05-5-normal") return (state.entities["05-5-normal-pot"].parent === "05-5-normal-slot"
      && state.actors.hero.riding === "05-5-normal-pot")
    || (state.entities["05-5-ladder"].properties.connectedRegion === region
      && state.actors.hero.riding === "05-5-normal-ladder-end");
  if (region === "05-5-left") return target.parent === "05-5-left-carrier"
    || (state.entities["05-5-ladder"].properties.connectedRegion === region
      && state.actors.hero.riding === "05-5-left-ladder-end");
  if (region === "05-5-inverted") return state.actors.hero.riding === "05-5-inverted-vine";
  if (region === "05-5-right") return state.entities["05-5-right-lift"].properties.raised === true
    && state.actors.hero.riding === "05-5-right-lift";
  return false;
}

const fourSeasons: SegmentDefinition = {
  id: "05-5",
  title: "네 계절의 천장정원",
  goal: "가시꽃 화분을 건드리지 않고 네 씨앗을 중앙의 같은 문양 홈에 놓아 출구 열기",
  description: "중앙 안전실에서 네 중력방, 각 방의 공개 장치, 회전 덩굴 사다리, 네 문양 홈과 출구를 모두 미리 볼 수 있습니다.",
  hints: [
    "씨앗은 한 손에 하나만 들 수 있고 중앙에서는 같은 문양 홈에만 놓입니다.",
    "정상 방 화분, 좌향 방 운반 레일, 역방 벽 덩굴, 우향 방 승강판이 각각 씨앗에 닿게 합니다.",
    "회전 덩굴 사다리는 정상 방이나 좌향 방의 지역 장치 하나를 대신할 수 있습니다.",
  ],
  enter: () => {
    const state = baseWorld("05-5", [
      room("05-5-central-room", "중앙 안전실", "05-5-central", "normal"),
      room("05-5-normal-room", "정상 방", "05-5-normal", "down"),
      room("05-5-left-room", "좌향 방", "05-5-left", "left"),
      room("05-5-inverted-room", "역중력 방", "05-5-inverted", "up"),
      room("05-5-right-room", "우향 방", "05-5-right", "right"),
      entity("05-5-compass", "네 방향 나침 화살표", "중앙에서 네 방의 고정 중력 방향을 한꺼번에 보여 줍니다.", "05-5-central", 0, "compass", { directions: "down|left|up|right" }),
      entity("05-5-ladder", "회전 덩굴 사다리", "정상 방과 좌향 방 중 한 곳에만 뻗으며 현재 연결 방을 표시합니다.", "05-5-central", 1, "rotating-ladder", { orientation: 0, connectedRegion: "05-5-normal", choices: "05-5-normal|05-5-left" }, { material: "wood" }),
      railPot("05-5-thorn-pot", "가시꽃 고정 화분", "움직이면 해당 중앙 통로를 막는다고 인과선이 표시된 위험 화분입니다.", "05-5-central", 2, "05-5-thorn-track"),
      entity("05-5-pedestal", "네 문양 중앙 받침", "놓인 씨앗 수와 해·잎·달·물방울 촉각 홈을 0/4로 표시합니다.", "05-5-central", 1, "seed-pedestal", { placed: 0, required: 4, shapes: "sun|leaf|moon|drop" }),
      ...seedShapes.map((shape, index) => entity(
        `05-5-${shape}-slot`,
        `${["해", "잎", "달", "물방울"][index]} 문양 홈`,
        `${SHAPE_LABEL[shape]} 문양 돌기 씨앗만 맞는 중앙 촉각 홈입니다.`,
        "05-5-central",
        1,
        "shape-slot",
        { shape, capacity: 1 },
        { capacity: 1 },
      )),
      entity("05-5-exit", "천장정원 출구", "네 씨앗이 맞는 홈에 놓인 동안 열리는 중앙 출구입니다.", "05-5-central", 3, "exit", { open: false, safe: true }),
      entity("05-5-mural", "빈 동행 자리 벽화", "용사 옆 동행 자리만 작은 빛 모양으로 비어 있는 선택 벽화입니다.", "05-5-central", 2, "story-object", { optional: true }, { material: "stone" }),
      ...[
        ["normal", "정상 방 금빛 경계", "05-5-central", "05-5-normal"],
        ["left", "좌향 방 금빛 경계", "05-5-central", "05-5-left"],
        ["inverted", "역방 금빛 경계", "05-5-central", "05-5-inverted"],
        ["right", "우향 방 금빛 경계", "05-5-central", "05-5-right"],
      ].flatMap(([key, label, central, remote]) => [
        entity(`05-5-to-${key}`, label, `${label}를 지나면 용사의 중력만 해당 방 방향으로 바뀝니다.`, remote, 0, "gravity-boundary", { actorOnly: true, fromRegion: central, toRegion: remote }),
        entity(`05-5-back-${key}`, `${label} 귀환면`, "중앙 안전실로 돌아오면 용사에게 정상중력이 적용됩니다.", central, 0, "gravity-boundary", { actorOnly: true, fromRegion: remote, toRegion: central }),
      ]),
      railPot("05-5-normal-pot", "해 방 발판 화분", "정상 방 높은 선반 아래 홈으로 미는 고정 발판 화분입니다.", "05-5-normal", 1, "05-5-normal-track"),
      railSocket("05-5-normal-slot", "해 선반 아래 홈", "해 씨앗 한 칸 아래의 화분 홈입니다.", "05-5-normal", 2, "05-5-normal-track", { belowSeed: true }),
      entity("05-5-normal-ladder-end", "정상 방 사다리 끝", "중앙 사다리가 정상 방을 향할 때만 오를 수 있는 끝입니다.", "05-5-normal", 2, "ladder-end", { climbable: true, stable: true, capacity: 1 }, { material: "wood" }),
      seed("05-5-sun-seed", "해 문양 봄 씨앗", "05-5-normal", 3, "sun"),
      entity("05-5-left-carrier", "잎 씨앗 운반 레일", "수확 홈에 밀면 높은 잎 씨앗을 받아 손 닿는 곳으로 옮기는 고정 바구니입니다.", "05-5-left", 1, "rail-carrier", { railFixed: true, track: "05-5-left-track", slot: "large", accessReady: false }, { material: "wood", movable: true }),
      railSocket("05-5-left-harvest", "잎 씨앗 수확 홈", "운반 바구니가 높은 씨앗 아래에 맞물리는 레일 홈입니다.", "05-5-left", 2, "05-5-left-track", { belowSeed: true }),
      entity("05-5-left-ladder-end", "좌향 방 사다리 끝", "중앙 사다리가 좌향 방을 향할 때만 오를 수 있는 끝입니다.", "05-5-left", 2, "ladder-end", { climbable: true, stable: true, capacity: 1 }, { material: "wood" }),
      seed("05-5-leaf-seed", "잎 문양 여름 씨앗", "05-5-left", 3, "leaf"),
      entity("05-5-inverted-vine", "역방 벽 덩굴", "역중력 방의 높은 달 씨앗까지 이어지는 고정 덩굴입니다.", "05-5-inverted", 2, "wall-vine", { climbable: true, stable: true, capacity: 1 }, { material: "wood" }),
      seed("05-5-moon-seed", "달 문양 가을 씨앗", "05-5-inverted", 3, "moon"),
      railPot("05-5-right-pot", "승강판 연결 화분", "낮은 홈에 밀면 우향 방 승강판을 씨앗 높이로 올리는 고정 화분입니다.", "05-5-right", 1, "05-5-right-track"),
      railSocket("05-5-right-pot-slot", "승강판 작동 홈", "화분 무게를 낮은 승강판에 전달하는 레일 홈입니다.", "05-5-right", 2, "05-5-right-track", { raisesLift: true }),
      entity("05-5-right-lift", "낮은 승강판", "연결 화분이 작동 홈에 있을 때만 올라가 안정되는 승강판입니다.", "05-5-right", 2, "lift", { climbable: true, raised: false, stable: false }, { capacity: 1 }),
      seed("05-5-drop-seed", "물방울 문양 겨울 씨앗", "05-5-right", 3, "drop"),
    ], "05-5-central");
    updateCeilingGarden(state);
    return state;
  },
  execute: (state, action) => {
    const boundary = crossGardenBoundary(state, action);
    if (boundary) return boundary;
    if (action.verb === "push" && action.target === "05-5-thorn-pot") {
      const next = clone(state);
      next.entities["05-5-thorn-pot"].properties.passageBlocked = true;
      return result(next, "failure", "가시꽃 화분이 움직여 중앙 통로를 실제로 막았어요. 공개된 다른 화분과 덩굴 경로를 확인하세요.");
    }
    if (action.verb === "climb" && (action.target === "05-5-normal-ladder-end" || action.target === "05-5-left-ladder-end")) {
      const expected = action.target === "05-5-normal-ladder-end" ? "05-5-normal" : "05-5-left";
      if (state.entities["05-5-ladder"].properties.connectedRegion !== expected) {
        return blocked(state, "회전 덩굴 사다리가 이 방을 향하지 않아요. 중앙 연결 방향을 먼저 확인하세요.");
      }
    }
    if (action.verb === "climb" && action.target === "05-5-right-lift" && state.entities["05-5-right-lift"].properties.raised !== true) {
      return blocked(state, "승강판이 아직 낮고 불안정해요. 연결 화분을 작동 홈에 놓아야 합니다.");
    }
    const target = state.entities[action.target];
    if (action.verb === "take" && target?.properties.kind === "season-seed") {
      const heldSeed = state.actors.hero.carrying.find((id) => state.entities[id]?.properties.kind === "season-seed");
      if (heldSeed) return clarification(state, `손 1/1을 ${state.entities[heldSeed].name}이 사용 중이에요. 중앙 홈에 먼저 놓아 주세요.`);
      if (!seedAccessReady(state, target)) return clarification(state, `${target.name}은 높은 선반에 있어 이 방의 공개 장치나 연결된 회전 사다리로 먼저 닿아야 해요.`);
    }
    if (action.verb === "place" && target?.properties.kind === "season-seed" && action.destination) {
      const destination = state.entities[action.destination];
      if (destination?.properties.kind === "shape-slot" && destination.properties.shape !== target.properties.shape) {
        const seedShape = target.properties.shape as SeedShape;
        const slotShape = destination.properties.shape as SeedShape;
        return clarification(state, `${target.name}의 ${SHAPE_LABEL[seedShape]} 문양 돌기와 ${destination.name}의 ${SHAPE_LABEL[slotShape]} 문양 홈이 맞지 않아 씨앗을 손에 그대로 두었어요.`);
      }
    }
    const next = commonExecute(state, action);
    if (next.outcome === "done") updateCeilingGarden(next.world);
    return next;
  },
  advance: (state) => {
    const next = advanceTick(state);
    updateCeilingGarden(next);
    return { world: next, events: [], canChange: false };
  },
  complete: (state) => at(state, "hero", "05-5-exit")
    && state.entities["05-5-exit"].properties.open === true
    && seedShapes.every((shape) => state.entities[`05-5-${shape}-seed`].parent === `05-5-${shape}-slot`)
    && state.entities["05-5-thorn-pot"].properties.passageBlocked !== true,
};

export const GARDEN_STAGE: CampaignStageDefinition = {
  id: STAGE_ID,
  title: "뒤집힌 정원",
  practice,
  segments: [rootsWay, twoDirections, brokenLabel, crossedBranches, fourSeasons],
  story: {
    afterSegment: "05-5",
    object: "05-5-mural",
    text: "화분은 거꾸로 자라도, 곁에 있던 자리는 그대로다.",
  },
};

/** Public entity/property vocabulary for interpretation; the physical world remains authoritative. */
export const GARDEN_PUBLIC_CATALOG = Object.fromEntries(
  [practice, ...GARDEN_STAGE.segments].map((segment) => {
    const initial = segment.enter(null);
    return [segment.id, initial.visible.map((id) => initial.entities[id]).filter(Boolean).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      kind: String(item.properties.kind),
      publicLabel: String(item.properties.publicLabel),
      properties: Object.keys(item.properties).sort(),
    }))];
  }),
) as Readonly<Record<string, readonly {
  id: string;
  name: string;
  description: string;
  kind: string;
  publicLabel: string;
  properties: readonly string[];
}[]>>;
