import { RAIN_BOATS, RAIN_ORGAN, RAIN_REACH } from "./rain-late";
import { at, makeEntity, makeWorld, stillWorld, type SegmentDefinition } from "../../../src/campaign/level";
import { executePhysicalAction } from "../../../src/campaign/physics";
import type { ActionResult } from "../../../src/campaign/program";
import type { PhysicalAction, WorldState } from "../../../src/campaign/types";

function failure(world: WorldState, reason: string): ActionResult {
  return { world, outcome: "failure", reason };
}
function moveRiders(world: WorldState, vesselId: string): void {
  const vessel = world.entities[vesselId];
  for (const actor of Object.values(world.actors)) {
    if (actor.riding !== vesselId) continue;
    actor.location = { ...vessel.location };
    for (const id of actor.carrying) world.entities[id].location = { ...actor.location };
  }
  for (const entity of Object.values(world.entities)) {
    if (entity.parent === vesselId) entity.location = { ...vessel.location };
  }
}
function crossedWater(world: WorldState, action: PhysicalAction, from: number, to: number): boolean {
  if (!["move", "jump", "duck"].includes(action.verb)) return false;
  const actor = world.actors[action.actor];
  const target = world.entities[action.target];
  if (!actor || !target) return false;
  return Math.min(actor.location.x, target.location.x) < to && Math.max(actor.location.x, target.location.x) > from;
}

export const RAIN_INTRO: SegmentDefinition = {
  id: "02-1",
  title: "떠오르는 짐",
  goal: "편지를 적시지 않고 건너편 발판에 도착하기",
  description: "빈 코르크 상자는 용사 한 명을 태울 수 있어요. 물은 건너편으로 흐르고, 물가에서는 상자에 올라탈 때까지 상자를 잡을 수 있어요.",
  hints: ["상자의 손잡이와 수면선을 살펴보세요.", "코르크는 물에 뜨고, 흐르는 물은 뜬 물건을 옮겨요.", "빈 코르크 상자를 물에 띄우고 그 위에 올라 건너편 발판에서 내려."],
  enter: () => makeWorld(2, "02-1", [
    makeEntity("rain-start", "출발 돌턱", "02-1", 0, { material: "stone", properties: { kind: "platform", safe: true } }),
    makeEntity("rain-cork", "빈 코르크 상자", "02-1", 1, { description: "두 손잡이 · 이동 가능 · 용사 한 명 · 가벼운 코르크 · 물에서 뜸. 건너편 발판까지 내릴 수 있는 거리에 오면 도착 표시가 켜져요.", material: "cork", movable: true, weight: 0.2, capacity: 1, reach: 2, properties: { kind: "box", slot: "large", boardable: true, buoyant: true, afloat: false, landingReachable: false, driftAge: 0, stable: true } }),
    makeEntity("rain-launch", "물가", "02-1", 2, { description: "물이 건너편 발판으로 흐름. 이곳에서는 상자에 올라탈 때까지 상자를 잡을 수 있음.", material: "water", reach: 2, capacity: 10, properties: { kind: "water", flowDirection: "right", flowSpeed: 2 } }),
    makeEntity("rain-platform", "건너편 발판", "02-1", 5, { description: "수면 위 마른 발판. 상자에서 한 칸 거리로 내릴 수 있음.", material: "stone", reach: 2, properties: { kind: "platform", safe: true } }),
    makeEntity("rain-net", "먼 안전망", "02-1", 8, { description: "너무 먼저 떠내려간 상자를 받는 안전망", material: "cloth", properties: { kind: "net" } }),
  ]),
  execute: (world, action) => {
    if (crossedWater(world, action, 1, 5)) {
      const actor = world.actors[action.actor];
      if (!actor.riding) return failure(world, "발판 사이에는 발 디딜 곳이 없어요. 편지가 물에 젖기 전에 안전망으로 돌아왔어요.");
      return { world, outcome: "clarification", reason: "물살이 상자를 옮기고 있어요. 도착한 발판에서 내려야 해요." };
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => {
    const next = structuredClone(world);
    next.tick += 1;
    const cork = next.entities["rain-cork"];
    if (cork.location.x >= 2 && cork.location.x < 5) {
      cork.properties.afloat = true;
      cork.properties.driftAge = Number(cork.properties.driftAge) + 1;
      if (Number(cork.properties.driftAge) > 1) {
        if (Object.values(next.actors).every((actor) => actor.riding !== cork.id) && next.actors.hero.location.x < 5) {
          cork.location.x = 8;
          return { world: next, events: [], canChange: false, failure: "용사가 타기 전에 물살이 상자를 손이 닿지 않는 안전망으로 옮겼어요. 놓은 뒤 바로 올라탈 수 있었어요." };
        }
        cork.location.x = Math.min(4, cork.location.x + 2);
        moveRiders(next, cork.id);
      }
    }
    const landing = next.entities["rain-platform"];
    cork.properties.landingReachable = cork.location.region === landing.location.region
      && Math.hypot(cork.location.x - landing.location.x, cork.location.y - landing.location.y) <= Math.max(cork.reach, landing.reach, 1);
    return { world: next, events: [], canChange: cork.properties.afloat === true && cork.location.x < 4 };
  },
  complete: (world) => at(world, "hero", "rain-platform") && world.actors.hero.riding === null,
};

export const RAIN_PRACTICE: SegmentDefinition = {
  id: "02-practice",
  title: "얕은 빗물 홈",
  goal: "작은 코르크 블록을 밀고, 놓고, 다시 당겨 보세요. 연습 비용은 없어요.",
  description: "작은 블록은 탈 수 없어요. 바닥 자리와 물가는 모두 손이 닿는 범위에 있어요.",
  hints: ["작은 블록의 손잡이를 살펴보세요.", "물건 이름과 놓을 자리를 함께 적을 수 있어요.", "작은 코르크 블록을 바닥 자리로 밀어."],
  enter: () => makeWorld(2, "02-practice", [
    makeEntity("practice-cork", "작은 코르크 블록", "02-practice", 0, { material: "cork", movable: true, weight: 0.1, capacity: 0, properties: { kind: "box", slot: "small", buoyant: true, boardable: false } }),
    makeEntity("practice-circle", "바닥 자리", "02-practice", 0.5, { material: "stone", properties: { kind: "platform", safe: true } }),
    makeEntity("practice-water", "물가", "02-practice", 1, { material: "water", properties: { kind: "water" } }),
  ]),
  advance: stillWorld,
  complete: () => false,
};

export const RAIN_CHANNELS: SegmentDefinition = {
  id: "02-2",
  title: "두 물길",
  goal: "시작 발판을 잠기게 하지 않고 다리를 띄워 출구로 가기",
  description: "주 급수는 세 칸, 정비 홈과 위 배수홈은 한 칸이에요. 위 눈금은 3, 시작 발판이 잠기는 눈금은 4를 넘을 때예요.",
  hints: ["세 칸 급수와 한 칸 배수의 폭을 비교해 보세요.", "빠른 급수는 직접 멈출 수 있고, 작은 흐름은 같은 폭의 배수와 균형을 이뤄요.", "반달 수문을 열고 수위가 위 눈금에 닿으면 닫은 다음 다리를 타고 출구에서 내려."],
  enter: () => makeWorld(2, "02-2", [
    makeEntity("channels-start", "마른 시작 발판", "02-2", 0, { material: "stone", properties: { kind: "platform", safe: true, floodMark: 4 } }),
    makeEntity("channels-gate", "반달 수문", "02-2", 0, { description: "열면 세 칸 물줄기를 수조로 보냄. 닫으면 다른 홈으로 흐름.", properties: { kind: "valve", open: false, flow: 3, connectedTo: "channels-tank" } }),
    makeEntity("channels-tank", "눈금 수조", "02-2", 1, { material: "water", reach: 2, capacity: 4, properties: { kind: "tank", level: 0, upperMark: 3, overflowMark: 4 } }),
    makeEntity("channels-gap", "한 칸 정비 홈", "02-2", 1, { description: "막히면 한 칸 물줄기가 수조로 넘침", material: "stone", properties: { kind: "channel", flow: 1, connectedTo: "channels-tank" } }),
    makeEntity("channels-plug", "정비 홈 폭의 마개돌", "02-2", 0, { description: "이동 가능 · 한 칸 홈과 같은 폭", material: "stone", movable: true, weight: 1, properties: { kind: "plug", slot: "large", width: 1 } }),
    makeEntity("channels-drain", "위쪽 한 칸 배수홈", "02-2", 1, { material: "stone", properties: { kind: "drain", flow: 1, height: 3 } }),
    makeEntity("channels-bridge", "밧줄 달린 다리", "02-2", 1, { description: "물에 뜨는 다리. 늘어진 탑승 밧줄은 세 칸 길이. 위 눈금에서 출구 높이에 닿음.", material: "wood", movable: true, weight: 0.4, capacity: 1, reach: 3.2, properties: { kind: "raft", boardable: true, buoyant: true, afloat: false, stable: true } }),
    makeEntity("channels-tow", "다리 밧줄", "02-2", 0, { description: "다리를 물가로 당기는 줄. 다리와 연결됨.", material: "cloth", properties: { kind: "rope", connectedTo: "channels-bridge" } }),
    makeEntity("channels-ring", "위쪽 고리 손잡이", "02-2", 1, { location: { region: "02-2", x: 1, y: 4 }, properties: { kind: "handle", holdable: true } }),
    makeEntity("channels-exit", "높은 출구 발판", "02-2", 3, { location: { region: "02-2", x: 3, y: 3 }, material: "stone", reach: 2, properties: { kind: "platform", safe: true } }),
  ]),
  execute: (world, action) => {
    if (action.verb === "pull" && action.target === "channels-tow") {
      const actor = world.actors[action.actor];
      if (!actor || actor.location.x > 1) return { world, outcome: "clarification", reason: "물가의 다리 밧줄에 손이 닿지 않아요." };
      const next = structuredClone(world);
      next.entities["channels-bridge"].location.x = 1;
      moveRiders(next, "channels-bridge");
      return { world: next, outcome: "done", reason: "밧줄을 따라 다리를 탑승 위치로 당겼어요." };
    }
    if (crossedWater(world, action, 1, 3)) return failure(world, "떠 있는 다리에서 내려야 마른 출구에 닿아요. 물 위를 걸을 수는 없어요.");
    return executePhysicalAction(world, action);
  },
  advance: (world) => {
    const next = structuredClone(world);
    next.tick++;
    const tank = next.entities["channels-tank"];
    const plug = next.entities["channels-plug"];
    const gap = next.entities["channels-gap"];
    const blocked = (plug.parent === null || plug.parent === gap.id) && plug.location.x === gap.location.x && plug.location.y === gap.location.y;
    const inflow = (next.entities["channels-gate"].properties.open ? 3 : 0) + (blocked ? 1 : 0);
    const previous = Number(tank.properties.level);
    const incoming = previous + inflow;
    const drained = Math.min(1, Math.max(0, incoming - 3));
    const level = Math.max(0, incoming - drained);
    tank.properties.level = level;
    gap.properties.blocked = blocked;
    tank.properties.inflow = inflow;
    tank.properties.outflow = drained;
    const bridge = next.entities["channels-bridge"];
    bridge.properties.afloat = level >= 3;
    bridge.location.y = level;
    moveRiders(next, bridge.id);
    return { world: next, events: [], canChange: level !== previous, ...(level > 4 ? { failure: "수조 유입이 배수보다 커서 시작 발판까지 잠겼어요. 세 칸 급수와 한 칸 배수의 차이를 확인해 보세요." } : {}) };
  },
  complete: (world) => at(world, "hero", "channels-exit") && world.actors.hero.riding === null && Number(world.entities["channels-tank"].properties.level) <= 4,
};


export const RAIN_STAGE: import("../../../src/campaign/level").CampaignStageDefinition = {
  id: 2, title: "비에 잠긴 회랑",
  segments: [RAIN_INTRO, RAIN_CHANNELS, RAIN_REACH, RAIN_BOATS, RAIN_ORGAN],
  practice: RAIN_PRACTICE,
  story: { afterSegment: "02-4", object: "나란한 우비 걸이", text: "왼쪽 고리는 늘 비워 뒀던 것 같은데." },
};
