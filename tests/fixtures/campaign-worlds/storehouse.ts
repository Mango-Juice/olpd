import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../../../src/campaign/level";
import { currentLoad, entityMass, executePhysicalAction } from "../../../src/campaign/physics";
import type { ActionResult } from "../../../src/campaign/program";
import type { Entity, PhysicalAction, Scalar, WorldState } from "../../../src/campaign/types";

const STAGE_ID = 6 as const;

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
    reach: 1,
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

function blocked(state: WorldState, reason: string): ActionResult {
  return result(state, "blocked", reason);
}

function clarification(state: WorldState, reason: string): ActionResult {
  return result(state, "clarification", reason);
}

function failure(state: WorldState, reason: string): ActionResult {
  return result(clone(state), "failure", reason);
}

function moveTree(state: WorldState, id: string, location: Entity["location"], seen = new Set<string>()): void {
  if (seen.has(id)) return;
  seen.add(id);
  const target = state.entities[id];
  if (target) target.location = { ...location };
  for (const child of Object.values(state.entities)) {
    if (child.parent === id) moveTree(state, child.id, location, seen);
  }
  for (const actor of Object.values(state.actors)) {
    if (actor.riding !== id) continue;
    actor.location = { ...location };
    for (const carried of actor.carrying) moveTree(state, carried, location, seen);
  }
}

function enterWorld(segmentId: string, current: Entity[], previous: WorldState | null, heroX = 0): WorldState {
  const retained = previous ? Object.values(previous.entities).map((item) => structuredClone(item)) : [];
  const byId = new Map(retained.map((item) => [item.id, item]));
  for (const item of current) byId.set(item.id, item);
  const hero = makeHero(segmentId, heroX);
  hero.carrying = previous?.actors.hero?.carrying.filter((id) => byId.has(id)) ?? [];
  const state = makeWorld(STAGE_ID, segmentId, [...byId.values()], hero);
  for (const id of state.actors.hero.carrying) {
    const carried = state.entities[id];
    if (!carried) continue;
    carried.parent = "hero";
    moveTree(state, id, state.actors.hero.location);
  }
  state.visible = [...new Set([...current.map((item) => item.id), ...state.actors.hero.carrying])];
  refreshInventory(state);
  return state;
}

function tick(state: WorldState): WorldState {
  const next = clone(state);
  next.tick += 1;
  return next;
}

function moved(action: PhysicalAction): boolean {
  return action.verb === "move" || action.verb === "jump" || action.verb === "duck";
}

function crosses(state: WorldState, action: PhysicalAction, x: number): boolean {
  if (!moved(action)) return false;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return false;
  return (actor.location.x < x && target.location.x > x) || (actor.location.x > x && target.location.x < x);
}

function refreshInventory(state: WorldState): void {
  const hero = state.actors.hero;
  const carried = hero.carrying.flatMap((id) => state.entities[id]?.properties.equipment !== true ? [state.entities[id]] : []);
  const large = carried.filter((item) => item.properties.slot === "large");
  const small = carried.filter((item) => item.properties.slot === "small");
  for (const item of Object.values(state.entities)) {
    if (item.properties.slot !== "small" && item.properties.slot !== "large") continue;
    if (item.parent !== "hero") item.properties.carriedAt = "none";
  }
  for (const [index, item] of small.entries()) item.properties.carriedAt = index < 2 ? `hook-${index + 1}` : "hand";
  for (const item of large) item.properties.carriedAt = "hand";
  const board = state.entities[`${state.segmentId}-inventory`];
  if (board) {
    board.properties.hand = large[0]?.id ?? small[2]?.id ?? "empty";
    board.properties.hooks = small.slice(0, 2).map((item) => item.id).join("|") || "empty";
    board.properties.handUsed = large.length > 0 || small.length > 2;
    board.properties.hooksUsed = Math.min(2, small.length);
  }
}

function executeAndRefresh(state: WorldState, action: PhysicalAction): ActionResult {
  const physical = executePhysicalAction(state, action);
  if (physical.outcome === "done") refreshInventory(physical.world);
  return physical;
}

function inventoryDisplay(region: string): Entity {
  return entity(`${region}-inventory`, "손·고리 소지판", region, 0, {
    kind: "inventory-display", handCapacity: 1, hookCapacity: 2,
    hand: "empty", hooks: "empty", handUsed: false, hooksUsed: 0,
  }, { material: "cloth", reach: 20 });
}

function small(id: string, name: string, region: string, x: number, properties: Record<string, Scalar> = {}): Entity {
  return entity(id, name, region, x, {
    kind: "portable-small", slot: "small", recoverable: true, carriedAt: "none", ...properties,
  }, { movable: true, weight: 0.2 });
}

function large(id: string, name: string, region: string, x: number, properties: Record<string, Scalar> = {}): Entity {
  return entity(id, name, region, x, {
    kind: "portable-large", slot: "large", recoverable: true, carriedAt: "none", ...properties,
  }, { movable: true, weight: 1 });
}

function turnInsertedKey(state: WorldState, action: PhysicalAction): ActionResult | null {
  if (action.verb !== "turn") return null;
  const key = state.entities[action.target];
  if (!key || key.properties.tool !== "brass-key") return null;
  const lock = key.parent ? state.entities[key.parent] : undefined;
  if (!lock || lock.properties.acceptsKey !== true) return clarification(state, "놋쇠 열쇠를 공개된 열쇠구멍에 꽂은 뒤 돌려 주세요.");
  const physical = executePhysicalAction(state, action);
  if (physical.outcome !== "done") return physical;
  const next = physical.world;
  next.entities[lock.id].properties.unlocked = true;
  next.entities[lock.id].properties.handleMark = "horizontal";
  const opens = String(lock.properties.opens);
  if (next.entities[opens]) next.entities[opens].properties.open = true;
  refreshInventory(next);
  return result(next, "done", `${lock.name}에서 열쇠를 돌려 연결된 문을 열었어요. 열쇠는 꽂힌 채 남아 회수할 수 있어요.`);
}

function keyedExecute(state: WorldState, action: PhysicalAction): ActionResult {
  return turnInsertedKey(state, action) ?? executeAndRefresh(state, action);
}

const practice: SegmentDefinition = {
  id: "06-practice",
  title: "열쇠와 반환 받침",
  goal: "열쇠로 모형 문을 열고 다시 회수해 반환 받침에 놓기",
  description: "놋쇠 열쇠 하나, 열린 상태가 남는 모형 문, 반환 받침만 있는 본편과 분리된 무료 모형입니다.",
  hints: [
    "열쇠의 현재 위치와 손·고리 소지판을 보세요.",
    "열쇠는 사용해도 사라지지 않고 열쇠구멍에 남아요.",
    "열쇠를 꽂아 돌린 뒤 다시 챙겨 반환 받침에 놓으세요.",
  ],
  enter: () => enterWorld("06-practice", [
    inventoryDisplay("06-practice"),
    entity("06-practice-start", "모형 관찰점", "06-practice", 0, { kind: "platform", safe: true }),
    small("06-practice-key", "연습 놋쇠 열쇠", "06-practice", 0, { tool: "brass-key", orientation: 0, floorNumber: 1 }),
    entity("06-practice-lock", "모형 열쇠구멍", "06-practice", 1, { kind: "lock", acceptsKey: true, opens: "06-practice-gate", unlocked: false, handleMark: "vertical" }),
    entity("06-practice-gate", "모형 격자문", "06-practice", 1, { kind: "gate", open: false, persistentOpen: true }),
    entity("06-practice-return", "반환 받침", "06-practice", 2, { kind: "shelf", capacity: 1, accepts: "brass-key" }),
  ], null),
  execute: (state, action) => {
    if (crosses(state, action, 1) && state.entities["06-practice-gate"].properties.open !== true) {
      return blocked(state, "모형 격자문의 가로 손잡이 표식이 아직 닫힘을 가리켜요.");
    }
    return keyedExecute(state, action);
  },
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  complete: (state) => state.entities["06-practice-key"].parent === "06-practice-return"
    && state.entities["06-practice-gate"].properties.open === true,
};

const brassKey: SegmentDefinition = {
  id: "06-1",
  title: "하나뿐인 놋쇠 열쇠",
  goal: "열쇠 하나로 두 격자문을 차례로 열고 출구에 도달하기",
  description: "열쇠 수량 1, 두 열쇠구멍, 열린 문의 가로 손잡이, 네 칸 간격 반환 받침이 처음부터 보입니다.",
  hints: [
    "첫 문을 연 뒤 열쇠가 어디에 남았는지 보세요.",
    "열린 문의 상태는 남지만 열쇠는 열쇠구멍에서 회수할 수 있어요.",
    "첫 문에 꽂은 열쇠를 다시 챙겨 두 번째 문에 사용하세요.",
  ],
  enter: (previous) => enterWorld("06-1", [
    inventoryDisplay("06-1"),
    entity("06-1-start", "안전 관찰 책갈피", "06-1", 0, { kind: "platform", safe: true }),
    entity("06-1-stock", "열쇠 수량표", "06-1", 0, { kind: "inventory-board", brassKeys: 1 }),
    small("06-1-key", "놋쇠 열쇠 1번", "06-1", 0, { tool: "brass-key", orientation: 0, floorNumber: 1 }),
    entity("06-1-lock-a", "첫째 세로선 열쇠구멍", "06-1", 1, { kind: "lock", acceptsKey: true, opens: "06-1-gate-a", unlocked: false, handleMark: "vertical" }),
    entity("06-1-gate-a", "첫째 격자문", "06-1", 1, { kind: "gate", open: false, persistentOpen: true }),
    entity("06-1-return", "중앙 반환 받침", "06-1", 5, { kind: "shelf", capacity: 1, distanceMarks: 4 }),
    entity("06-1-lock-b", "둘째 세로선 열쇠구멍", "06-1", 9, { kind: "lock", acceptsKey: true, opens: "06-1-gate-b", unlocked: false, handleMark: "vertical" }),
    entity("06-1-gate-b", "둘째 격자문", "06-1", 9, { kind: "gate", open: false, persistentOpen: true }),
    entity("06-1-exit", "두 문 너머 출구", "06-1", 10, { kind: "platform", safe: true }),
  ], previous),
  execute: (state, action) => {
    if (crosses(state, action, 1) && state.entities["06-1-gate-a"].properties.open !== true) {
      return blocked(state, "첫째 격자문이 닫혀 있어요. 열쇠구멍과 현재 열쇠 위치를 함께 확인해 주세요.");
    }
    if (crosses(state, action, 9) && state.entities["06-1-gate-b"].properties.open !== true) {
      const key = state.entities["06-1-key"];
      return blocked(state, `둘째 격자문이 닫혀 있어요. 하나뿐인 열쇠는 지금 ${key.parent ?? key.location.x}에 있어 회수할 수 있어요.`);
    }
    return keyedExecute(state, action);
  },
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  idleAction: (state) => state.entities["06-1-gate-a"].properties.open === true
    && state.entities["06-1-gate-b"].properties.open === true
    && !at(state, "hero", "06-1-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "06-1-exit" }
    : null,
  complete: (state) => at(state, "hero", "06-1-exit")
    && state.entities["06-1-gate-a"].properties.open === true
    && state.entities["06-1-gate-b"].properties.open === true,
};

function toolAt(state: WorldState, parent: string, tool: string): Entity | undefined {
  return Object.values(state.entities).find((item) => item.parent === parent && item.properties.tool === tool);
}

function refreshLightCorridor(state: WorldState, advanceClosing: boolean): void {
  const lights = Object.values(state.entities).filter((item) => item.location.region === state.segmentId
    && item.properties.tool === "lantern" && item.properties.lit === true);
  for (const suffix of ["a", "b", "c"] as const) {
    const sensor = state.entities[`06-2-sensor-${suffix}`];
    const gate = state.entities[`06-2-gate-${suffix}`];
    const illuminated = lights.some((light) => Math.abs(light.location.x - sensor.location.x) <= Number(sensor.properties.radius));
    const before = Number(gate.properties.darkTicks);
    const darkTicks = illuminated ? 0 : advanceClosing ? before + 1 : before;
    gate.properties.illuminated = illuminated;
    gate.properties.darkTicks = darkTicks;
    gate.properties.open = illuminated || (gate.properties.open === true && darkTicks < 2);
    gate.properties.closingBeat = illuminated ? 0 : Math.min(2, darkTicks);
  }
}

function lightCorridorWorld(previous: WorldState | null): WorldState {
  const state = enterWorld("06-2", [
    inventoryDisplay("06-2"),
    entity("06-2-start", "ㄷ자 복도 관찰 책갈피", "06-2", 0, { kind: "platform", safe: true }),
    entity("06-2-ignition", "중앙 점화대", "06-2", 0, { kind: "ignition-stand", relightsWicks: true }),
    large("06-2-lantern-a", "줄무늬 휴대 등불", "06-2", 0, { tool: "lantern", lit: true, lightRadius: 3, handleShape: "striped" }),
    large("06-2-lantern-b", "둥근손잡이 휴대 등불", "06-2", 0, { tool: "lantern", lit: true, lightRadius: 3, handleShape: "round" }),
    entity("06-2-hook-a", "첫째 벽걸이", "06-2", 2, { kind: "wall-hook", capacity: 1, radiusMark: 3 }),
    entity("06-2-sensor-a", "첫째 빛문 점선 원", "06-2", 2, { kind: "light-sensor", radius: 3, illuminated: false }),
    entity("06-2-gate-a", "첫째 빛문", "06-2", 3, { kind: "light-gate", open: false, darkTicks: 2, closingBeat: 2, closeDelayTicks: 2, illuminated: false }),
    entity("06-2-hook-b", "둘째 벽걸이", "06-2", 5, { kind: "wall-hook", capacity: 1, radiusMark: 3 }),
    entity("06-2-sensor-b", "둘째 빛문 점선 원", "06-2", 5, { kind: "light-sensor", radius: 3, illuminated: false }),
    entity("06-2-gate-b", "둘째 빛문", "06-2", 6, { kind: "light-gate", open: false, darkTicks: 2, closingBeat: 2, closeDelayTicks: 2, illuminated: false }),
    entity("06-2-hook-c", "셋째 벽걸이", "06-2", 8, { kind: "wall-hook", capacity: 1, radiusMark: 3 }),
    entity("06-2-sensor-c", "셋째 빛문 점선 원", "06-2", 8, { kind: "light-sensor", radius: 3, illuminated: false }),
    entity("06-2-gate-c", "셋째 빛문", "06-2", 9, { kind: "light-gate", open: false, darkTicks: 2, closingBeat: 2, closeDelayTicks: 2, illuminated: false }),
    entity("06-2-pedestal", "출구 등불 받침", "06-2", 10, { kind: "shelf", capacity: 1, requiresLitLantern: true }),
    entity("06-2-exit", "빛 복도 출구", "06-2", 11, { kind: "platform", safe: true }),
  ], previous);
  refreshLightCorridor(state, false);
  return state;
}

const lightCorridor: SegmentDefinition = {
  id: "06-2",
  title: "빛을 나누는 복도",
  goal: "등불 두 개 안에서 세 빛문을 지나고 켜진 등불 하나를 출구 받침에 남기기",
  description: "등불의 세 칸 반경, 세 센서 원, 두 박자 닫힘 고리, 손 1칸이 모두 표시됩니다.",
  hints: [
    "등불의 점선 반경과 각 문의 센서 원이 겹치는지 보세요.",
    "든 등불도 센서를 밝히고, 벽걸이에 놓으면 손이 비어요.",
    "한 등불을 계속 들고 가거나 두 등불을 벽걸이 사이에서 회수해 이어 보세요.",
  ],
  enter: lightCorridorWorld,
  execute: (state, action) => {
    for (const [suffix, x] of [["a", 3], ["b", 6], ["c", 9]] as const) {
      const gate = state.entities[`06-2-gate-${suffix}`];
      if (!crosses(state, action, x)) continue;
      if (gate.properties.open !== true) return blocked(state, `${gate.name} 앞 센서 원에 켜진 등불이 없어 통로가 닫혀 있어요.`);
      if (gate.properties.illuminated !== true && Number(gate.properties.closingBeat) >= 1) {
        return failure(state, `${gate.name}의 두 번째 닫힘 박자가 끝나 셔터가 내려왔어요. 이동 완료 3박보다 짧은 남은 창이었어요.`);
      }
    }
    const physical = executeAndRefresh(state, action);
    if (physical.outcome === "done") {
      if (action.verb === "place" && action.target.startsWith("06-2-lantern-") && action.destination?.startsWith("06-2-hook-")) {
        physical.world.entities[action.target].properties.usedWallHook = true;
      }
      refreshLightCorridor(physical.world, false);
    }
    return physical;
  },
  advance: (state) => {
    const next = tick(state);
    refreshLightCorridor(next, true);
    return { world: next, events: [], canChange: Object.values(next.entities).some((item) => item.properties.kind === "light-gate" && item.properties.open === true) };
  },
  idleAction: (state) => toolAt(state, "06-2-pedestal", "lantern")?.properties.lit === true
    && state.entities["06-2-gate-c"].properties.open === true
    && !at(state, "hero", "06-2-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "06-2-exit" }
    : null,
  complete: (state) => at(state, "hero", "06-2-exit")
    && !!toolAt(state, "06-2-pedestal", "lantern")?.properties.lit,
};

function refreshWetShelf(state: WorldState): void {
  const lens = toolAt(state, "06-3-lens-slot", "lens");
  const striker = toolAt(state, "06-3-ignition-slot", "striker");
  const rope = toolAt(state, "06-3-rope-handle", "rope-loop");
  state.entities["06-3-seal"].properties.readable = !!lens;
  state.entities["06-3-lantern"].properties.lit = striker?.properties.struck === true;
  state.entities["06-3-rope-door"].properties.open = rope?.properties.pulled === true;
}

const wetShelf: SegmentDefinition = {
  id: "06-3",
  title: "젖은 선반",
  goal: "세 작은 물건을 건너편에 전달해 봉인을 읽고 등불을 켜고 밧줄문 열기",
  description: "고리 2칸, 바구니 1칸, 두 손 안전 밧줄, 세 장치 홈의 단면이 한 화면에 보입니다.",
  hints: [
    "세 물건과 고리 두 칸, 바구니 한 칸을 대응해 보세요.",
    "바구니로 하나를 보내거나 두 번 왕복하면 수량은 그대로 건너가요.",
    "두 물건을 고리에 걸고 나머지 하나를 바구니로 보내거나, 두 번 나누어 직접 옮기세요.",
  ],
  enter: (previous) => enterWorld("06-3", [
    inventoryDisplay("06-3"),
    entity("06-3-start", "물길 앞 관찰 책갈피", "06-3", 0, { kind: "platform", safe: true }),
    entity("06-3-start-shelf", "출발 선반", "06-3", 0, { kind: "shelf", capacity: 2 }),
    small("06-3-striker", "삼각 손잡이 점화쇠", "06-3", 0, { tool: "striker", orientation: 0, struck: false }),
    small("06-3-lens", "둥근 렌즈", "06-3", 0, { tool: "lens", handleShape: "round" }),
    small("06-3-rope-loop", "매듭 밧줄 고리", "06-3", 0, { tool: "rope-loop", orientation: 0, pulled: false }),
    entity("06-3-basket", "작은 운반 바구니", "06-3", 0, { kind: "cargo-basket", capacityItems: 1, level: "start", capacity: 0.2 }, { movable: false, capacity: 0.2 }),
    entity("06-3-basket-winch", "바구니 왕복 손잡이", "06-3", 0, { kind: "winch", orientation: 0, moves: "06-3-basket" }),
    entity("06-3-recovery-net", "입구 회수망", "06-3", 1, { kind: "recovery-net", returnsTo: "06-3-start-shelf" }, { material: "cloth" }),
    entity("06-3-water", "빠른 물길", "06-3", 3, { kind: "water-channel", extinguishesWicks: true }, { material: "water" }),
    entity("06-3-footway", "기울어진 좁은 발디딤대", "06-3", 3, { kind: "footway", requiresTwoHands: true, safeRope: true }),
    entity("06-3-destination", "건너편 안전 선반", "06-3", 6, { kind: "shelf", safe: true, capacity: 2 }),
    entity("06-3-lens-slot", "둥근 렌즈 홈", "06-3", 7, { kind: "device-slot", accepts: "lens", capacity: 1 }),
    entity("06-3-seal", "읽기 봉인", "06-3", 7, { kind: "seal", readable: false }),
    entity("06-3-ignition-slot", "삼각 점화 홈", "06-3", 7, { kind: "device-slot", accepts: "striker", capacity: 1 }),
    entity("06-3-lantern", "봉인 등불", "06-3", 7, { kind: "fixed-lantern", lit: false, relightable: true }),
    entity("06-3-rope-handle", "매듭 밧줄 손잡이", "06-3", 7, { kind: "device-slot", accepts: "rope-loop", capacity: 1 }),
    entity("06-3-rope-door", "밧줄문", "06-3", 8, { kind: "gate", open: false }),
    entity("06-3-exit", "젖은 선반 출구", "06-3", 9, { kind: "platform", safe: true }),
  ], previous),
  execute: (state, action) => {
    if (action.verb === "place" && action.destination === "06-3-basket"
      && Object.values(state.entities).some((item) => item.parent === "06-3-basket")) {
      return clarification(state, "바구니의 작은 물건 한 칸이 찼어요. 어느 물건을 먼저 보낼지 정해 주세요.");
    }
    if (action.verb === "turn" && action.target === "06-3-basket-winch") {
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      const next = physical.world;
      const basket = next.entities["06-3-basket"];
      const destination = basket.properties.level === "start" ? next.entities["06-3-destination"].location : next.entities["06-3-start"].location;
      basket.properties.level = basket.properties.level === "start" ? "destination" : "start";
      moveTree(next, basket.id, destination);
      refreshInventory(next);
      return result(next, "done", "왕복 손잡이가 바구니와 그 안의 물건 하나를 반대편 정거장으로 옮겼어요.");
    }
    if (action.verb === "turn" && state.entities[action.target]?.properties.tool === "striker") {
      if (state.entities[action.target].parent !== "06-3-ignition-slot") return clarification(state, "점화쇠를 단면이 맞는 삼각 점화 홈에 놓아 주세요.");
      const next = clone(state);
      next.entities[action.target].properties.orientation = Number(next.entities[action.target].properties.orientation) + 1;
      next.entities[action.target].properties.struck = true;
      refreshWetShelf(next);
      return result(next, "done", "점화쇠가 홈에서 불꽃을 내 봉인 등불의 심지를 켰어요.");
    }
    if (action.verb === "turn" && state.entities[action.target]?.properties.tool === "rope-loop") {
      if (state.entities[action.target].parent !== "06-3-rope-handle") return clarification(state, "밧줄 고리를 매듭 단면이 맞는 손잡이에 걸어 주세요.");
      const next = clone(state);
      next.entities[action.target].properties.orientation = Number(next.entities[action.target].properties.orientation) + 1;
      next.entities[action.target].properties.pulled = true;
      refreshWetShelf(next);
      return result(next, "done", "걸린 밧줄 고리를 당겨 밧줄문을 열었어요.");
    }
    if (action.verb === "move" && action.target === "06-3-water") {
      return failure(state, "발디딤대 대신 빠른 물길에 들어가 입구 회수망으로 돌아왔어요. 작은 물건 수량은 손상되지 않아요.");
    }
    if (crosses(state, action, 8) && state.entities["06-3-rope-door"].properties.open !== true) {
      return blocked(state, "밧줄 고리가 손잡이를 당기지 않아 문이 닫혀 있어요. 남은 물건 위치와 왕복 경로를 확인해 주세요.");
    }
    const physical = executeAndRefresh(state, action);
    if (physical.outcome === "done") {
      if (moved(action) && crosses(state, action, 3)) {
        for (const id of physical.world.actors.hero.carrying) {
          if (physical.world.entities[id]?.properties.slot === "small") physical.world.entities[id].properties.transportRoute = "footway";
        }
      }
      refreshWetShelf(physical.world);
    }
    return physical;
  },
  advance: (state) => ({ world: tick(state), events: [], canChange: false }),
  idleAction: (state) => state.entities["06-3-seal"].properties.readable === true
    && state.entities["06-3-lantern"].properties.lit === true
    && state.entities["06-3-rope-door"].properties.open === true
    && !at(state, "hero", "06-3-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "06-3-exit" }
    : null,
  complete: (state) => at(state, "hero", "06-3-exit")
    && state.entities["06-3-seal"].properties.readable === true
    && state.entities["06-3-lantern"].properties.lit === true
    && state.entities["06-3-rope-door"].properties.open === true,
};

function refreshDispatch(state: WorldState): void {
  const lanternAtLight = toolAt(state, "06-4-light-pedestal", "lantern");
  const lanternAtAlarm = toolAt(state, "06-4-alarm-pedestal", "lantern");
  const shadowMirror = toolAt(state, "06-4-shadow-slot", "mirror");
  state.entities["06-4-shadow-bridge"].properties.visible = !!shadowMirror;
  state.entities["06-4-light-chest"].properties.unlocked = lanternAtLight?.properties.lit === true;
  const alarmMirror = toolAt(state, "06-4-alarm-slot", "mirror");
  const alarmLit = lanternAtAlarm?.properties.lit === true && !!alarmMirror;
  const eyeHit = alarmLit && Number(alarmMirror?.properties.orientation) % 2 === 1;
  state.entities["06-4-alarm-eye"].properties.illuminated = eyeHit;
  state.entities["06-4-alarm-shutter"].properties.open = !eyeHit;
  state.entities["06-4-alarm-chest"].properties.unlocked = alarmLit && !eyeHit;
  state.entities["06-4-beam-map"].properties.path = !alarmLit ? "none" : eyeHit ? "lantern>mirror>alarm-eye" : "lantern>mirror>seal-chest";
}

const dispatchYard: SegmentDefinition = {
  id: "06-4",
  title: "세 갈래 출고장",
  goal: "유한한 등불과 반사경을 세 갈래에 배분해 인장 상자 셋을 열고 중앙 출구로 돌아오기",
  description: "반사경 2, 등불 1, 고정 채광창, 반사경 홈, 경보 눈으로 향하는 시연 광선이 공개됩니다.",
  hints: [
    "열린 상자에 남은 물건과 아직 닫힌 갈래의 홈을 함께 보세요.",
    "그림자 다리는 채광창과 반사경 하나로 남고, 경보 눈에 닿은 빛은 셔터를 닫아요.",
    "매 갈래 뒤 모두 회수하거나, 그림자 다리 반사경 하나만 남기고 나머지를 옮기세요.",
  ],
  enter: (previous) => enterWorld("06-4", [
    inventoryDisplay("06-4"),
    entity("06-4-start", "중앙 회전 선반 책갈피", "06-4", 0, { kind: "platform", safe: true }),
    entity("06-4-stock", "중앙 실물 재고판", "06-4", 0, { kind: "inventory-board", mirrors: 2, lanterns: 1 }),
    small("06-4-mirror-a", "삼각 손잡이 반사경", "06-4", 0, { tool: "mirror", orientation: 0, handleShape: "triangle" }),
    small("06-4-mirror-b", "둥근 손잡이 반사경", "06-4", 0, { tool: "mirror", orientation: 0, handleShape: "round" }),
    large("06-4-lantern", "무거운 출고 등불", "06-4", 0, { tool: "lantern", lit: true }),
    entity("06-4-light-pedestal", "빛문 등불 받침", "06-4", 2, { kind: "device-slot", capacity: 1, accepts: "lantern" }),
    entity("06-4-light-chest", "빛문 인장 상자", "06-4", 3, { kind: "seal-chest", open: false, unlocked: false }),
    entity("06-4-skylight", "고정 채광창", "06-4", -2, { kind: "fixed-light", lit: true }),
    entity("06-4-shadow-slot", "그림자 다리 반사경 홈", "06-4", -3, { kind: "device-slot", capacity: 1, accepts: "mirror" }),
    entity("06-4-shadow-bridge", "그림자 다리", "06-4", -3, { kind: "light-bridge", visible: false }),
    entity("06-4-shadow-chest", "그림자 인장 상자", "06-4", -4, { kind: "seal-chest", open: false, unlocked: true }),
    entity("06-4-alarm-pedestal", "경보 갈래 등불 받침", "06-4", 6, { kind: "device-slot", capacity: 1, accepts: "lantern" }),
    entity("06-4-alarm-slot", "경보 갈래 반사경 홈", "06-4", 6, { kind: "device-slot", capacity: 1, accepts: "mirror", routes: "seal-chest|alarm-eye" }),
    entity("06-4-alarm-eye", "경보 눈", "06-4", 7, { kind: "alarm-eye", illuminated: false, closes: "06-4-alarm-shutter" }),
    entity("06-4-alarm-shutter", "경보 셔터", "06-4", 7, { kind: "shutter", open: true }),
    entity("06-4-alarm-chest", "경보 갈래 인장 상자", "06-4", 7, { kind: "seal-chest", open: false, unlocked: false }),
    entity("06-4-beam-map", "모형 광선 경로판", "06-4", 6, { kind: "beam-display", path: "none", alarmCause: "light>eye>shutter" }, { material: "light" }),
    entity("06-4-teacups", "두 사람 몫의 낡은 찻잔", "06-4", 0, { kind: "story-object", optional: true }, { material: "glass" }),
    entity("06-4-exit", "중앙 출구", "06-4", 0, { kind: "platform", safe: true }),
  ], previous),
  execute: (state, action) => {
    if (moved(action) && action.target === "06-4-shadow-chest" && state.entities["06-4-shadow-bridge"].properties.visible !== true) {
      return blocked(state, "고정 채광창의 빛을 반사경 홈에서 꺾어야 그림자 다리가 생겨요.");
    }
    if (moved(action) && action.target === "06-4-alarm-chest" && state.entities["06-4-alarm-shutter"].properties.open !== true) {
      return blocked(state, "광선이 경보 눈에 닿아 셔터가 닫혔어요. 반사경의 공개된 다른 방향으로 빛을 돌릴 수 있어요.");
    }
    if (action.verb === "open" && action.target.endsWith("chest")) {
      if (state.entities[action.target].properties.unlocked !== true) return blocked(state, `${state.entities[action.target].name}에 필요한 실제 빛 경로가 아직 이어지지 않았어요.`);
      if (action.target === "06-4-shadow-chest" && state.entities["06-4-shadow-bridge"].properties.visible !== true) {
        return blocked(state, "그림자 다리가 사라져 상자에 닿을 수 없어요.");
      }
    }
    const physical = executeAndRefresh(state, action);
    if (physical.outcome === "done") refreshDispatch(physical.world);
    return physical;
  },
  advance: (state) => {
    const next = tick(state);
    refreshDispatch(next);
    return { world: next, events: [], canChange: false };
  },
  idleAction: (state) => ["06-4-light-chest", "06-4-shadow-chest", "06-4-alarm-chest"]
    .every((id) => state.entities[id].properties.open === true)
    && (state.actors.hero.location.x >= 0 || state.entities["06-4-shadow-bridge"].properties.visible === true)
    && !at(state, "hero", "06-4-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "06-4-exit" }
    : null,
  complete: (state) => at(state, "hero", "06-4-exit")
    && ["06-4-light-chest", "06-4-shadow-chest", "06-4-alarm-chest"].every((id) => state.entities[id].properties.open === true),
};

function moveElevator(state: WorldState, level: "lower" | "upper"): void {
  const elevator = state.entities["06-5-elevator"];
  const dock = state.entities[level === "upper" ? "06-5-upper-dock" : "06-5-lower-dock"];
  elevator.properties.level = level;
  elevator.properties.movingTo = "none";
  elevator.properties.braked = true;
  elevator.properties.brakeMark = `${level}-locked`;
  moveTree(state, elevator.id, dock.location);
}

function refreshFinalLight(state: WorldState): void {
  const lampFilled = ["06-5-lamp-slot-a", "06-5-lamp-slot-b"].every((slot) => toolAt(state, slot, "lantern")?.properties.lit === true);
  const mirrorFilled = ["06-5-mirror-slot-a", "06-5-mirror-slot-b"].every((slot) => !!toolAt(state, slot, "mirror"));
  const door = state.entities["06-5-light-door"];
  door.properties.beams = (lampFilled ? 1 : 0) + (mirrorFilled ? 1 : 0);
  door.properties.open = lampFilled && mirrorFilled;
  state.entities["06-5-beam-map"].properties.path = door.properties.open === true
    ? "lamp-a>mirror-a>receiver-a|lamp-b>mirror-b>receiver-b"
    : lampFilled ? "lamps-ready|mirrors-missing" : mirrorFilled ? "mirrors-ready|lamps-missing" : "incomplete";
}

function finalStorehouseWorld(previous: WorldState | null): WorldState {
  const state = enterWorld("06-5", [
    inventoryDisplay("06-5"),
    entity("06-5-start", "중앙 재고판 책갈피", "06-5", 0, { kind: "platform", safe: true }),
    entity("06-5-stock", "실시간 중앙 재고판", "06-5", 0, { kind: "inventory-board", lanterns: 2, mirrors: 2, brassKeys: 1, counterweights: 1 }),
    large("06-5-lantern-a", "1번 무거운 등불", "06-5", 0, { tool: "lantern", lit: true, floorNumber: 1 }),
    large("06-5-lantern-b", "2번 무거운 등불", "06-5", 0, { tool: "lantern", lit: true, floorNumber: 2 }),
    small("06-5-mirror-a", "삼각 손잡이 반사경", "06-5", 0, { tool: "mirror", orientation: 0, handleShape: "triangle" }),
    small("06-5-mirror-b", "둥근 손잡이 반사경", "06-5", 0, { tool: "mirror", orientation: 0, handleShape: "round" }),
    small("06-5-key", "하나뿐인 놋쇠 열쇠", "06-5", 0, { tool: "brass-key", orientation: 0, floorNumber: 1 }),
    large("06-5-counterweight", "도르래 추", "06-5", 0, { tool: "counterweight", fixedWhenMoving: true }),
    entity("06-5-lower-dock", "아래층 승강 정거장", "06-5", 1, { kind: "platform", safe: true }),
    entity("06-5-drive-socket", "승강기 구동 추 홈", "06-5", 1, { kind: "device-slot", capacity: 1, accepts: "counterweight", connectedTo: "elevator|cargo-basket" }),
    entity("06-5-lower-lock", "승강기 안전문 열쇠구멍", "06-5", 1, { kind: "lock", acceptsKey: true, opens: "06-5-safety-door", unlocked: false, handleMark: "vertical" }),
    entity("06-5-safety-door", "아래층 승강기 안전문", "06-5", 1, { kind: "gate", open: false, persistentOpen: true }),
    entity("06-5-elevator", "화물 승강칸", "06-5", 1, { kind: "elevator", boardable: true, level: "lower", movingTo: "none", braked: true, brakeMark: "lower-locked", loadMarks: "2/2" }, { capacity: 2 }),
    entity("06-5-elevator-lever", "승강칸 양방향 레버", "06-5", 1, { kind: "lever", orientation: 0, parentDevice: "06-5-elevator" }, { parent: "06-5-elevator", weight: 0 }),
    entity("06-5-cargo-basket", "작은 화물 바구니", "06-5", 1, { kind: "cargo-basket", level: "lower", movingTo: "none", capacityItems: 1 }, { capacity: 1 }),
    entity("06-5-lower-winch", "아래 손윈치", "06-5", 1, { kind: "winch", orientation: 0, moves: "06-5-cargo-basket" }),
    entity("06-5-upper-dock", "위층 승강 정거장", "06-5", 10, { kind: "platform", safe: true }),
    entity("06-5-upper-shelf", "위층 완만한 인출 선반", "06-5", 10, { kind: "shelf", capacity: 4, autoUnload: true }),
    entity("06-5-upper-winch", "위 손윈치", "06-5", 10, { kind: "winch", orientation: 0, moves: "06-5-cargo-basket" }),
    entity("06-5-lamp-slot-a", "왼쪽 등불 홈", "06-5", 12, { kind: "device-slot", capacity: 1, accepts: "lantern", receiver: "a" }),
    entity("06-5-lamp-slot-b", "오른쪽 등불 홈", "06-5", 12, { kind: "device-slot", capacity: 1, accepts: "lantern", receiver: "b" }),
    entity("06-5-mirror-slot-a", "왼쪽 반사경 홈", "06-5", 12, { kind: "device-slot", capacity: 1, accepts: "mirror", receiver: "a" }),
    entity("06-5-mirror-slot-b", "오른쪽 반사경 홈", "06-5", 12, { kind: "device-slot", capacity: 1, accepts: "mirror", receiver: "b" }),
    entity("06-5-beam-map", "이중 광선 경로판", "06-5", 12, { kind: "beam-display", path: "incomplete" }, { material: "light" }),
    entity("06-5-light-door", "이중 빛문", "06-5", 13, { kind: "light-gate", open: false, beams: 0, requiredBeams: 2 }),
    entity("06-5-exit-locker", "출구 열쇠 보관함", "06-5", 13, { kind: "lock", acceptsKey: true, opens: "06-5-exit-locker-door", unlocked: false, returned: false, handleMark: "vertical", capacity: 1 }),
    entity("06-5-exit-locker-door", "출구 보관함 문", "06-5", 13, { kind: "gate", open: false, persistentOpen: true }),
    entity("06-5-exit", "등불 보관소 출구", "06-5", 14, { kind: "platform", safe: true }),
  ], previous);
  refreshFinalLight(state);
  return state;
}

const finalInventory: SegmentDefinition = {
  id: "06-5",
  title: "마지막 재고 조사",
  goal: "모든 필수 물건을 위층에 배분해 이중 빛문을 열고 열쇠를 출구 보관함에 반납하기",
  description: "고정 수량, 승강기 2/2 적재, 바구니 1칸, 구동 추 홈, 층별 브레이크, 네 빛 홈이 공개됩니다.",
  hints: [
    "재고판의 선·손·홈 아이콘과 승강기 2/2 저울을 보세요.",
    "추는 운행 동안 구동 홈에 남고, 큰 등불은 승강기나 바구니로 하나씩 보낼 수 있어요.",
    "등불을 승강기로 하나씩 옮기거나 아래 손윈치 바구니로 먼저 보내고, 반사경 둘과 열쇠는 마지막 승강에 배분하세요.",
  ],
  enter: finalStorehouseWorld,
  execute: (state, action) => {
    const turnedKey = turnInsertedKey(state, action);
    if (turnedKey) {
      const lock = turnedKey.world.entities[turnedKey.world.entities[action.target]?.parent ?? ""];
      if (lock?.id === "06-5-exit-locker") lock.properties.returned = true;
      return turnedKey;
    }
    if (action.verb === "take" && state.entities[action.target]?.properties.tool === "counterweight"
      && state.entities[action.target].parent === "06-5-drive-socket"
      && state.entities["06-5-elevator"].properties.braked !== true) {
      return blocked(state, "층 브레이크가 잠기기 전에는 구동 홈의 추를 뺄 수 없어요.");
    }
    if (action.verb === "place" && action.destination === "06-5-cargo-basket"
      && Object.values(state.entities).some((item) => item.parent === "06-5-cargo-basket")) {
      return clarification(state, "작은 화물 바구니의 큰 물건 한 칸이 이미 찼어요.");
    }
    if (action.verb === "board" && action.target === "06-5-elevator") {
      const actor = state.actors[action.actor];
      const predicted = currentLoad(state, action.target) + 1
        + actor.carrying.reduce((mass, id) => mass + entityMass(state, id), 0);
      if (predicted > state.entities[action.target].capacity) {
        return clarification(state, `승강기 적재 실루엣 합 ${predicted}/${state.entities[action.target].capacity}은 출발 전 공개 용량을 넘어요. 물건을 나누어 주세요.`);
      }
    }
    if (action.verb === "turn" && action.target === "06-5-elevator-lever") {
      if (!toolAt(state, "06-5-drive-socket", "counterweight")) return blocked(state, "구동 추가 옆 홈에 설치되지 않아 레버가 움직이지 않아요.");
      if (state.entities["06-5-safety-door"].properties.open !== true) return blocked(state, "놋쇠 열쇠로 아래층 안전문을 먼저 열어야 해요.");
      const elevator = state.entities["06-5-elevator"];
      if (elevator.properties.movingTo !== "none") return blocked(state, "승강칸이 다음 층에 완전히 닿을 때까지 기다려 주세요.");
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      const next = physical.world;
      const targetLevel = next.entities["06-5-elevator"].properties.level === "lower" ? "upper" : "lower";
      next.entities["06-5-elevator"].properties.movingTo = targetLevel;
      next.entities["06-5-elevator"].properties.braked = false;
      next.entities["06-5-elevator"].properties.brakeMark = "released";
      return result(next, "done", `승강칸 브레이크가 풀리고 ${targetLevel === "upper" ? "위층" : "아래층"}으로 움직이기 시작했어요.`);
    }
    if (action.verb === "turn" && (action.target === "06-5-lower-winch" || action.target === "06-5-upper-winch")) {
      if (!toolAt(state, "06-5-drive-socket", "counterweight")) return blocked(state, "구동 추가 설치되지 않아 바구니 줄이 움직이지 않아요.");
      const basket = state.entities["06-5-cargo-basket"];
      if (basket.properties.movingTo !== "none") return blocked(state, "바구니가 정거장에 닿을 때까지 기다려 주세요.");
      const physical = executePhysicalAction(state, action);
      if (physical.outcome !== "done") return physical;
      const next = physical.world;
      next.entities["06-5-cargo-basket"].properties.movingTo = basket.properties.level === "lower" ? "upper" : "lower";
      return result(next, "done", "손윈치가 연결된 구동 추를 써서 바구니를 반대 층으로 움직이기 시작했어요.");
    }
    if (crosses(state, action, 13) && state.entities["06-5-light-door"].properties.open !== true) {
      return blocked(state, "이중 빛문의 수광판 둘 중 하나 이상이 비어 있어요. 현재 광선 경로가 점선으로 남아 있어요.");
    }
    const physical = executeAndRefresh(state, action);
    if (physical.outcome === "done") refreshFinalLight(physical.world);
    return physical;
  },
  advance: (state) => {
    const next = tick(state);
    const elevator = next.entities["06-5-elevator"];
    if (elevator.properties.movingTo === "upper" || elevator.properties.movingTo === "lower") {
      if (elevator.properties.movingTo === "upper") {
        for (const cargo of Object.values(next.entities).filter((item) => item.parent === elevator.id && item.properties.slot === "large")) {
          cargo.properties.transportRoute = "elevator";
        }
      }
      moveElevator(next, elevator.properties.movingTo);
    }
    const basket = next.entities["06-5-cargo-basket"];
    if (basket.properties.movingTo === "upper") {
      basket.properties.level = "upper";
      basket.properties.movingTo = "none";
      moveTree(next, basket.id, next.entities["06-5-upper-dock"].location);
      for (const cargo of Object.values(next.entities).filter((item) => item.parent === basket.id)) {
        cargo.properties.transportRoute = "cargo-winch";
        cargo.parent = "06-5-upper-shelf";
        moveTree(next, cargo.id, next.entities["06-5-upper-shelf"].location);
      }
    } else if (basket.properties.movingTo === "lower") {
      basket.properties.level = "lower";
      basket.properties.movingTo = "none";
      moveTree(next, basket.id, next.entities["06-5-lower-dock"].location);
    }
    refreshInventory(next);
    refreshFinalLight(next);
    return { world: next, events: [], canChange: elevator.properties.movingTo !== "none" || basket.properties.movingTo !== "none" };
  },
  idleAction: (state) => state.entities["06-5-light-door"].properties.open === true
    && toolAt(state, "06-5-exit-locker", "brass-key") !== undefined
    && state.entities["06-5-exit-locker"].properties.returned === true
    && !at(state, "hero", "06-5-exit")
    ? { kind: "action", actor: "hero", verb: "move", target: "06-5-exit" }
    : null,
  complete: (state) => at(state, "hero", "06-5-exit")
    && state.entities["06-5-light-door"].properties.open === true
    && !!toolAt(state, "06-5-exit-locker", "brass-key")
    && state.entities["06-5-exit-locker"].properties.returned === true,
};

export const STOREHOUSE_STAGE: CampaignStageDefinition = {
  contentRevision: "shared-v1",
  id: STAGE_ID,
  title: "등불 보관소",
  practice,
  segments: [brassKey, lightCorridor, wetShelf, dispatchYard, finalInventory],
  story: {
    afterSegment: "06-4",
    object: "06-4-teacups",
    text: "하나는 늘 돌아올 사람 몫으로 비워 두었다.",
  },
};

/** Public physical vocabulary for the interpreter; current values always come from WorldState. */
export const STOREHOUSE_PUBLIC_CATALOG = Object.fromEntries(
  [practice, ...STOREHOUSE_STAGE.segments].map((segment) => {
    const initial = segment.enter(null);
    return [segment.id, initial.visible.map((id) => initial.entities[id]).filter(Boolean).map((item) => ({
      id: item.id,
      name: item.name,
      properties: Object.keys(item.properties).sort(),
    }))];
  }),
) as Readonly<Record<string, readonly { id: string; name: string; properties: readonly string[] }[]>>;
