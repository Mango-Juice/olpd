import { elapsedTicks, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SceneComposition, type SegmentDefinition } from "../../../src/campaign/level";
import { resolveActionReferences } from "../../../src/campaign/conditions";
import { executePhysicalAction } from "../../../src/campaign/physics";
import type { ActionExecutor, ActionResult } from "../../../src/campaign/program";
import type { Entity, InstructionProgram, PhysicalAction, ProgramNode, Scalar, WorldState } from "../../../src/campaign/types";
import { authoredPublicKind } from "../../../src/campaign/public-kinds";
import { authoredDefaultWalk } from "./default-walk";

type EarlyStageId = 2 | 3 | 4;

export interface QuietEarlyIntentCase {
  stageId: EarlyStageId;
  segmentId: string;
  text: string;
  body: ProgramNode;
}

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  destination?: string,
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...(destination ? { destination } : {}) });

const waitFor = (entity: string, property: string, value: Scalar): ProgramNode => ({
  kind: "wait",
  until: { kind: "property", entity, property, comparison: "eq", value, source: "visible" },
});

const sequence = (...children: ProgramNode[]): ProgramNode => ({ kind: "sequence", children });

function quietEntity(
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
    reach: 1.25,
    properties,
    ...patch,
    location: { region, x, y },
  });
}

function quietWorld(stageId: EarlyStageId, segmentId: string, entities: Entity[]): WorldState {
  return makeWorld(stageId, segmentId, entities, makeHero(segmentId, 0.5));
}

function clone(state: WorldState): WorldState {
  return structuredClone(state);
}

function outcome(world: WorldState, result: ActionResult["outcome"], reason: string): ActionResult {
  return { world, outcome: result, reason };
}

function failure(state: WorldState, reason: string): ActionResult {
  return outcome(clone(state), "failure", reason);
}

function blocked(state: WorldState, reason: string): ActionResult {
  return outcome(state, "blocked", reason);
}

function moveTree(state: WorldState, id: string, location: Entity["location"], seen = new Set<string>()): void {
  if (seen.has(id)) return;
  seen.add(id);
  const entity = state.entities[id];
  if (entity) entity.location = { ...location };
  for (const child of Object.values(state.entities)) {
    if (child.parent === id) moveTree(state, child.id, location, seen);
  }
}

function moveHero(state: WorldState, location: Entity["location"]): void {
  state.actors.hero.location = { ...location };
  for (const id of state.actors.hero.carrying) moveTree(state, id, location);
}

function moveEntityAndRider(state: WorldState, id: string, location: Entity["location"]): void {
  moveTree(state, id, location);
  for (const actor of Object.values(state.actors)) {
    if (actor.riding !== id) continue;
    actor.location = { ...location };
    for (const carried of actor.carrying) moveTree(state, carried, location);
  }
}

function tick(state: WorldState): WorldState {
  const next = clone(state);
  next.tick += 1;
  return next;
}

function isTravel(action: PhysicalAction, target: string): boolean {
  return (action.verb === "move" || action.verb === "jump" || action.verb === "climb") && action.target === target;
}

function manipulates(action: PhysicalAction, target: string): boolean {
  return action.target === target && (action.verb === "push" || action.verb === "pull" || action.verb === "place");
}

function aimedAt(action: PhysicalAction, ...destinations: string[]): boolean {
  return action.destination === undefined || destinations.includes(action.destination);
}

function executor(handler: (state: WorldState, action: PhysicalAction) => ActionResult | null): ActionExecutor {
  return (state, rawAction) => {
    const resolution = resolveActionReferences(state, rawAction);
    if (resolution.outcome === "clarification") return outcome(state, "clarification", resolution.reason);
    const handled = handler(state, resolution.action);
    return handled ?? executePhysicalAction(state, resolution.action);
  };
}

function moveToGoal(state: WorldState, entityId: string, reason: string): ActionResult {
  const next = clone(state);
  moveHero(next, next.entities[entityId].location);
  return outcome(next, "done", reason);
}

function practiceFrom(segment: SegmentDefinition, id: string): SegmentDefinition {
  return {
    ...segment,
    id,
    title: `${segment.title} 연습`,
    enter: () => {
      const state = segment.enter(null);
      state.segmentId = id;
      state.segmentStartedAt = 0;
      state.actors.hero.location.region = id;
      for (const entity of Object.values(state.entities)) entity.location.region = id;
      return state;
    },
    complete: () => false,
  };
}

function withSharedDefaults(segment: SegmentDefinition): SegmentDefinition {
  return { ...segment, idleAction: authoredDefaultWalk };
}

const FULL_FLOOR: SceneComposition = { floors: [{ from: 0, to: 10, y: 0 }], ceiling: true };
const WATER_GAP: SceneComposition = { floors: [{ from: 0, to: 4, y: 0 }, { from: 6, to: 10, y: 0 }], ceiling: true };
const WIDE_WATER_GAP: SceneComposition = { floors: [{ from: 0, to: 3, y: 0 }, { from: 7, to: 10, y: 0 }], ceiling: true };
const HIGH_EXIT: SceneComposition = { floors: [{ from: 0, to: 5, y: 0 }, { from: 6, to: 10, y: 3 }], ceiling: true };
const HIGH_LEDGE: SceneComposition = { floors: [{ from: 0, to: 10, y: 0 }, { from: 6, to: 10, y: 3 }], ceiling: true };
const RAIN_HINTS = ["바닥의 높이와 빈 공간을 살펴보세요.", "움직일 수 있는 물건의 자리를 비교해 보세요.", "행동 뒤 길의 모양이 달라졌는지 확인하세요."] as const;
const KITCHEN_HINTS = ["장치가 움직이는 모습을 한 주기 지켜보세요.", "지금 보이는 상태가 바뀌는 순간을 살펴보세요.", "안전한 빈자리가 생겼는지 확인하세요."] as const;
const FORGE_HINTS = ["바람이 지금 닿는 곳을 살펴보세요.", "장치를 건드린 뒤 무엇이 움직이는지 보세요.", "손을 뗀 뒤에도 변화가 남는지 확인하세요."] as const;

const rain1: SegmentDefinition = {
  id: "02-v2-1",
  title: "막힌 빗길",
  goal: "편지와 함께 회랑을 건너야 해요.",
  description: "짐상자 · 출구",
  hints: RAIN_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(2, "02-v2-1", [
    quietEntity("02-v2-1-box", "짐상자", "02-v2-1", 4, 0, { kind: "object", blocksPath: true, position: "center" }, { material: "wood", movable: true }),
    quietEntity("02-v2-1-exit", "출구", "02-v2-1", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (manipulates(current, "02-v2-1-box") && aimedAt(current, "02-v2-1-side")) {
      const next = clone(state);
      next.entities["02-v2-1-box"].location.x = 2;
      next.entities["02-v2-1-box"].properties.blocksPath = false;
      next.entities["02-v2-1-box"].properties.position = "aside";
      moveHero(next, { region: next.segmentId, x: 3, y: 0 });
      return outcome(next, "done", "상자가 길 옆으로 비켜났어요.");
    }
    if (isTravel(current, "02-v2-1-exit")) {
      if (state.entities["02-v2-1-box"].properties.blocksPath === true) return failure(state, "상자가 길을 막아 그대로 부딪혔어요.");
      return moveToGoal(state, "02-v2-1-exit", "열린 길을 따라 문에 닿았어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === state.entities["02-v2-1-exit"]?.location.x,
};

const rain2: SegmentDefinition = {
  id: "02-v2-2",
  title: "높은 창",
  goal: "높은 창가에 올라가야 해요.",
  description: "나무상자 · 창가",
  hints: RAIN_HINTS,
  scene: HIGH_LEDGE,
  enter: () => quietWorld(2, "02-v2-2", [
    quietEntity("02-v2-2-box", "나무상자", "02-v2-2", 2, 0, { kind: "object", position: "start", stable: true, climbable: true }, { material: "wood", movable: true, capacity: 3 }),
    quietEntity("02-v2-2-window", "창가", "02-v2-2", 8, 3, { kind: "exit", height: "high", accessReady: false, safe: true }),
  ]),
  execute: executor((state, current) => {
    if (manipulates(current, "02-v2-2-box") && aimedAt(current, "02-v2-2-window")) {
      const next = clone(state);
      const box = next.entities["02-v2-2-box"];
      box.location = { region: next.segmentId, x: 8, y: 0 };
      box.properties.position = "below-window";
      next.entities["02-v2-2-window"].properties.accessReady = true;
      moveHero(next, { region: next.segmentId, x: 7, y: 0 });
      return outcome(next, "done", "상자가 창 바로 아래에 놓였어요.");
    }
    if ((current.verb === "climb" && (current.target === "02-v2-2-box" || current.target === "02-v2-2-window")) || isTravel(current, "02-v2-2-window")) {
      if (state.entities["02-v2-2-window"].properties.accessReady !== true) return failure(state, "창은 맨바닥에서 닿기에는 너무 높아요.");
      return moveToGoal(state, "02-v2-2-window", "상자를 딛고 높은 창에 닿았어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 8 && state.actors.hero.location.y === 3,
};

const rain3: SegmentDefinition = {
  id: "02-v2-3",
  title: "끊긴 바닥",
  goal: "편지와 함께 건너편으로 가야 해요.",
  description: "널빤지 · 바닥 틈 · 건너편",
  hints: RAIN_HINTS,
  scene: WATER_GAP,
  enter: () => quietWorld(2, "02-v2-3", [
    quietEntity("02-v2-3-plank", "널빤지", "02-v2-3", 2, 0, { kind: "bridge", extended: false, stable: true, position: "start" }, { material: "wood", movable: true }),
    quietEntity("02-v2-3-gap", "바닥 틈", "02-v2-3", 5, 0, { kind: "water", safe: false }, { material: "water" }),
    quietEntity("02-v2-3-bank", "건너편", "02-v2-3", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (manipulates(current, "02-v2-3-plank") && aimedAt(current, "02-v2-3-gap", "02-v2-3-bank")) {
      const next = clone(state);
      const plank = next.entities["02-v2-3-plank"];
      plank.location.x = 5;
      plank.properties.extended = true;
      plank.properties.position = "bridge";
      moveHero(next, { region: next.segmentId, x: 3.5, y: 0 });
      return outcome(next, "done", "널빤지가 틈을 가로질러 놓였어요.");
    }
    if (isTravel(current, "02-v2-3-bank")) {
      if (state.entities["02-v2-3-plank"].properties.extended !== true) return failure(state, "빈 틈으로 발을 내디뎌 빗물 아래로 떨어졌어요.");
      return moveToGoal(state, "02-v2-3-bank", "널빤지를 건너 마른 바닥에 닿았어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 9,
};

const rain4: SegmentDefinition = {
  id: "02-v2-4",
  title: "떠 있는 발판",
  goal: "편지와 함께 물 건너로 가야 해요.",
  description: "코르크 발판 · 물웅덩이 · 건너편",
  hints: RAIN_HINTS,
  scene: WIDE_WATER_GAP,
  enter: () => quietWorld(2, "02-v2-4", [
    quietEntity("02-v2-4-cork", "코르크 발판", "02-v2-4", 2.5, 0, { kind: "platform", boardable: true, afloat: true, position: "near", stable: true }, { material: "cork", capacity: 3 }),
    quietEntity("02-v2-4-pool", "물웅덩이", "02-v2-4", 5, 0, { kind: "water", safe: false }, { material: "water" }),
    quietEntity("02-v2-4-bank", "건너편", "02-v2-4", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if ((current.verb === "board" || current.verb === "climb") && current.target === "02-v2-4-cork") {
      const next = clone(state);
      next.actors.hero.riding = "02-v2-4-cork";
      moveHero(next, next.entities["02-v2-4-cork"].location);
      return outcome(next, "done", "코르크 발판에 올라탔어요.");
    }
    const crosses = isTravel(current, "02-v2-4-bank")
      || (current.verb === "dismount" && current.target === "02-v2-4-cork" && current.destination === "02-v2-4-bank");
    if (crosses) {
      if (state.actors.hero.riding !== "02-v2-4-cork") return failure(state, "깊은 물에는 걸어서 들어갈 수 없어요.");
      const next = clone(state);
      moveEntityAndRider(next, "02-v2-4-cork", { region: next.segmentId, x: 8, y: 0 });
      next.entities["02-v2-4-cork"].properties.position = "far";
      next.actors.hero.riding = null;
      moveHero(next, next.entities["02-v2-4-bank"].location);
      return outcome(next, "done", "발판을 타고 물을 건넜어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 9,
};

const rain5: SegmentDefinition = {
  id: "02-v2-5",
  title: "잠긴 아래 계단",
  goal: "아래 계단으로 내려가야 해요.",
  description: "배수 덮개 · 고인 물 · 아래 계단",
  hints: RAIN_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(2, "02-v2-5", [
    quietEntity("02-v2-5-drain", "배수 덮개", "02-v2-5", 2, 0, { kind: "handle", open: false, controls: "02-v2-5-pool" }),
    quietEntity("02-v2-5-pool", "고인 물", "02-v2-5", 5, 0, { kind: "water", safe: false, level: "high" }, { material: "water" }),
    quietEntity("02-v2-5-stairs", "아래 계단", "02-v2-5", 9, 0, { kind: "exit", stairs: true, safe: false }),
  ]),
  execute: executor((state, current) => {
    if (current.verb === "open" && current.target === "02-v2-5-drain") {
      const next = clone(state);
      next.entities["02-v2-5-drain"].properties.open = true;
      next.entities["02-v2-5-pool"].properties.safe = true;
      next.entities["02-v2-5-pool"].properties.level = "low";
      next.entities["02-v2-5-stairs"].properties.safe = true;
      moveHero(next, next.entities["02-v2-5-drain"].location);
      return outcome(next, "done", "배수구가 열리자 계단의 물이 빠졌어요.");
    }
    if (isTravel(current, "02-v2-5-stairs")) {
      if (state.entities["02-v2-5-stairs"].properties.safe !== true) return failure(state, "잠긴 계단으로 들어가 발을 디딜 곳을 잃었어요.");
      return moveToGoal(state, "02-v2-5-stairs", "드러난 계단으로 내려갔어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 9,
};

const rain6: SegmentDefinition = {
  id: "02-v2-6",
  title: "처진 다리",
  goal: "편지와 함께 회랑을 나가야 해요.",
  description: "나무 상자 · 처진 다리 · 출구",
  hints: RAIN_HINTS,
  scene: WATER_GAP,
  enter: () => quietWorld(2, "02-v2-6", [
    quietEntity("02-v2-6-box", "상자", "02-v2-6", 2, 0, { kind: "object", position: "start", supported: false }, { material: "wood", movable: true }),
    quietEntity("02-v2-6-bridge", "처진 다리", "02-v2-6", 5, 0, { kind: "bridge", stable: false, supported: false }),
    quietEntity("02-v2-6-exit", "출구", "02-v2-6", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (manipulates(current, "02-v2-6-box") && aimedAt(current, "02-v2-6-bridge")) {
      const next = clone(state);
      next.entities["02-v2-6-box"].location.x = 5;
      next.entities["02-v2-6-box"].properties.position = "under-bridge";
      next.entities["02-v2-6-box"].properties.supported = true;
      next.entities["02-v2-6-bridge"].properties.supported = true;
      next.entities["02-v2-6-bridge"].properties.stable = true;
      moveHero(next, { region: next.segmentId, x: 3.5, y: 0 });
      return outcome(next, "done", "상자가 다리 가운데를 받쳤어요.");
    }
    if (isTravel(current, "02-v2-6-exit")) {
      if (state.entities["02-v2-6-bridge"].properties.stable !== true) return failure(state, "처진 다리가 발밑에서 더 기울었어요.");
      return moveToGoal(state, "02-v2-6-exit", "받쳐 둔 다리를 건넜어요.");
    }
    if (isTravel(current, "02-v2-6-bridge")) {
      if (state.entities["02-v2-6-bridge"].properties.stable !== true) return failure(state, "처진 다리가 발밑에서 더 기울었어요.");
      return moveToGoal(state, "02-v2-6-exit", "다리 위를 지나 맞은편 출구에 닿았어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 9,
};

const kitchen1: SegmentDefinition = {
  id: "03-v2-1",
  title: "숨 쉬는 배출구",
  goal: "편지와 함께 부엌 안으로 가야 해요.",
  description: "김 분출구 · 출구",
  hints: KITCHEN_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(3, "03-v2-1", [
    quietEntity("03-v2-1-steam", "김 분출구", "03-v2-1", 5, 0, { kind: "vent", active: true, cycling: true }),
    quietEntity("03-v2-1-exit", "출구", "03-v2-1", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (isTravel(current, "03-v2-1-exit")) {
      if (state.entities["03-v2-1-steam"].properties.active === true) return failure(state, "뿜어 나온 김에 밀려났어요.");
      return moveToGoal(state, "03-v2-1-exit", "김이 멎은 통로를 지났어요.");
    }
    return null;
  }),
  advance: (state) => {
    const next = tick(state);
    next.entities["03-v2-1-steam"].properties.active = elapsedTicks(next) % 2 === 0;
    return { world: next, events: [], canChange: true };
  },
  complete: (state) => state.actors.hero.location.x === 9,
};

const kitchen2: SegmentDefinition = {
  id: "03-v2-2",
  title: "오븐의 박자",
  goal: "오븐 안의 빵을 꺼내야 해요.",
  description: "오븐 · 빵",
  hints: KITCHEN_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(3, "03-v2-2", [
    quietEntity("03-v2-2-oven", "오븐", "03-v2-2", 5, 0, { kind: "furnace", open: false, cycling: true }),
    quietEntity("03-v2-2-bread", "빵", "03-v2-2", 5, 0, { kind: "object", safe: false, position: "oven", slot: "small" }, { material: "wood", movable: true, parent: "03-v2-2-oven" }),
  ]),
  execute: executor((state, current) => {
    if (current.verb === "take" && current.target === "03-v2-2-bread") {
      if (state.entities["03-v2-2-oven"].properties.open !== true) return failure(state, "닫히는 오븐 문에 손이 막혔어요.");
      const next = clone(state);
      const bread = next.entities["03-v2-2-bread"];
      bread.parent = "hero";
      bread.properties.safe = true;
      bread.properties.position = "carried";
      if (!next.actors.hero.carrying.includes(bread.id)) next.actors.hero.carrying.push(bread.id);
      moveHero(next, next.entities["03-v2-2-oven"].location);
      return outcome(next, "done", "열린 오븐에서 빵을 꺼냈어요.");
    }
    return null;
  }),
  advance: (state) => {
    const next = tick(state);
    next.entities["03-v2-2-oven"].properties.open = elapsedTicks(next) % 2 === 1;
    return { world: next, events: [], canChange: true };
  },
  complete: (state) => state.entities["03-v2-2-bread"]?.parent === "hero",
};

const kitchen3: SegmentDefinition = {
  id: "03-v2-3",
  title: "오르내리는 집게",
  goal: "집게 너머로 가야 해요.",
  description: "집게 · 출구",
  hints: KITCHEN_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(3, "03-v2-3", [
    quietEntity("03-v2-3-claw", "집게", "03-v2-3", 5, 2, { kind: "claw", raised: false, cycling: true }),
    quietEntity("03-v2-3-exit", "출구", "03-v2-3", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (isTravel(current, "03-v2-3-exit")) {
      if (state.entities["03-v2-3-claw"].properties.raised !== true) return failure(state, "내려온 집게가 통로를 휩쓸었어요.");
      return moveToGoal(state, "03-v2-3-exit", "집게가 올라간 사이를 지났어요.");
    }
    return null;
  }),
  advance: (state) => {
    const next = tick(state);
    next.entities["03-v2-3-claw"].properties.raised = elapsedTicks(next) % 2 === 1;
    return { world: next, events: [], canChange: true };
  },
  complete: (state) => state.actors.hero.location.x === 9,
};

const kitchen4: SegmentDefinition = {
  id: "03-v2-4",
  title: "부푸는 디딤돌",
  goal: "위 선반에 올라가야 해요.",
  description: "반죽 · 선반",
  hints: KITCHEN_HINTS,
  scene: HIGH_EXIT,
  enter: () => quietWorld(3, "03-v2-4", [
    quietEntity("03-v2-4-dough", "반죽", "03-v2-4", 5, 0, { kind: "platform", raised: false, climbable: false, stable: true }, { capacity: 3 }),
    quietEntity("03-v2-4-shelf", "선반", "03-v2-4", 8, 3, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    const climbs = (current.verb === "climb" && current.target === "03-v2-4-dough") || isTravel(current, "03-v2-4-shelf");
    if (climbs) {
      if (state.entities["03-v2-4-dough"].properties.raised !== true) return failure(state, "낮고 말랑한 반죽이 발밑에서 꺼졌어요.");
      return moveToGoal(state, "03-v2-4-shelf", "부푼 반죽을 딛고 선반에 올랐어요.");
    }
    return null;
  }),
  advance: (state) => {
    const next = tick(state);
    const dough = next.entities["03-v2-4-dough"];
    dough.properties.raised = true;
    dough.properties.climbable = true;
    dough.location.y = 2;
    return { world: next, events: [], canChange: false };
  },
  complete: (state) => state.actors.hero.location.x === 8 && state.actors.hero.location.y === 3,
};

const kitchen5: SegmentDefinition = {
  id: "03-v2-5",
  title: "다가오는 쟁반",
  goal: "건너편 식탁으로 가야 해요.",
  description: "이동 쟁반 · 틈 · 출구",
  hints: KITCHEN_HINTS,
  scene: WIDE_WATER_GAP,
  enter: () => quietWorld(3, "03-v2-5", [
    quietEntity("03-v2-5-tray", "이동 쟁반", "03-v2-5", 7, 0, { kind: "platform", boardable: true, position: "far", safeToCross: false, cycling: true }, { capacity: 3 }),
    quietEntity("03-v2-5-gap", "틈", "03-v2-5", 5, 0, { kind: "water", safe: false }, { material: "water" }),
    quietEntity("03-v2-5-exit", "출구", "03-v2-5", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if ((current.verb === "board" || current.verb === "climb") && current.target === "03-v2-5-tray") {
      if (state.entities["03-v2-5-tray"].properties.position !== "near") return blocked(state, "쟁반이 아직 이쪽 바닥에 닿지 않았어요.");
      const next = clone(state);
      next.actors.hero.riding = "03-v2-5-tray";
      moveHero(next, next.entities["03-v2-5-tray"].location);
      return outcome(next, "done", "가까이 온 쟁반에 올라탔어요.");
    }
    const exits = isTravel(current, "03-v2-5-exit")
      || (current.verb === "dismount" && current.target === "03-v2-5-tray" && current.destination === "03-v2-5-exit");
    if (exits) {
      const tray = state.entities["03-v2-5-tray"];
      if (state.actors.hero.riding !== tray.id || tray.properties.position !== "far") return failure(state, "움직이는 쟁반 없이 바닥 틈을 건널 수 없어요.");
      const next = clone(state);
      next.actors.hero.riding = null;
      moveHero(next, next.entities["03-v2-5-exit"].location);
      return outcome(next, "done", "쟁반에서 맞은편 출구로 내렸어요.");
    }
    return null;
  }),
  advance: (state) => {
    const next = tick(state);
    const tray = next.entities["03-v2-5-tray"];
    const far = state.actors.hero.riding === tray.id || tray.properties.position === "near";
    const location = { region: next.segmentId, x: far ? 7 : 2.5, y: 0 };
    moveEntityAndRider(next, tray.id, location);
    tray.properties.position = far ? "far" : "near";
    tray.properties.safeToCross = far;
    return { world: next, events: [], canChange: true };
  },
  complete: (state) => state.actors.hero.location.x === 9,
};

const kitchen6: SegmentDefinition = {
  id: "03-v2-6",
  title: "김 사이의 배달",
  goal: "편지와 함께 부엌을 나가야 해요.",
  description: "김 분출구 · 이동 쟁반 · 출구",
  hints: KITCHEN_HINTS,
  scene: WIDE_WATER_GAP,
  enter: () => quietWorld(3, "03-v2-6", [
    quietEntity("03-v2-6-steam", "김 분출구", "03-v2-6", 3, 0, { kind: "vent", active: true, cycling: true }),
    quietEntity("03-v2-6-tray", "이동 쟁반", "03-v2-6", 2.5, 0, { kind: "platform", boardable: true, position: "near", safeToCross: false }, { capacity: 3 }),
    quietEntity("03-v2-6-exit", "출구", "03-v2-6", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if ((current.verb === "board" || current.verb === "climb") && current.target === "03-v2-6-tray") {
      if (state.entities["03-v2-6-steam"].properties.active === true) return failure(state, "분출 중인 김이 쟁반 앞을 막았어요.");
      const next = clone(state);
      next.actors.hero.riding = "03-v2-6-tray";
      moveHero(next, next.entities["03-v2-6-tray"].location);
      return outcome(next, "done", "김이 멎은 사이 쟁반에 올랐어요.");
    }
    const exits = isTravel(current, "03-v2-6-exit")
      || (current.verb === "dismount" && current.target === "03-v2-6-tray" && current.destination === "03-v2-6-exit");
    if (exits) {
      if (state.actors.hero.riding !== "03-v2-6-tray" || state.entities["03-v2-6-tray"].properties.position !== "far") return failure(state, "쟁반이 출구 쪽에 닿기 전에 내릴 수 없어요.");
      const next = clone(state);
      next.actors.hero.riding = null;
      moveHero(next, next.entities["03-v2-6-exit"].location);
      return outcome(next, "done", "쟁반에서 주방 출구로 내렸어요.");
    }
    return null;
  }),
  advance: (state) => {
    const next = tick(state);
    next.entities["03-v2-6-steam"].properties.active = elapsedTicks(next) % 2 === 0;
    if (state.actors.hero.riding === "03-v2-6-tray") {
      moveEntityAndRider(next, "03-v2-6-tray", { region: next.segmentId, x: 7, y: 0 });
      next.entities["03-v2-6-tray"].properties.position = "far";
      next.entities["03-v2-6-tray"].properties.safeToCross = true;
    }
    return { world: next, events: [], canChange: true };
  },
  complete: (state) => state.actors.hero.location.x === 9,
};

const forge1: SegmentDefinition = {
  id: "04-v2-1",
  title: "잠든 풍차",
  goal: "잠든 풍차를 깨워야 해요.",
  description: "바람판 · 풍차",
  hints: FORGE_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(4, "04-v2-1", [
    quietEntity("04-v2-1-vane", "바람판", "04-v2-1", 2, 0, { kind: "handle", orientation: 0, route: "wall", controls: "04-v2-1-windmill" }),
    quietEntity("04-v2-1-windmill", "풍차", "04-v2-1", 8, 1, { kind: "turbine", active: false, spinning: false, powered: false }),
  ]),
  execute: executor((state, current) => {
    if (current.verb === "turn" && current.target === "04-v2-1-vane" && aimedAt(current, "04-v2-1-windmill")) {
      const next = clone(state);
      next.entities["04-v2-1-vane"].properties.orientation = 1;
      next.entities["04-v2-1-vane"].properties.route = "windmill";
      Object.assign(next.entities["04-v2-1-windmill"].properties, { active: true, spinning: true, powered: true });
      moveHero(next, next.entities["04-v2-1-vane"].location);
      return outcome(next, "done", "바람이 풍차로 이어졌어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.entities["04-v2-1-windmill"]?.properties.spinning === true,
};

function liftExecutor(prefix: "04-v2-2" | "04-v2-6", vaneId?: string): ActionExecutor {
  const liftId = `${prefix}-lift`;
  const exitId = `${prefix}-exit`;
  return executor((state, current) => {
    if (vaneId && current.verb === "turn" && current.target === vaneId && aimedAt(current, liftId)) {
      const next = clone(state);
      next.entities[vaneId].properties.orientation = 1;
      next.entities[vaneId].properties.route = "lift";
      next.entities[liftId].properties.powered = true;
      moveHero(next, next.entities[vaneId].location);
      return outcome(next, "done", "바람이 승강판으로 이어졌어요.");
    }
    if ((current.verb === "board" || current.verb === "climb") && current.target === liftId) {
      if (state.entities[liftId].properties.powered !== true) return blocked(state, "승강판에 아직 바람이 들어오지 않아요.");
      const next = clone(state);
      next.actors.hero.riding = liftId;
      moveHero(next, next.entities[liftId].location);
      return outcome(next, "done", "승강판에 올라탔어요.");
    }
    const exits = isTravel(current, exitId) || (current.verb === "dismount" && current.target === liftId && current.destination === exitId);
    if (exits) {
      if (state.actors.hero.riding !== liftId || state.entities[liftId].properties.raised !== true) return failure(state, "올라오지 않은 승강판에서는 위층에 닿을 수 없어요.");
      const next = clone(state);
      next.actors.hero.riding = null;
      moveHero(next, next.entities[exitId].location);
      return outcome(next, "done", "올라온 승강판에서 위층으로 내렸어요.");
    }
    return null;
  });
}

function liftAdvance(prefix: "04-v2-2" | "04-v2-6", state: WorldState) {
  const next = tick(state);
  const liftId = `${prefix}-lift`;
  const lift = next.entities[liftId];
  if (state.actors.hero.riding === liftId && lift.properties.powered === true) {
    lift.properties.raised = true;
    moveEntityAndRider(next, liftId, { region: next.segmentId, x: 6, y: 3 });
  }
  return { world: next, events: [], canChange: state.actors.hero.riding === liftId && lift.properties.raised !== true };
}

const forge2: SegmentDefinition = {
  id: "04-v2-2",
  title: "바람 승강판",
  goal: "위층에 올라가야 해요.",
  description: "바람판 · 승강대 · 위층",
  hints: FORGE_HINTS,
  scene: HIGH_EXIT,
  enter: () => quietWorld(4, "04-v2-2", [
    quietEntity("04-v2-2-vane", "바람판", "04-v2-2", 2, 0, { kind: "handle", orientation: 0, route: "wall", controls: "04-v2-2-lift" }),
    quietEntity("04-v2-2-lift", "승강대", "04-v2-2", 6, 0, { kind: "elevator", boardable: true, powered: false, raised: false, stable: true }, { capacity: 3 }),
    quietEntity("04-v2-2-exit", "위층", "04-v2-2", 9, 3, { kind: "exit", safe: true }),
  ]),
  execute: liftExecutor("04-v2-2", "04-v2-2-vane"),
  advance: (state) => liftAdvance("04-v2-2", state),
  complete: (state) => state.actors.hero.location.x === 9 && state.actors.hero.location.y === 3,
};

const forge3: SegmentDefinition = {
  id: "04-v2-3",
  title: "뜨거운 길",
  goal: "철판 너머로 가야 해요.",
  description: "송풍기 · 뜨거운 철판 · 출구",
  hints: FORGE_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(4, "04-v2-3", [
    quietEntity("04-v2-3-fan", "찬바람 송풍기", "04-v2-3", 2, 0, { kind: "turbine", active: false, on: false, controls: "04-v2-3-hotplate" }),
    quietEntity("04-v2-3-hotplate", "뜨거운 철판", "04-v2-3", 5, 0, { kind: "pressure", heated: true, safe: false, heatState: "hot" }),
    quietEntity("04-v2-3-exit", "출구", "04-v2-3", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (current.verb === "turn" && current.target === "04-v2-3-fan") {
      const next = clone(state);
      Object.assign(next.entities["04-v2-3-fan"].properties, { active: true, on: true });
      Object.assign(next.entities["04-v2-3-hotplate"].properties, { heated: false, safe: true, heatState: "cold", cooled: true });
      moveHero(next, next.entities["04-v2-3-fan"].location);
      return outcome(next, "done", "찬바람이 달군 판을 식혔어요.");
    }
    if (isTravel(current, "04-v2-3-exit")) {
      if (state.entities["04-v2-3-hotplate"].properties.safe !== true) return failure(state, "달군 판을 밟아 편지 주머니까지 열기가 번졌어요.");
      return moveToGoal(state, "04-v2-3-exit", "식은 판을 지나 출구에 닿았어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 9,
};

const forge4: SegmentDefinition = {
  id: "04-v2-4",
  title: "회전날개 통로",
  goal: "날개 너머로 가야 해요.",
  description: "바람판 · 회전날개 · 출구",
  hints: FORGE_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(4, "04-v2-4", [
    quietEntity("04-v2-4-vane", "바람판", "04-v2-4", 2, 0, { kind: "handle", orientation: 0, route: "blades", controls: "04-v2-4-blades" }),
    quietEntity("04-v2-4-blades", "회전날개", "04-v2-4", 5, 1, { kind: "turbine", active: true, spinning: true, safe: false }),
    quietEntity("04-v2-4-exit", "출구", "04-v2-4", 9, 0, { kind: "exit", safe: true }),
  ]),
  execute: executor((state, current) => {
    if (current.verb === "turn" && current.target === "04-v2-4-vane") {
      const next = clone(state);
      next.entities["04-v2-4-vane"].properties.orientation = 1;
      next.entities["04-v2-4-vane"].properties.route = "bypass";
      Object.assign(next.entities["04-v2-4-blades"].properties, { active: false, spinning: false, safe: true });
      moveHero(next, next.entities["04-v2-4-vane"].location);
      return outcome(next, "done", "바람이 옆 관으로 빠져 회전날개가 멎었어요.");
    }
    if (isTravel(current, "04-v2-4-exit")) {
      if (state.entities["04-v2-4-blades"].properties.spinning === true) return failure(state, "도는 날개가 통로를 막았어요.");
      return moveToGoal(state, "04-v2-4-exit", "멈춘 날개 사이를 지났어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.actors.hero.location.x === 9,
};

const forge5: SegmentDefinition = {
  id: "04-v2-5",
  title: "붙잡아 둔 바람",
  goal: "다음 방으로 바람이 흐르게 해야 해요.",
  description: "풍로문 · 걸쇠",
  hints: FORGE_HINTS,
  scene: FULL_FLOOR,
  enter: () => quietWorld(4, "04-v2-5", [
    quietEntity("04-v2-5-door", "풍로문", "04-v2-5", 4, 0, { kind: "handle", open: false, latched: false, suppliesWind: false }),
    quietEntity("04-v2-5-latch", "걸쇠", "04-v2-5", 5, 0, { kind: "latch", on: false, latched: false, controls: "04-v2-5-door" }),
  ]),
  execute: executor((state, current) => {
    if (current.verb === "open" && current.target === "04-v2-5-door") {
      const next = clone(state);
      next.entities["04-v2-5-door"].properties.open = true;
      moveHero(next, next.entities["04-v2-5-door"].location);
      return outcome(next, "done", "바람 덕트 문을 열었어요.");
    }
    if ((current.verb === "turn" || current.verb === "push" || current.verb === "pull" || current.verb === "close") && current.target === "04-v2-5-latch") {
      if (state.entities["04-v2-5-door"].properties.open !== true) return blocked(state, "닫힌 문에는 걸쇠가 맞물리지 않아요.");
      const next = clone(state);
      Object.assign(next.entities["04-v2-5-latch"].properties, { on: true, latched: true });
      Object.assign(next.entities["04-v2-5-door"].properties, { latched: true, suppliesWind: true });
      moveHero(next, next.entities["04-v2-5-latch"].location);
      return outcome(next, "done", "걸쇠가 열린 문을 단단히 고정했어요.");
    }
    return null;
  }),
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.entities["04-v2-5-door"]?.properties.open === true
    && state.entities["04-v2-5-door"]?.properties.latched === true
    && state.entities["04-v2-5-door"]?.properties.suppliesWind === true,
};

const forge6: SegmentDefinition = {
  id: "04-v2-6",
  title: "이어진 바람",
  goal: "편지와 함께 대장간을 나가야 해요.",
  description: "고정 바람관 · 승강대 · 출구",
  hints: FORGE_HINTS,
  scene: HIGH_EXIT,
  enter: () => quietWorld(4, "04-v2-6", [
    quietEntity("04-v2-6-duct", "고정 바람관", "04-v2-6", 2, 1, { kind: "vent", flowing: true, active: true, suppliesWind: true }),
    quietEntity("04-v2-6-lift", "승강대", "04-v2-6", 6, 0, { kind: "elevator", boardable: true, powered: true, raised: false, stable: true }, { capacity: 3 }),
    quietEntity("04-v2-6-exit", "출구", "04-v2-6", 9, 3, { kind: "exit", safe: true }),
  ]),
  execute: liftExecutor("04-v2-6"),
  advance: (state) => liftAdvance("04-v2-6", state),
  complete: (state) => state.actors.hero.location.x === 9 && state.actors.hero.location.y === 3,
};

export const QUIET_RAIN_STAGE: CampaignStageDefinition = {
  id: 2,
  title: "비에 잠긴 회랑",
  contentRevision: "shared-v1",
  segments: [rain1, rain2, rain3, rain4, rain5, rain6].map(withSharedDefaults),
  practice: practiceFrom(withSharedDefaults(rain1), "02-v2-practice"),
  story: { afterSegment: "02-v2-6", object: "02-v2-6-exit", text: "빗소리가 등 뒤로 멀어진다." },
};

export const QUIET_KITCHEN_STAGE: CampaignStageDefinition = {
  id: 3,
  title: "태엽 부엌",
  contentRevision: "shared-v1",
  segments: [kitchen1, kitchen2, kitchen3, kitchen4, kitchen5, kitchen6].map(withSharedDefaults),
  practice: practiceFrom(withSharedDefaults(kitchen1), "03-v2-practice"),
  story: { afterSegment: "03-v2-6", object: "03-v2-6-exit", text: "주방의 박자가 문 너머로 잦아든다." },
};

export const QUIET_FORGE_STAGE: CampaignStageDefinition = {
  id: 4,
  title: "바람 대장간",
  contentRevision: "shared-v1",
  segments: [forge1, forge2, forge3, forge4, forge5, forge6].map(withSharedDefaults),
  practice: practiceFrom(withSharedDefaults(forge1), "04-v2-practice"),
  story: { afterSegment: "04-v2-6", object: "04-v2-6-exit", text: "이어진 바람이 위층까지 따라온다." },
};

export const QUIET_EARLY_INTENT_CASES: readonly QuietEarlyIntentCase[] = [
  { stageId: 2, segmentId: "02-v2-1", text: "상자를 옆으로 밀고 나가", body: sequence(action("push", "02-v2-1-box"), action("move", "02-v2-1-exit")) },
  { stageId: 2, segmentId: "02-v2-2", text: "상자를 창 아래 두고 올라가", body: sequence(action("place", "02-v2-2-box", "02-v2-2-window"), action("climb", "02-v2-2-box")) },
  { stageId: 2, segmentId: "02-v2-3", text: "널빤지로 틈을 잇고 건너", body: sequence(action("place", "02-v2-3-plank", "02-v2-3-gap"), action("move", "02-v2-3-bank")) },
  { stageId: 2, segmentId: "02-v2-4", text: "코르크 발판을 타고 건너", body: sequence(action("board", "02-v2-4-cork"), action("move", "02-v2-4-bank")) },
  { stageId: 2, segmentId: "02-v2-5", text: "배수구를 열고 아래 계단으로 내려가", body: sequence(action("open", "02-v2-5-drain"), action("move", "02-v2-5-stairs")) },
  { stageId: 2, segmentId: "02-v2-6", text: "상자로 다리를 받치고 건너", body: sequence(action("place", "02-v2-6-box", "02-v2-6-bridge"), action("move", "02-v2-6-exit")) },
  { stageId: 3, segmentId: "03-v2-1", text: "김이 멎으면 지나가", body: sequence(waitFor("03-v2-1-steam", "active", false), action("move", "03-v2-1-exit")) },
  { stageId: 3, segmentId: "03-v2-2", text: "오븐이 열리면 빵을 꺼내", body: sequence(waitFor("03-v2-2-oven", "open", true), action("take", "03-v2-2-bread")) },
  { stageId: 3, segmentId: "03-v2-3", text: "집게가 올라가면 지나가", body: sequence(waitFor("03-v2-3-claw", "raised", true), action("move", "03-v2-3-exit")) },
  { stageId: 3, segmentId: "03-v2-4", text: "반죽이 부풀면 딛고 올라가", body: sequence(waitFor("03-v2-4-dough", "raised", true), action("climb", "03-v2-4-dough")) },
  { stageId: 3, segmentId: "03-v2-5", text: "쟁반이 가까이 오면 타고 건너", body: sequence(waitFor("03-v2-5-tray", "position", "near"), action("board", "03-v2-5-tray"), waitFor("03-v2-5-tray", "position", "far"), action("move", "03-v2-5-exit")) },
  { stageId: 3, segmentId: "03-v2-6", text: "김이 멎으면 쟁반을 타고 건너", body: sequence(waitFor("03-v2-6-steam", "active", false), action("board", "03-v2-6-tray"), waitFor("03-v2-6-tray", "position", "far"), action("move", "03-v2-6-exit")) },
  { stageId: 4, segmentId: "04-v2-1", text: "바람판을 풍차 쪽으로 돌려", body: action("turn", "04-v2-1-vane", "04-v2-1-windmill") },
  { stageId: 4, segmentId: "04-v2-2", text: "바람을 승강판에 보내고 타서 올라가", body: sequence(action("turn", "04-v2-2-vane", "04-v2-2-lift"), action("board", "04-v2-2-lift"), waitFor("04-v2-2-lift", "raised", true), action("move", "04-v2-2-exit")) },
  { stageId: 4, segmentId: "04-v2-3", text: "송풍기로 판을 식히고 지나가", body: sequence(action("turn", "04-v2-3-fan"), action("move", "04-v2-3-exit")) },
  { stageId: 4, segmentId: "04-v2-4", text: "바람판을 돌려 날개를 멈추고 나가", body: sequence(action("turn", "04-v2-4-vane"), action("move", "04-v2-4-exit")) },
  { stageId: 4, segmentId: "04-v2-5", text: "바람문을 열고 걸쇠를 걸어", body: sequence(action("open", "04-v2-5-door"), action("turn", "04-v2-5-latch")) },
  { stageId: 4, segmentId: "04-v2-6", text: "승강판을 타고 위층으로 올라가", body: sequence(action("board", "04-v2-6-lift"), waitFor("04-v2-6-lift", "raised", true), action("move", "04-v2-6-exit")) },
] as const;

export function quietEarlyProgram(intent: QuietEarlyIntentCase): InstructionProgram {
  return {
    version: 2,
    id: `quiet-fixture-${intent.segmentId}`,
    text: intent.text,
    model: "quiet-fixture",
    scope: { stageId: intent.stageId, region: intent.segmentId },
    guard: false,
    body: intent.body,
  };
}
