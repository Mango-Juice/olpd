import { executePhysicalAction } from "../physics";
import type { CampaignStageDefinition, SegmentDefinition } from "../level";
import type { ActionResult } from "../program";
import type { InstructionProgram, PhysicalAction, Predicate, ProgramNode, WorldState } from "../types";
import {
  blocked,
  clarification,
  done,
  isActionResult,
  moveActor,
  quietEntity,
  quietWorld,
  rememberOne,
  resolved,
  tick,
} from "./late-helpers";

const act = (actor: "hero" | "keeper", verb: PhysicalAction["verb"], target: string, extra: Partial<PhysicalAction> = {}): PhysicalAction => ({ kind: "action", actor, verb, target, ...extra });
const seq = (...children: ProgramNode[]): ProgramNode => ({ kind: "sequence", children });
const par = (...children: ProgramNode[]): ProgramNode => ({ kind: "parallel", children });
const predicate = (entity: string, property: string, value: string | number | boolean): Predicate => ({ kind: "property", entity, property, comparison: "eq", value, source: "visible" });
const wait = (entity: string, property: string, value: string | number | boolean): ProgramNode => ({ kind: "wait", until: predicate(entity, property, value) });
const program = (segmentId: string, text: string, body: ProgramNode): InstructionProgram => ({ version: 2, id: `quiet-${segmentId}`, text, model: "fixture", scope: { region: segmentId }, guard: false, body });

function resolve(world: WorldState, action: PhysicalAction): ActionResult | PhysicalAction {
  return resolved(world, action);
}

function physical(world: WorldState, action: PhysicalAction): ActionResult {
  const parsed = resolve(world, action);
  return isActionResult(parsed) ? parsed : executePhysicalAction(world, parsed);
}

function phaseAdvance(world: WorldState, entityId: string, phases: readonly string[]): { world: WorldState; events: []; canChange: true } {
  const next = tick(world);
  next.entities[entityId].properties.phase = phases[next.tick % phases.length];
  return { world: next, events: [], canChange: true };
}

const fogBridge: SegmentDefinition = {
  id: "08-v2-1",
  title: "안개 속 다리",
  goal: "안개 너머 출구로 건너가야 해요.",
  description: "안개 속 다리",
  hints: ["안개를 먼저 살펴보세요.", "관찰 뒤 드러난 길은 바로 건널 수 있어요.", "안개를 관찰하고 돌다리를 건너 출구로 가세요."],
  scene: { floors: [{ from: 0, to: 2, y: 0 }, { from: 8, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(8, "08-v2-1", [
    quietEntity("08-v2-1-mist", "옅은 안개", "08-v2-1", 3, 1, { kind: "mist", cleared: false }),
    quietEntity("08-v2-1-bridge", "돌다리", "08-v2-1", 5, 0, { kind: "bridge", visible: false, safeToCross: false }),
    quietEntity("08-v2-1-exit", "건너편 출구", "08-v2-1", 10, 0, { kind: "exit", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "observe" && (parsed.target === "08-v2-1-mist" || parsed.target === "08-v2-1-bridge")) {
      const next = structuredClone(world);
      next.entities["08-v2-1-mist"].properties.cleared = true;
      next.entities["08-v2-1-bridge"].properties.visible = true;
      next.entities["08-v2-1-bridge"].properties.safeToCross = true;
      next.entities["08-v2-1-exit"].properties.accessible = true;
      return done(next, "안개 사이로 온전한 돌다리와 건너편 출구가 한눈에 드러났어요.");
    }
    if (parsed.actor === "hero" && (parsed.verb === "move" || parsed.verb === "climb") && parsed.target === "08-v2-1-bridge") {
      if (world.entities[parsed.target].properties.safeToCross !== true) return blocked(world, "아직 안개가 돌다리의 발디딤을 가리고 있어요.");
      return moveActor(world, "hero", parsed.target, "드러난 돌다리 위로 안전하게 들어섰어요.");
    }
    if (parsed.actor === "hero" && (parsed.verb === "move" || parsed.verb === "climb") && parsed.target === "08-v2-1-exit") {
      if (world.entities["08-v2-1-bridge"].properties.safeToCross !== true) return blocked(world, "아직 안개가 돌다리의 발디딤을 가리고 있어요.");
      return moveActor(world, "hero", parsed.target, "드러난 돌다리를 건너 출구에 닿았어요.");
    }
    return clarification(world, "이 장면에서는 안개를 살피거나 드러난 출구로 이동할 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.x === 10,
};

const forkedBridges: SegmentDefinition = {
  id: "08-v2-2",
  title: "끊긴 쪽 보기",
  goal: "건너편 섬에 닿아야 해요.",
  description: "끊긴 쪽 보기",
  hints: ["두 다리가 만나는 섬에서 전체 길을 살펴보세요.", "관찰하면 각 다리의 끊어진 부분이 보입니다.", "섬을 관찰한 뒤 온전한 오른쪽 다리로 건너세요."],
  scene: { floors: [{ from: 0, to: 2, y: 1 }, { from: 8, to: 10, y: 1 }] },
  enter: () => quietWorld(8, "08-v2-2", [
    quietEntity("08-v2-2-left-bridge", "왼쪽 다리", "08-v2-2", 4, 3, { kind: "bridge", visibleState: "unknown" }, { propertyOptions: { visibleState: ["unknown", "connected", "broken"] } }),
    quietEntity("08-v2-2-right-bridge", "오른쪽 다리", "08-v2-2", 4, 0, { kind: "bridge", visibleState: "unknown" }, { propertyOptions: { visibleState: ["unknown", "connected", "broken"] } }),
    quietEntity("08-v2-2-island", "도착 섬", "08-v2-2", 9, 1, { kind: "destination", observed: false }),
  ], { y: 1 }),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "observe" && ["08-v2-2-left-bridge", "08-v2-2-right-bridge", "08-v2-2-island"].includes(parsed.target)) {
      const next = structuredClone(world);
      next.entities["08-v2-2-island"].properties.observed = true;
      next.entities["08-v2-2-left-bridge"].properties.visibleState = "broken";
      next.entities["08-v2-2-left-bridge"].properties.broken = true;
      next.entities["08-v2-2-right-bridge"].properties.visibleState = "connected";
      next.entities["08-v2-2-right-bridge"].properties.broken = false;
      return done(next, "왼쪽 다리의 끊어진 틈과 오른쪽 다리의 이어진 발판이 함께 보였어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "move" && (parsed.target === "08-v2-2-left-bridge" || parsed.target === "08-v2-2-right-bridge")) {
      if (world.entities["08-v2-2-island"].properties.observed !== true) return blocked(world, "안개 속 두 갈래의 끝을 아직 확인하지 않았어요.");
      if (parsed.target !== "08-v2-2-right-bridge") return blocked(world, "고른 다리는 섬까지 온전히 이어지지 않아요.");
      return moveActor(world, "hero", "08-v2-2-island", "온전한 오른쪽 다리를 따라 섬에 닿았어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "08-v2-2-island") {
      if (world.entities[parsed.target].properties.observed !== true) return blocked(world, "안개 속 두 갈래의 끝을 아직 확인하지 않았어요.");
      const connected = ["08-v2-2-left-bridge", "08-v2-2-right-bridge"]
        .filter((id) => world.entities[id].properties.visibleState === "connected");
      if (connected.length !== 1) return blocked(world, "섬까지 이어진 길 하나를 현재 장면에서 확정할 수 없어요.");
      return moveActor(world, "hero", parsed.target, `${world.entities[connected[0]].name}를 따라 섬에 닿았어요.`);
    }
    return clarification(world, "섬을 살펴보거나 건널 다리를 목적지로 함께 지목해 주세요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.x === 9,
};

const windFlag: SegmentDefinition = {
  id: "08-v2-3",
  title: "바람 깃발",
  goal: "바람길 너머로 가야 해요.",
  description: "바람 깃발",
  hints: ["깃발이 내려오는 순간 길의 바람도 잦아듭니다.", "보이는 깃발 상태를 기다림 조건으로 쓸 수 있어요.", "깃발이 내려올 때까지 기다린 뒤 출구로 건너세요."],
  scene: { floors: [{ from: 0, to: 2, y: 0 }, { from: 3, to: 8, y: 1 }, { from: 8, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(8, "08-v2-3", [
    quietEntity("08-v2-3-flag", "바람 깃발", "08-v2-3", 1, 2, { kind: "flag", phase: "up", fluttering: true }, { material: "cloth", propertyOptions: { phase: ["up", "down"] } }),
    quietEntity("08-v2-3-wind-path", "좁은 바람길", "08-v2-3", 5, 1, { kind: "wind-path", safeToCross: false }),
    quietEntity("08-v2-3-exit", "바람길 출구", "08-v2-3", 10, 0, { kind: "exit" }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "08-v2-3-exit") {
      if (world.entities["08-v2-3-flag"].properties.phase !== "down") return blocked(world, "깃발이 올라가 있어 바람길을 건널 수 없어요.");
      return moveActor(world, "hero", parsed.target, "깃발이 내려간 동안 바람길을 건넜어요.");
    }
    return clarification(world, "깃발의 공개 상태를 기다리거나 출구로 이동할 수 있어요.");
  },
  advance: (world) => {
    const advanced = phaseAdvance(world, "08-v2-3-flag", ["up", "down", "down", "down"]);
    const safe = advanced.world.entities["08-v2-3-flag"].properties.phase === "down";
    advanced.world.entities["08-v2-3-flag"].properties.fluttering = !safe;
    advanced.world.entities["08-v2-3-wind-path"].properties.safeToCross = safe;
    return advanced;
  },
  complete: (world) => world.actors.hero.location.x === 10,
};

const fogStairs: SegmentDefinition = {
  id: "08-v2-4",
  title: "등불의 윤곽",
  goal: "안개 속 위층에 올라가야 해요.",
  description: "등불의 윤곽",
  hints: ["들고 갈 물건은 하나뿐입니다.", "등불이 켜지면 안개 속 계단 모서리가 보여요.", "등불을 켠 뒤 안개 계단을 오르세요."],
  scene: { floors: [{ from: 0, to: 2, y: 0 }, { from: 2, to: 4, y: 1 }, { from: 4, to: 6, y: 2 }, { from: 6, to: 8, y: 3 }, { from: 8, to: 10, y: 4 }], ceiling: true },
  enter: () => quietWorld(8, "08-v2-4", [
    quietEntity("08-v2-4-lantern", "등불", "08-v2-4", 1, 0, { kind: "lantern", lit: true }, { material: "light", reach: 6 }),
    quietEntity("08-v2-4-stairs", "안개 낀 계단", "08-v2-4", 5, 2, { kind: "stairs", illuminated: false, climbable: false, stairs: true }),
    quietEntity("08-v2-4-upper-floor", "위층", "08-v2-4", 9, 4, { kind: "upper-floor", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "observe" && parsed.target === "08-v2-4-stairs" && parsed.instrument === "08-v2-4-lantern") {
      const next = structuredClone(world);
      next.entities["08-v2-4-stairs"].properties.illuminated = true;
      next.entities["08-v2-4-stairs"].properties.climbable = true;
      next.entities["08-v2-4-upper-floor"].properties.accessible = true;
      return done(next, "등불빛이 안개 낀 계단의 모든 모서리를 비췄어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "turn" && parsed.target === "08-v2-4-lantern" && parsed.destination === "08-v2-4-stairs") {
      const next = structuredClone(world);
      next.entities["08-v2-4-stairs"].properties.illuminated = true;
      next.entities["08-v2-4-stairs"].properties.climbable = true;
      next.entities["08-v2-4-upper-floor"].properties.accessible = true;
      return done(next, "등불을 계단 쪽으로 돌리자 안개 속 단차가 드러났어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "climb" && parsed.target === "08-v2-4-stairs") {
      if (world.entities[parsed.target].properties.climbable !== true) return blocked(world, "계단 모서리가 안개에 가려져 있어요.");
      return moveActor(world, "hero", "08-v2-4-upper-floor", "밝아진 계단을 따라 위층에 올랐어요.");
    }
    return clarification(world, "등불을 켜거나 보이는 계단을 오를 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.y === 4,
};

const viewingWindow: SegmentDefinition = {
  id: "08-v2-5",
  title: "문양이 닿는 곳",
  goal: "다리 너머 출구에 닿아야 해요.",
  description: "문양이 닿는 곳",
  hints: ["관측창에는 두 다리의 연결이 한 화면에 잡힙니다.", "관찰 뒤 기억한 연결을 행동 대상으로 다시 쓸 수 있어요.", "관측창을 보고 연결된 다리를 건너 출구로 가세요."],
  scene: { floors: [{ from: 0, to: 2, y: 1 }, { from: 8, to: 10, y: 1 }], ceiling: true },
  enter: () => quietWorld(8, "08-v2-5", [
    quietEntity("08-v2-5-window", "넓은 관측창", "08-v2-5", 1, 3, { kind: "viewing-window", observed: false, connectedTo: "unknown" }, { material: "glass", reach: 4 }),
    quietEntity("08-v2-5-triangle-bridge", "삼각 표식 다리", "08-v2-5", 4, 3, { kind: "bridge", shape: "triangle" }),
    quietEntity("08-v2-5-circle-bridge", "원 표식 다리", "08-v2-5", 4, 0, { kind: "bridge", shape: "round" }),
    quietEntity("08-v2-5-exit", "맞은편 출구", "08-v2-5", 10, 1, { kind: "exit", accessible: false }),
  ], { y: 1 }),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "observe" && parsed.target === "08-v2-5-window") {
      const next = structuredClone(world);
      next.entities[parsed.target].properties.observed = true;
      next.entities[parsed.target].properties.connectedTo = "08-v2-5-triangle-bridge";
      next.entities["08-v2-5-triangle-bridge"].properties.safeToCross = true;
      next.entities["08-v2-5-triangle-bridge"].properties.broken = false;
      next.entities["08-v2-5-circle-bridge"].properties.broken = true;
      next.entities["08-v2-5-exit"].properties.accessible = true;
      rememberOne(next, parsed.target, "connectedTo", "08-v2-5-triangle-bridge");
      return done(next, "창 너머로 삼각 다리가 출구까지 이어지고 원 다리는 중간에서 끊긴 모습이 보였어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "move" && (parsed.target === "08-v2-5-triangle-bridge" || parsed.target === "08-v2-5-circle-bridge")) {
      if (world.entities["08-v2-5-window"].properties.observed !== true) return blocked(world, "두 다리의 끝을 관측창에서 아직 확인하지 않았어요.");
      if (parsed.target !== "08-v2-5-triangle-bridge") return blocked(world, "고른 다리는 출구까지 이어지지 않아요.");
      return moveActor(world, "hero", "08-v2-5-exit", "관측한 삼각 다리를 따라 출구에 닿았어요.");
    }
    return clarification(world, "관측창을 살펴보거나 연결된 다리를 목적지로 지목해 이동할 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.x === 10,
};

const signalBoat: SegmentDefinition = {
  id: "08-v2-6",
  title: "출발 신호",
  goal: "건너편 부두로 가야 해요.",
  description: "출발 신호",
  hints: ["깃발이 내려가면 배가 물길로 나갈 수 있어요.", "배에 탄 뒤 선착장이 닿을 때까지 기다리세요.", "깃발이 내려올 때 배에 타고 선착장에 닿으면 내리세요."],
  scene: { floors: [{ from: 0, to: 2, y: 0 }, { from: 8, to: 10, y: 0 }], ceiling: false },
  enter: () => quietWorld(8, "08-v2-6", [
    quietEntity("08-v2-6-flag", "신호 깃발", "08-v2-6", 1, 3, { kind: "signal-flag", phase: "up", fluttering: true }, { material: "cloth", propertyOptions: { phase: ["up", "down"] } }),
    quietEntity("08-v2-6-boat", "나룻배", "08-v2-6", 1, 0, { kind: "boat", boardable: false, landingReachable: false }, { material: "wood", capacity: 2, reach: 1 }),
    quietEntity("08-v2-6-waterway", "물길", "08-v2-6", 5, 0, { kind: "waterway", flowing: true }, { material: "water" }),
    quietEntity("08-v2-6-dock", "도착 부두", "08-v2-6", 9, 0, { kind: "dock", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "board" && parsed.target === "08-v2-6-boat") {
      if (world.entities["08-v2-6-flag"].properties.phase !== "down") return blocked(world, "출항 신호가 아직 올라가 있어 배가 묶여 있어요.");
      const next = structuredClone(world); next.entities[parsed.target].properties.boardable = true;
      return physical(next, parsed);
    }
    if (parsed.actor === "hero" && parsed.verb === "dismount" && parsed.target === "08-v2-6-boat") {
      if (world.entities[parsed.target].properties.landingReachable !== true || parsed.destination !== "08-v2-6-dock") return blocked(world, "배가 아직 선착장에 닿지 않았어요.");
      return physical(world, parsed);
    }
    return clarification(world, "신호를 기다린 뒤 배에 타고 선착장에서 내릴 수 있어요.");
  },
  advance: (world) => {
    const next = tick(world);
    const flag = next.entities["08-v2-6-flag"];
    flag.properties.phase = next.tick % 4 === 0 ? "up" : "down";
    flag.properties.fluttering = flag.properties.phase === "up";
    if (next.actors.hero.riding === "08-v2-6-boat") {
      const boat = next.entities["08-v2-6-boat"];
      boat.location = { ...next.entities["08-v2-6-dock"].location };
      boat.properties.landingReachable = true;
      next.entities["08-v2-6-dock"].properties.accessible = true;
      next.actors.hero.location = { ...boat.location };
      next.entities.letter.location = { ...boat.location };
    }
    return { world: next, events: [], canChange: true };
  },
  complete: (world) => world.actors.hero.riding === null && world.actors.hero.location.x === 9,
};

const supportedStairs: SegmentDefinition = {
  id: "09-v2-1",
  title: "기울어진 층계",
  goal: "탑의 위층으로 올라가야 해요.",
  description: "기울어진 층계",
  hints: ["계단 아래 빈 자리는 받침 하나가 들어갈 만합니다.", "받침 블록을 계단에 놓으면 기울기가 멎어요.", "받침 블록을 계단에 놓고 계단을 오르세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 3, to: 5, y: 1 }, { from: 5, to: 7, y: 2 }, { from: 7, to: 10, y: 4 }], ceiling: true },
  enter: () => quietWorld(9, "09-v2-1", [
    quietEntity("09-v2-1-support", "받침", "09-v2-1", 1, 0, { kind: "support-block", slot: "small" }, { movable: true, material: "stone", weight: 0.5 }),
    quietEntity("09-v2-1-stairs", "기울어진 계단", "09-v2-1", 5, 2, { kind: "tilted-stairs", supported: false, climbable: false, stairs: true }, { capacity: 2 }),
    quietEntity("09-v2-1-upper-floor", "종탑 위층", "09-v2-1", 9, 4, { kind: "upper-floor", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.verb === "take" && parsed.target === "09-v2-1-support") return physical(world, parsed);
    if (parsed.actor === "hero" && parsed.verb === "place" && parsed.target === "09-v2-1-support" && parsed.destination === "09-v2-1-stairs") {
      const support = world.entities[parsed.target];
      const heldByHero = world.actors.hero.carrying.includes(parsed.target);
      if (!heldByHero && support.parent !== null) return clarification(world, "다른 곳에 놓인 받침을 바로 옮길 수 없어요.");
      if (!heldByHero && Math.hypot(world.actors.hero.location.x - support.location.x, world.actors.hero.location.y - support.location.y) > Math.max(1, support.reach)) {
        return clarification(world, "받침에 손이 닿는 안전한 자리에서 옮겨 주세요.");
      }
      const next = structuredClone(world);
      next.actors.hero.location = { region: next.segmentId, x: 4, y: 1 };
      next.entities.letter.location = { ...next.actors.hero.location };
      next.actors.hero.carrying = next.actors.hero.carrying.filter((id) => id !== parsed.target);
      next.entities[parsed.target].parent = "09-v2-1-stairs";
      next.entities[parsed.target].location = { ...next.entities["09-v2-1-stairs"].location };
      next.entities["09-v2-1-stairs"].properties.supported = true;
      next.entities["09-v2-1-stairs"].properties.climbable = true;
      next.entities["09-v2-1-upper-floor"].properties.accessible = true;
      return done(next, "용사가 받침을 계단 아래까지 옮겨 넣자 기울기가 멎었어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "climb" && parsed.target === "09-v2-1-stairs") {
      if (world.entities[parsed.target].properties.supported !== true) return blocked(world, "계단이 기울어 있어 올라설 수 없어요.");
      return moveActor(world, "hero", "09-v2-1-upper-floor", "받쳐진 계단을 올라 위층에 닿았어요.");
    }
    return clarification(world, "받침을 옮겨 계단을 받치거나 안전해진 계단을 오를 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.y === 4,
};

const bellPendulum: SegmentDefinition = {
  id: "09-v2-2",
  title: "종추의 틈",
  goal: "종추 너머로 가야 해요.",
  description: "종추의 틈",
  hints: ["종추의 현재 위치가 공개되어 있어요.", "멀어진 순간에는 통로가 비어요.", "종추가 멀어질 때까지 기다린 뒤 출구로 건너세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 6, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(9, "09-v2-2", [
    quietEntity("09-v2-2-pendulum", "종추", "09-v2-2", 5, 3, { kind: "bell-pendulum", phase: "near", danger: true }, { propertyOptions: { phase: ["near", "away"] } }),
    quietEntity("09-v2-2-exit", "출구", "09-v2-2", 10, 0, { kind: "exit", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "09-v2-2-exit") {
      if (world.entities["09-v2-2-pendulum"].properties.phase !== "away") return blocked(world, "종추가 통로 가까이 지나고 있어요.");
      return moveActor(world, "hero", parsed.target, "종추가 멀어진 안전창에 출구까지 건넜어요.");
    }
    return clarification(world, "종추의 공개된 왕복 상태를 기다리거나 출구로 이동할 수 있어요.");
  },
  advance: (world) => {
    const advanced = phaseAdvance(world, "09-v2-2-pendulum", ["near", "away", "away", "near"]);
    const away = advanced.world.entities["09-v2-2-pendulum"].properties.phase === "away";
    advanced.world.entities["09-v2-2-pendulum"].properties.danger = !away;
    advanced.world.entities["09-v2-2-exit"].properties.accessible = away;
    return advanced;
  },
  complete: (world) => world.actors.hero.location.x === 10,
};

const windLift: SegmentDefinition = {
  id: "09-v2-3",
  title: "이어진 풍로",
  goal: "다음 층으로 올라가야 해요.",
  description: "이어진 풍로",
  hints: ["풍향기의 바람을 승강기 쪽으로 돌릴 수 있어요.", "동력을 받은 승강기는 위층까지 올라갑니다.", "풍향기를 승강기로 돌리고 탄 뒤 위층에서 내리세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 7, to: 10, y: 4 }], ceiling: true },
  enter: () => quietWorld(9, "09-v2-3", [
    quietEntity("09-v2-3-vane", "바람판", "09-v2-3", 1, 2, { kind: "wind-vane", orientation: 0, controls: "09-v2-3-lift" }, { reach: 2 }),
    quietEntity("09-v2-3-lift", "종탑 승강대", "09-v2-3", 3, 0, { kind: "lift", powered: false, raised: false, boardable: true }, { capacity: 2, reach: 3 }),
    quietEntity("09-v2-3-upper-floor", "위층", "09-v2-3", 9, 4, { kind: "upper-floor", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "turn" && parsed.target === "09-v2-3-vane") {
      if (parsed.destination !== "09-v2-3-lift") return clarification(world, "풍향기의 바람을 보낼 장치를 함께 지목해 주세요.");
      const next = structuredClone(world);
      next.entities[parsed.target].properties.orientation = 1;
      next.entities["09-v2-3-lift"].properties.powered = true;
      return done(next, "풍향기의 바람이 승강기 날개로 향했어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "board" && parsed.target === "09-v2-3-lift") return physical(world, parsed);
    if (parsed.actor === "hero" && parsed.verb === "dismount" && parsed.target === "09-v2-3-lift") {
      if (world.entities[parsed.target].properties.raised !== true || parsed.destination !== "09-v2-3-upper-floor") return blocked(world, "승강기가 아직 위층에 닿지 않았어요.");
      return physical(world, parsed);
    }
    return clarification(world, "풍향기를 승강기로 돌리거나 승강기에 타고 내릴 수 있어요.");
  },
  advance: (world) => {
    const next = tick(world);
    const lift = next.entities["09-v2-3-lift"];
    if (lift.properties.powered === true && next.actors.hero.riding === lift.id) {
      lift.location = { region: next.segmentId, x: 8, y: 4 };
      lift.properties.raised = true;
      next.entities["09-v2-3-upper-floor"].properties.accessible = true;
      next.actors.hero.location = { ...lift.location };
      next.entities.letter.location = { ...lift.location };
    }
    return { world: next, events: [], canChange: lift.properties.powered === true && lift.properties.raised !== true };
  },
  complete: (world) => world.actors.hero.riding === null && world.actors.hero.location.y === 4,
};

const darkStairs: SegmentDefinition = {
  id: "09-v2-4",
  title: "어두운 층계",
  goal: "등불을 가지고 층계를 올라가야 해요.",
  description: "어두운 층계",
  hints: ["계단에는 빛이 닿는지가 보입니다.", "등불을 켜면 계단 전체가 밝혀져요.", "등불을 켠 뒤 어두운 계단을 오르세요."],
  scene: { floors: [{ from: 0, to: 2, y: 0 }, { from: 2, to: 4, y: 1 }, { from: 4, to: 6, y: 2 }, { from: 6, to: 8, y: 3 }, { from: 8, to: 10, y: 4 }], ceiling: true },
  enter: () => quietWorld(9, "09-v2-4", [
    quietEntity("09-v2-4-lantern", "등불", "09-v2-4", 1, 0, { kind: "lantern", lit: true, slot: "small" }, { material: "light", movable: true, weight: 0.2, reach: 2 }),
    quietEntity("09-v2-4-stairs", "어두운 계단", "09-v2-4", 5, 2, { kind: "dark-stairs", illuminated: false, climbable: false, stairs: true }),
    quietEntity("09-v2-4-exit", "출구", "09-v2-4", 10, 4, { kind: "exit", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "take" && parsed.target === "09-v2-4-lantern") return physical(world, parsed);
    if (parsed.actor === "hero" && (parsed.verb === "climb" || parsed.verb === "move") && parsed.target === "09-v2-4-stairs") {
      if (!world.actors.hero.carrying.includes("09-v2-4-lantern")) return blocked(world, "등불이 용사와 함께 있지 않아 다음 단차가 보이지 않아요.");
      const moved = moveActor(world, "hero", "09-v2-4-exit", "등불을 들고 계단 위 출구에 닿았어요.");
      moved.world.entities["09-v2-4-stairs"].properties.illuminated = true; moved.world.entities["09-v2-4-stairs"].properties.climbable = true;
      moved.world.entities["09-v2-4-exit"].properties.accessible = true;
      return moved;
    }
    return clarification(world, "등불을 켜거나 밝혀진 계단을 오를 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.x === 10,
};

const sharedBridge: SegmentDefinition = {
  id: "09-v2-5",
  title: "서로 기다리는 층",
  goal: "등지기와 건너편에서 만나야 해요.",
  description: "서로 기다리는 층",
  hints: ["손잡이를 놓기 전까지 다리가 펼쳐져요.", "용사가 건너편에 닿으면 다리가 눈에 보이게 고정됩니다.", "등지기가 손잡이를 유지하는 동안 용사가 건너고, 고정 뒤 등지기도 합류하세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 7, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(9, "09-v2-5", [
    quietEntity("09-v2-5-handle", "유지 손잡이", "09-v2-5", 1, 1, { kind: "hold-handle", held: false, heldBy: "", holdable: true, actuator: true }, { reach: 2 }),
    quietEntity("09-v2-5-bridge", "연결 다리", "09-v2-5", 5, 0, { kind: "bridge", extended: false, latched: false, safeToCross: false }),
    quietEntity("09-v2-5-meeting", "합류 자리", "09-v2-5", 9, 0, { kind: "meeting-place", rail: true, heroArrived: false, keeperArrived: false }),
  ], {}, { x: 0, y: 0 }),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "keeper" && parsed.verb === "hold" && parsed.target === "09-v2-5-handle") {
      const next = structuredClone(world);
      next.actors.keeper.holding = parsed.target;
      next.entities[parsed.target].properties.held = true; next.entities[parsed.target].properties.heldBy = "keeper";
      next.entities["09-v2-5-bridge"].properties.extended = true; next.entities["09-v2-5-bridge"].properties.safeToCross = true;
      return done(next, "등지기가 손잡이를 잡아 다리를 펼쳐 유지해요.");
    }
    if (parsed.actor === "keeper" && parsed.verb === "release" && parsed.target === "09-v2-5-handle") {
      const next = structuredClone(world); next.actors.keeper.holding = null;
      next.entities[parsed.target].properties.held = false; next.entities[parsed.target].properties.heldBy = "";
      if (next.entities["09-v2-5-bridge"].properties.latched !== true) {
        next.entities["09-v2-5-bridge"].properties.extended = false; next.entities["09-v2-5-bridge"].properties.safeToCross = false;
      }
      return done(next, "등지기가 손잡이를 놓았어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "09-v2-5-bridge") {
      if (world.entities[parsed.target].properties.safeToCross !== true) return blocked(world, "다리가 아직 펼쳐져 있지 않아요.");
      return moveActor(world, "hero", parsed.target, "용사가 펼쳐진 다리 위로 건너기 시작했어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "09-v2-5-meeting") {
      if (world.actors.hero.location.x !== 5 || world.entities["09-v2-5-bridge"].properties.extended !== true) return blocked(world, "용사는 먼저 펼쳐진 다리를 건너야 해요.");
      const moved = moveActor(world, "hero", parsed.target, "용사가 만남터에 닿자 다리 걸쇠가 맞물렸어요.");
      moved.world.entities["09-v2-5-bridge"].properties.latched = true; moved.world.entities["09-v2-5-bridge"].properties.extended = true;
      moved.world.entities["09-v2-5-meeting"].properties.heroArrived = true;
      return moved;
    }
    if (parsed.actor === "keeper" && parsed.verb === "move" && parsed.target === "09-v2-5-meeting") {
      if (world.entities["09-v2-5-bridge"].properties.latched !== true) return blocked(world, "용사가 만남터에 닿아 다리를 고정할 때까지 등지기는 건널 수 없어요.");
      const moved = moveActor(world, "keeper", parsed.target, "고정된 다리를 따라 등지기도 만남터에 합류했어요.");
      moved.world.entities["09-v2-5-meeting"].properties.keeperArrived = true;
      return moved;
    }
    return clarification(world, "등지기가 손잡이를 유지하고 용사와 등지기의 이동을 각각 적어 주세요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.entities["09-v2-5-meeting"].properties.heroArrived === true && world.entities["09-v2-5-meeting"].properties.keeperArrived === true,
};

const observedBellDoor: SegmentDefinition = {
  id: "09-v2-6",
  title: "종 위의 문",
  goal: "함께 종 너머의 문에 닿아야 해요.",
  description: "종 위의 문",
  hints: ["관측창을 보면 종이 문에서 멀어지는 순간이 드러납니다.", "종이 멀어진 같은 순간에 둘 다 문을 지나야 해요.", "관측창을 보고 종이 멀어질 때까지 기다린 뒤 둘 다 문으로 가세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 5, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(9, "09-v2-6", [
    quietEntity("09-v2-6-window", "관측창", "09-v2-6", 1, 2, { kind: "viewing-window", observed: false }, { material: "glass", reach: 3 }),
    quietEntity("09-v2-6-bell", "움직이는 종", "09-v2-6", 5, 3, { kind: "moving-bell", visibleState: "unknown" }, { propertyOptions: { phase: ["near", "away"] } }),
    quietEntity("09-v2-6-door", "문", "09-v2-6", 9, 0, { kind: "door", open: false, rail: true, heroArrived: false, keeperArrived: false }),
  ], {}, { x: 0, y: 0 }),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "observe" && parsed.target === "09-v2-6-window") {
      const next = structuredClone(world); next.entities[parsed.target].properties.observed = true;
      next.entities["09-v2-6-bell"].properties.phase = next.tick % 4 < 2 ? "near" : "away";
      next.entities["09-v2-6-bell"].properties.visibleState = next.entities["09-v2-6-bell"].properties.phase;
      return done(next, "창 너머로 종의 왕복과 문이 비는 순간이 함께 보였어요.");
    }
    if ((parsed.actor === "hero" || parsed.actor === "keeper") && parsed.verb === "move" && parsed.target === "09-v2-6-door") {
      if (world.entities["09-v2-6-window"].properties.observed !== true || world.entities["09-v2-6-bell"].properties.phase !== "away") return blocked(world, "관측한 종이 아직 문에서 충분히 멀어지지 않았어요.");
      const moved = moveActor(world, parsed.actor, parsed.target, `${parsed.actor === "hero" ? "용사" : "등지기"}가 빈 종문을 건넜어요.`);
      moved.world.entities[parsed.target].properties.open = true;
      moved.world.entities[parsed.target].properties[parsed.actor === "hero" ? "heroArrived" : "keeperArrived"] = true;
      return moved;
    }
    return clarification(world, "관측창을 살핀 뒤 용사와 등지기의 이동을 각각 적어 주세요.");
  },
  advance: (world) => {
    const next = tick(world);
    if (next.entities["09-v2-6-window"].properties.observed === true) {
      const phase = next.tick % 4 < 2 ? "near" : "away";
      next.entities["09-v2-6-bell"].properties.phase = phase; next.entities["09-v2-6-bell"].properties.visibleState = phase;
    }
    return { world: next, events: [], canChange: true };
  },
  complete: (world) => world.entities["09-v2-6-door"].properties.heroArrived === true && world.entities["09-v2-6-door"].properties.keeperArrived === true,
};

const foldingArm: SegmentDefinition = {
  id: "10-v2-1",
  title: "팔이 비킨 자리",
  goal: "팔 너머 안전한 자리로 가야 해요.",
  description: "팔이 비킨 자리",
  hints: ["팔은 펼침과 접힘을 되풀이합니다.", "접힌 순간에는 중앙이 비어요.", "팔이 접힐 때까지 기다린 뒤 안전한 자리로 건너세요."],
  scene: { floors: [{ from: 0, to: 2, y: 0 }, { from: 4, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(10, "10-v2-1", [
    quietEntity("10-v2-1-arm", "문지기의 기계 팔", "10-v2-1", 5, 2, { kind: "warden-arm", phase: "extended", danger: true }, { propertyOptions: { phase: ["extended", "folded"] } }),
    quietEntity("10-v2-1-safe-spot", "팔 너머 안전한 자리", "10-v2-1", 9, 0, { kind: "safe-spot", safe: true }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "10-v2-1-safe-spot") {
      if (world.entities["10-v2-1-arm"].properties.phase !== "folded") return blocked(world, "기계 팔이 통로에 펼쳐져 있어요.");
      return moveActor(world, "hero", parsed.target, "팔이 접힌 틈에 안전한 자리로 건넜어요.");
    }
    return clarification(world, "팔의 공개된 자세를 기다리거나 안전한 자리로 이동할 수 있어요.");
  },
  advance: (world) => {
    const advanced = phaseAdvance(world, "10-v2-1-arm", ["extended", "folded", "folded", "extended"]);
    advanced.world.entities["10-v2-1-arm"].properties.danger = advanced.world.entities["10-v2-1-arm"].properties.phase === "extended";
    return advanced;
  },
  complete: (world) => world.actors.hero.location.x === 9,
};

const armorWalkway: SegmentDefinition = {
  id: "10-v2-2",
  title: "첫 갑옷",
  goal: "첫 갑옷 너머로 가야 해요.",
  description: "첫 갑옷",
  hints: ["걸쇠가 판을 세워 두고 있습니다.", "걸쇠를 풀면 판이 틈 위로 내려와요.", "갑옷 걸쇠를 풀고 내려온 판을 건너세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 7, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(10, "10-v2-2", [
    quietEntity("10-v2-2-latch", "갑옷 걸쇠", "10-v2-2", 1, 1, { kind: "armor-latch", locked: true, actuator: true, strokes: 0 }, { reach: 2 }),
    quietEntity("10-v2-2-plate", "갑옷판", "10-v2-2", 5, 2, { kind: "armor-plate", bridged: false, safeToCross: false, climbable: false }, { material: "metal", capacity: 2 }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && (parsed.verb === "pull" || parsed.verb === "untie") && parsed.target === "10-v2-2-latch") {
      const next = structuredClone(world); next.entities[parsed.target].properties.locked = false; next.entities[parsed.target].properties.strokes = 1;
      next.entities["10-v2-2-plate"].properties.bridged = true; next.entities["10-v2-2-plate"].properties.safeToCross = true; next.entities["10-v2-2-plate"].properties.climbable = true;
      next.entities["10-v2-2-plate"].location.y = 0;
      return done(next, "걸쇠가 풀리며 갑옷판이 틈 위의 넓은 길로 내려왔어요.");
    }
    if (parsed.actor === "hero" && (parsed.verb === "climb" || parsed.verb === "move") && parsed.target === "10-v2-2-plate") {
      if (world.entities[parsed.target].properties.bridged !== true) return blocked(world, "갑옷판이 아직 세워져 있어 건널 길이 없어요.");
      const moved = moveActor(world, "hero", parsed.target, "갑옷판 길을 건너 첫 봉인 안쪽에 닿았어요.");
      moved.world.actors.hero.location.x = 9; moved.world.entities.letter.location.x = 9;
      return moved;
    }
    return clarification(world, "갑옷 걸쇠를 풀거나 내려온 판을 건널 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.x === 9,
};

const cooledArmor: SegmentDefinition = {
  id: "10-v2-3",
  title: "뜨거운 틈",
  goal: "갑옷 안쪽으로 들어가야 해요.",
  description: "뜨거운 틈",
  hints: ["냉각 날개의 바람은 갑옷길 전체에 닿습니다.", "식힘 완료 상태가 보인 뒤 건너세요.", "냉각 날개를 돌리고 갑옷길이 식으면 안쪽으로 가세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 4, to: 8, y: 1 }, { from: 8, to: 10, y: 2 }], ceiling: true },
  enter: () => quietWorld(10, "10-v2-3", [
    quietEntity("10-v2-3-vane", "냉각 바람판", "10-v2-3", 1, 2, { kind: "cooling-vane", on: false, controls: "10-v2-3-path" }, { reach: 2 }),
    quietEntity("10-v2-3-path", "뜨거운 갑옷길", "10-v2-3", 6, 1, { kind: "hot-armor-path", heatState: "hot", cooled: false, safeToCross: false }),
    quietEntity("10-v2-3-inside", "갑옷 안쪽", "10-v2-3", 10, 2, { kind: "inside", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "turn" && parsed.target === "10-v2-3-vane") {
      const next = structuredClone(world); next.entities[parsed.target].properties.on = true;
      return done(next, "냉각 날개가 돌아 갑옷길 위로 찬 바람을 보냈어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "move" && parsed.target === "10-v2-3-inside") {
      if (world.entities["10-v2-3-path"].properties.cooled !== true) return blocked(world, "갑옷길의 열기가 아직 남아 있어요.");
      return moveActor(world, "hero", parsed.target, "식은 갑옷길을 지나 안쪽에 닿았어요.");
    }
    return clarification(world, "냉각 날개를 돌리거나 식은 갑옷길 안쪽으로 이동할 수 있어요.");
  },
  advance: (world) => {
    const next = tick(world);
    if (next.entities["10-v2-3-vane"].properties.on === true) {
      next.entities["10-v2-3-path"].properties.heatState = "cold"; next.entities["10-v2-3-path"].properties.cooled = true; next.entities["10-v2-3-path"].properties.safeToCross = true;
      next.entities["10-v2-3-inside"].properties.accessible = true;
    }
    return { world: next, events: [], canChange: false };
  },
  complete: (world) => world.actors.hero.location.x === 10,
};

const foldedWing: SegmentDefinition = {
  id: "10-v2-4",
  title: "접힌 날개",
  goal: "문지기의 가슴 앞에 닿아야 해요.",
  description: "접힌 날개",
  hints: ["바람을 보내면 큰 날개가 벽 쪽으로 접힙니다.", "접힌 날개는 위쪽으로 이어지는 넓은 발판이 돼요.", "송풍 날개를 큰 날개로 돌리고 접힌 날개를 오르세요."],
  scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 7, to: 10, y: 4 }], ceiling: true },
  enter: () => quietWorld(10, "10-v2-4", [
    quietEntity("10-v2-4-vane", "바람판", "10-v2-4", 1, 2, { kind: "wind-vane", on: false, controls: "10-v2-4-wing" }, { reach: 2 }),
    quietEntity("10-v2-4-wing", "날개", "10-v2-4", 5, 3, { kind: "wing", form: "extended", climbable: false }),
    quietEntity("10-v2-4-chest", "가슴 앞", "10-v2-4", 9, 4, { kind: "seal-chest", accessible: false }),
  ]),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "hero" && parsed.verb === "turn" && parsed.target === "10-v2-4-vane") {
      if (parsed.destination !== "10-v2-4-wing") return clarification(world, "바람을 보낼 큰 날개를 함께 지목해 주세요.");
      const next = structuredClone(world); next.entities[parsed.target].properties.on = true;
      next.entities["10-v2-4-wing"].properties.form = "folded"; next.entities["10-v2-4-wing"].properties.climbable = true;
      next.entities["10-v2-4-chest"].properties.accessible = true;
      return done(next, "바람을 받은 철제 날개가 벽에 접혀 위쪽 발판이 되었어요.");
    }
    if (parsed.actor === "hero" && parsed.verb === "climb" && parsed.target === "10-v2-4-wing") {
      if (world.entities[parsed.target].properties.form !== "folded") return blocked(world, "날개가 펼쳐져 있어 오를 수 없어요.");
      return moveActor(world, "hero", "10-v2-4-chest", "접힌 날개를 올라 둘째 봉인의 상자에 닿았어요.");
    }
    return clarification(world, "송풍 날개를 큰 날개로 돌리거나 접힌 날개를 오를 수 있어요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.actors.hero.location.y === 4,
};

const finalLatch: SegmentDefinition = {
  id: "10-v2-5",
  title: "마지막 매듭",
  goal: "마지막 걸쇠를 풀어 문지기를 자유롭게 해 줘요.",
  description: "마지막 매듭",
  hints: ["유지 고리와 마지막 걸쇠는 서로 떨어진 두 자리에 있습니다.", "등지기는 고리를 유지하고 용사는 걸쇠를 풀 수 있어요.", "등지기가 고리를 유지하는 동안 용사가 마지막 걸쇠를 푸세요."],
  scene: { floors: [{ from: 0, to: 10, y: 0 }], ceiling: true },
  enter: () => quietWorld(10, "10-v2-5", [
    quietEntity("10-v2-5-ring", "유지 고리", "10-v2-5", 1, 0, { kind: "holding-ring", held: false, heldBy: "", holdable: true }, { reach: 2 }),
    quietEntity("10-v2-5-latch", "마지막 걸쇠", "10-v2-5", 6, 1, { kind: "final-latch", open: false, actuator: true, strokes: 0 }, { reach: 2 }),
  ], { x: 5 }, { x: 0, y: 0 }),
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.actor === "keeper" && parsed.verb === "hold" && parsed.target === "10-v2-5-ring") {
      const next = structuredClone(world); next.actors.keeper.holding = parsed.target;
      next.entities[parsed.target].properties.held = true; next.entities[parsed.target].properties.heldBy = "keeper";
      return done(next, "등지기가 봉인 고리를 잡아 유지해요.");
    }
    if (parsed.actor === "keeper" && parsed.verb === "release" && parsed.target === "10-v2-5-ring") {
      const next = structuredClone(world); next.actors.keeper.holding = null;
      next.entities[parsed.target].properties.held = false; next.entities[parsed.target].properties.heldBy = "";
      return done(next, "등지기가 열린 봉인의 고리를 놓았어요.");
    }
    if (parsed.actor === "hero" && (parsed.verb === "pull" || parsed.verb === "untie") && parsed.target === "10-v2-5-latch") {
      if (world.entities["10-v2-5-ring"].properties.held !== true || world.entities["10-v2-5-ring"].properties.heldBy !== "keeper") return blocked(world, "봉인 유지 고리를 등지기가 잡고 있어야 걸쇠가 움직여요.");
      const next = structuredClone(world); next.entities[parsed.target].properties.open = true; next.entities[parsed.target].properties.strokes = 1;
      return done(next, "마지막 걸쇠가 풀리며 셋째 봉인이 열렸어요.");
    }
    return clarification(world, "등지기와 용사에게 서로 떨어진 두 역할을 맡겨 주세요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.entities["10-v2-5-latch"].properties.open === true && world.entities["10-v2-5-ring"].properties.heldBy === "keeper",
};

const finalDoor: SegmentDefinition = {
  id: "10-v2-6",
  title: "돌아가는 문",
  goal: "등지기와 함께 마지막 문을 지나야 해요.",
  description: "돌아가는 문",
  hints: ["편지는 용사가 몸에 매고 있습니다.", "문을 연 뒤 용사와 등지기의 이동을 모두 적어 주세요.", "용사가 문을 열고 둘 다 문 너머로 가세요."],
  scene: { floors: [{ from: 0, to: 10, y: 0 }], ceiling: true },
  enter: () => {
    const world = quietWorld(10, "10-v2-6", [
      quietEntity("10-v2-6-door", "마지막 문", "10-v2-6", 4, 0, { kind: "final-door", open: false, accepts: "letter" }, { reach: 1 }),
      quietEntity("10-v2-6-beyond", "문 너머 자리", "10-v2-6", 9, 0, { kind: "beyond-place", rail: true, heroArrived: false, keeperArrived: false }),
    ], {}, { x: 0, y: 0 });
    world.entities.letter.properties.recipient = "hero";
    return world;
  },
  execute: (world, raw) => {
    const parsed = resolve(world, raw); if (isActionResult(parsed)) return parsed;
    if (parsed.verb === "open" && parsed.target === "10-v2-6-door") {
      if (parsed.actor !== "hero" || world.entities.letter.parent !== "hero") return clarification(world, "몸에 편지를 맨 용사가 이 문을 열어야 해요.");
      const next = structuredClone(world);
      next.actors.hero.location = { ...next.entities[parsed.target].location };
      next.entities.letter.location = { ...next.actors.hero.location };
      next.entities[parsed.target].properties.open = true;
      return done(next, "편지를 댄 문이 조용히 열렸어요.");
    }
    if ((parsed.actor === "hero" || parsed.actor === "keeper") && parsed.verb === "move" && parsed.target === "10-v2-6-beyond") {
      if (world.entities["10-v2-6-door"].properties.open !== true) return blocked(world, "마지막 문이 아직 닫혀 있어요.");
      const moved = moveActor(world, parsed.actor, parsed.target, `${parsed.actor === "hero" ? "용사" : "등지기"}가 문 너머에 닿았어요.`);
      moved.world.entities[parsed.target].properties[parsed.actor === "hero" ? "heroArrived" : "keeperArrived"] = true;
      return moved;
    }
    return clarification(world, "용사가 문을 열고 용사와 등지기의 이동을 각각 적어 주세요.");
  },
  advance: (world) => ({ world: tick(world), events: [], canChange: false }),
  complete: (world) => world.entities["10-v2-6-door"].properties.open === true && world.entities["10-v2-6-beyond"].properties.heroArrived === true && world.entities["10-v2-6-beyond"].properties.keeperArrived === true && world.entities.letter.parent === "hero",
};

const fogSegments = [fogBridge, forkedBridges, windFlag, fogStairs, viewingWindow, signalBoat] as const;
const towerSegments = [supportedStairs, bellPendulum, windLift, darkStairs, sharedBridge, observedBellDoor] as const;
const wardenSegments = [foldingArm, armorWalkway, cooledArmor, foldedWing, finalLatch, finalDoor] as const;

export const QUIET_LATE_REPRESENTATIVE_PROGRAMS: Readonly<Record<string, InstructionProgram>> = {
  "08-v2-1": program("08-v2-1", "안개를 살펴보고 드러난 돌다리를 건너 출구로 가.", seq(act("hero", "observe", "08-v2-1-mist"), act("hero", "move", "08-v2-1-exit"))),
  "08-v2-2": program("08-v2-2", "두 다리를 살펴보고 이어진 쪽으로 가.", seq(act("hero", "observe", "08-v2-2-right-bridge"), act("hero", "move", "08-v2-2-right-bridge"))),
  "08-v2-3": program("08-v2-3", "깃발이 내려올 때까지 기다렸다가 출구로 건너.", seq(wait("08-v2-3-flag", "phase", "down"), act("hero", "move", "08-v2-3-exit"))),
  "08-v2-4": program("08-v2-4", "등불로 계단을 비추고 올라가.", seq(act("hero", "observe", "08-v2-4-stairs", { instrument: "08-v2-4-lantern" }), act("hero", "climb", "08-v2-4-stairs"))),
  "08-v2-5": program("08-v2-5", "창으로 보고 이어진 다리로 가.", seq(act("hero", "observe", "08-v2-5-window"), act("hero", "move", "08-v2-5-triangle-bridge", { references: { target: { entity: "08-v2-5-window", property: "connectedTo", source: "remembered" } } }))),
  "08-v2-6": program("08-v2-6", "깃발이 내려오면 배에 타고 선착장에 닿은 뒤 내려.", seq(wait("08-v2-6-flag", "phase", "down"), act("hero", "board", "08-v2-6-boat"), wait("08-v2-6-boat", "landingReachable", true), act("hero", "dismount", "08-v2-6-boat", { destination: "08-v2-6-dock" }))),
  "09-v2-1": program("09-v2-1", "받침 블록을 계단에 놓고 계단을 올라.", seq(act("hero", "take", "09-v2-1-support"), act("hero", "place", "09-v2-1-support", { destination: "09-v2-1-stairs" }), act("hero", "climb", "09-v2-1-stairs"))),
  "09-v2-2": program("09-v2-2", "종추가 멀어질 때까지 기다렸다가 출구로 건너.", seq(wait("09-v2-2-pendulum", "phase", "away"), act("hero", "move", "09-v2-2-exit"))),
  "09-v2-3": program("09-v2-3", "풍향기를 승강기로 돌리고 타서 위층에서 내려.", seq(act("hero", "turn", "09-v2-3-vane", { destination: "09-v2-3-lift" }), act("hero", "board", "09-v2-3-lift"), wait("09-v2-3-lift", "raised", true), act("hero", "dismount", "09-v2-3-lift", { destination: "09-v2-3-upper-floor" }))),
  "09-v2-4": program("09-v2-4", "등불을 챙겨 계단으로 가.", seq(act("hero", "take", "09-v2-4-lantern"), act("hero", "climb", "09-v2-4-stairs"))),
  "09-v2-5": program("09-v2-5", "등지기는 손잡이를 잡고, 나는 건넌 뒤 함께 가.", seq(par({ kind: "until", body: act("keeper", "hold", "09-v2-5-handle"), condition: predicate("09-v2-5-bridge", "latched", true) }, seq(act("hero", "move", "09-v2-5-bridge"), act("hero", "move", "09-v2-5-meeting"))), act("keeper", "move", "09-v2-5-meeting"))),
  "09-v2-6": program("09-v2-6", "관측창을 보고 종이 멀어질 때까지 기다린 뒤 둘 다 문을 건너.", seq(act("hero", "observe", "09-v2-6-window"), wait("09-v2-6-bell", "phase", "away"), par(act("hero", "move", "09-v2-6-door"), act("keeper", "move", "09-v2-6-door")))),
  "10-v2-1": program("10-v2-1", "문지기 팔이 접힐 때까지 기다렸다가 안전한 자리로 건너.", seq(wait("10-v2-1-arm", "phase", "folded"), act("hero", "move", "10-v2-1-safe-spot"))),
  "10-v2-2": program("10-v2-2", "갑옷 걸쇠를 풀고 내려온 갑옷판을 건너.", seq(act("hero", "pull", "10-v2-2-latch"), act("hero", "climb", "10-v2-2-plate"))),
  "10-v2-3": program("10-v2-3", "냉각 날개를 돌리고 갑옷길이 식으면 안쪽으로 가.", seq(act("hero", "turn", "10-v2-3-vane"), wait("10-v2-3-path", "cooled", true), act("hero", "move", "10-v2-3-inside"))),
  "10-v2-4": program("10-v2-4", "송풍 날개를 큰 철제 날개로 돌리고 접힌 날개를 올라.", seq(act("hero", "turn", "10-v2-4-vane", { destination: "10-v2-4-wing" }), act("hero", "climb", "10-v2-4-wing"))),
  "10-v2-5": program("10-v2-5", "등지기는 고리를 잡고 나는 걸쇠를 풀어.", par(act("keeper", "hold", "10-v2-5-ring"), act("hero", "pull", "10-v2-5-latch"))),
  "10-v2-6": program("10-v2-6", "용사가 마지막 문을 열고 둘 다 문 너머로 가.", seq(act("hero", "open", "10-v2-6-door"), par(act("hero", "move", "10-v2-6-beyond"), act("keeper", "move", "10-v2-6-beyond")))),
};

export const QUIET_LATE_REPRESENTATIVE_COMMANDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(QUIET_LATE_REPRESENTATIVE_PROGRAMS).map(([id, instruction]) => [id, instruction.text]),
);

export const QUIET_FOG_STAGE: CampaignStageDefinition = {
  id: 8,
  title: "안개 신호장",
  contentRevision: "quiet-v1",
  practice: fogBridge,
  segments: fogSegments,
  story: { afterSegment: "08-v2-6", object: "08-v2-6-flag", text: "먼저 보고 말해 주던 네가 있었지." },
};

export const QUIET_TOWER_STAGE: CampaignStageDefinition = {
  id: 9,
  title: "종탑의 안쪽",
  contentRevision: "quiet-v1",
  practice: supportedStairs,
  segments: towerSegments,
  story: { afterSegment: "09-v2-6", object: "09-v2-6-bell", text: "큰 종의 잔향 사이로 지나온 탑의 모든 방이 하나의 기계였다는 윤곽이 남았다." },
};

export const QUIET_WARDEN_STAGE: CampaignStageDefinition = {
  id: 10,
  title: "돌아오지 못한 문지기",
  contentRevision: "quiet-v1",
  practice: foldingArm,
  segments: wardenSegments,
  story: { afterSegment: "10-v2-6", object: "letter", text: "여기까지는 내가 길을 적었어. 다음 길은 네가 골라 줘. 이제는 같이 가자." },
};
