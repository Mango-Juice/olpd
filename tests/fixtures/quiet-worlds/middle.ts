import { executePhysicalAction } from "../../../src/campaign/physics";
import type { ActionResult } from "../../../src/campaign/program";
import type { CampaignStageDefinition, SegmentDefinition } from "../../../src/campaign/level";
import type { Entity, PhysicalAction, WorldState } from "../../../src/campaign/types";
import {
  atEntity,
  crossesX,
  descriptionsAreNames,
  moveQuietActor,
  movementVerb,
  placeQuietItem,
  quietAdvance,
  quietBlocked,
  quietClarification,
  quietEntity,
  quietFailure,
  quietResult,
  quietWorld,
  releaseQuietHold,
  resolvedAction,
  takeQuietItem,
} from "./middle-helpers";
import { authoredDefaultWalk } from "./default-walk";

const hints = ["눈앞의 사물과 길이 전부다.", "움직인 몸과 물건은 그 자리에 남는다.", "보이는 상태가 다음 행동을 결정한다."] as const;

function segment(
  definition: Omit<SegmentDefinition, "description" | "hints" | "advance"> & { entities: () => Entity[] },
): SegmentDefinition {
  const { entities, ...segmentDefinition } = definition;
  const names = entities();
  return {
    ...segmentDefinition,
    description: descriptionsAreNames(names),
    hints,
    idleAction: authoredDefaultWalk,
    advance: quietAdvance,
  };
}

function resolved(world: WorldState, action: PhysicalAction): PhysicalAction | ActionResult {
  return resolvedAction(world, action);
}

function isResult(value: PhysicalAction | ActionResult): value is ActionResult {
  return "world" in value;
}

function setGravity(world: WorldState, gravity: "up" | "down"): void {
  const actor = world.actors.hero;
  actor.capabilities = [...actor.capabilities.filter((item) => !item.startsWith("gravity:")), `gravity:${gravity}`];
}

function gardenEntities(id: string): Entity[] {
  switch (id) {
    case "05-v2-1": return [
      quietEntity(`${id}-path`, "거꾸로 난 길", id, 4, 4, { kind: "safe-platform", safe: true, gravity: "up" }, { material: "stone" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 4, { kind: "exit", safe: true }, { material: "stone" }),
    ];
    case "05-v2-2": return [
      quietEntity(`${id}-thorns`, "가시덤불", id, 5, 4, { kind: "hazard", fixedSpike: true, danger: true }, { material: "wood" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 4, { kind: "exit", safe: true }, { material: "stone" }),
    ];
    case "05-v2-3": return [
      quietEntity(`${id}-vine`, "덩굴", id, 5, 1, { kind: "low-vine", clearance: "low", blocksPath: true }, { material: "wood" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 0, { kind: "exit", safe: true }, { material: "stone" }),
    ];
    case "05-v2-4": return [
      quietEntity(`${id}-closed`, "닫힌 꽃", id, 3, 0, { kind: "closed-flower", safe: true }, { material: "wood" }),
      quietEntity(`${id}-thorn`, "가시꽃", id, 6, 0, { kind: "hazard", fixedSpike: true, danger: true }, { material: "wood" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 0, { kind: "exit", safe: true }, { material: "stone" }),
    ];
    case "05-v2-5": return [
      quietEntity(`${id}-arch`, "뒤집힘 아치", id, 3, 0, { kind: "gravity-boundary", gravity: "up", actorOnly: true, active: false }, { material: "stone" }),
      quietEntity(`${id}-thorns`, "가시", id, 6, 4, { kind: "hazard", fixedSpike: true, danger: true }, { material: "wood" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 4, { kind: "exit", safe: true }, { material: "stone" }),
    ];
    default: return [
      quietEntity(`${id}-vine`, "낮은 덩굴", id, 3, 1, { kind: "low-vine", clearance: "low", blocksPath: true }, { material: "wood" }),
      quietEntity(`${id}-thorns`, "가시", id, 6, 0, { kind: "hazard", fixedSpike: true, danger: true }, { material: "wood" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 0, { kind: "exit", safe: true }, { material: "stone" }),
    ];
  }
}

function gardenWorld(id: string): WorldState {
  const ceiling = id === "05-v2-1" || id === "05-v2-2";
  const state = quietWorld(5, id, gardenEntities(id), {
    hero: { location: { region: id, x: 0, y: ceiling ? 4 : 0 }, capabilities: ["weight:1", `gravity:${ceiling ? "up" : "down"}`] },
  });
  return state;
}

function gardenMove(world: WorldState, raw: PhysicalAction): ActionResult {
  const value = resolved(world, raw);
  if (isResult(value)) return value;
  const action = value;
  if (action.actor !== "hero") return quietClarification(world, "이 정원에는 용사만 있어요.");
  if (!movementVerb(action.verb)) return executePhysicalAction(world, action);
  const requestedTarget = world.entities[action.target];
  if (!requestedTarget) return quietClarification(world, "움직일 곳을 찾을 수 없어요.");
  const id = world.segmentId;
  const target = action.verb === "jump" && requestedTarget.properties.fixedSpike === true
    ? world.entities[`${id}-exit`]
    : requestedTarget;
  const from = world.actors.hero.location.x;
  const to = target.location.x;

  if (id === "05-v2-1") {
    if (action.verb !== "move") return quietFailure(world, "천장길에서 몸을 띄우자 천장 바닥을 놓쳤어요.");
  } else if (id === "05-v2-2") {
    if (crossesX(from, to, 5) && action.verb !== "jump") return quietFailure(world, "천장 가시에 닿았어요.");
  } else if (id === "05-v2-3") {
    if (crossesX(from, to, 5) && action.verb !== "move" && action.verb !== "duck") return quietFailure(world, "낮은 덩굴에 뛰어들어 얽혔어요.");
  } else if (id === "05-v2-4") {
    if (action.target === `${id}-closed` && action.verb !== "move" && action.verb !== "duck") {
      return quietFailure(world, "오므린 꽃 위로 뛰어 길을 잃었어요.");
    }
    if (crossesX(from, to, 6) && action.verb !== "jump") return quietFailure(world, "가시꽃에 닿았어요.");
    if (action.verb === "jump" && from < 3) return quietFailure(world, "오므린 꽃까지 한꺼번에 뛰어넘으려다 가시꽃에 닿았어요.");
  } else if (id === "05-v2-5") {
    if (crossesX(from, to, 3) && from < 3 && action.target !== `${id}-arch`) {
      return quietBlocked(world, "아치의 경계를 먼저 지나야 길의 방향이 바뀌어요.");
    }
    if (action.target === `${id}-arch`) {
      if (action.verb !== "move") return quietFailure(world, "아치 경계에서 뛰어 방향을 놓쳤어요.");
      const next = structuredClone(world);
      moveQuietActor(next, "hero", { region: id, x: 3, y: 4 });
      setGravity(next, "up");
      next.entities[`${id}-arch`].properties.active = true;
      return quietResult(next, "done", "아치를 지나 용사의 중력이 위로 뒤집혔어요.");
    }
    if (crossesX(from, to, 6) && action.verb !== "jump") return quietFailure(world, "뒤집힌 천장 가시에 닿았어요.");
    if (crossesX(from, to, 6) && !world.actors.hero.capabilities.includes("gravity:up")) {
      return quietBlocked(world, "아치 바깥에서는 천장길로 갈 수 없어요.");
    }
  } else {
    if (crossesX(from, to, 3) && from < 3 && action.target !== `${id}-vine`) {
      return quietBlocked(world, "낮은 덩굴 아래를 먼저 지나야 해요.");
    }
    if (action.target === `${id}-vine` && action.verb !== "move" && action.verb !== "duck") {
      return quietFailure(world, "낮은 덩굴에 뛰어들어 얽혔어요.");
    }
    if (crossesX(from, to, 6) && action.verb !== "jump") return quietFailure(world, "길 위 가시에 닿았어요.");
  }

  const next = structuredClone(world);
  moveQuietActor(next, "hero", target.location);
  return quietResult(next, "done", `${target.name}까지 안전하게 움직였어요.`);
}

const gardenDefinitions: SegmentDefinition[] = [
  segment({ id: "05-v2-1", title: "천장의 산책", goal: "천장 길 끝으로 가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 4 }], ceiling: true }, entities: () => gardenEntities("05-v2-1"), enter: () => gardenWorld("05-v2-1"), execute: gardenMove, complete: (w) => atEntity(w, "hero", "05-v2-1-exit") }),
  segment({ id: "05-v2-2", title: "천장의 가시", goal: "가시 너머로 가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 4 }], ceiling: true }, entities: () => gardenEntities("05-v2-2"), enter: () => gardenWorld("05-v2-2"), execute: gardenMove, complete: (w) => atEntity(w, "hero", "05-v2-2-exit") }),
  segment({ id: "05-v2-3", title: "낮은 덩굴", goal: "덩굴 너머로 가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => gardenEntities("05-v2-3"), enter: () => gardenWorld("05-v2-3"), execute: gardenMove, complete: (w) => atEntity(w, "hero", "05-v2-3-exit") }),
  segment({ id: "05-v2-4", title: "잠든 꽃", goal: "꽃밭을 지나가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => gardenEntities("05-v2-4"), enter: () => gardenWorld("05-v2-4"), execute: gardenMove, complete: (w) => atEntity(w, "hero", "05-v2-4-exit") }),
  segment({ id: "05-v2-5", title: "중력 문턱", goal: "아치 너머의 길 끝으로 가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }], ceiling: true }, entities: () => gardenEntities("05-v2-5"), enter: () => gardenWorld("05-v2-5"), execute: gardenMove, complete: (w) => atEntity(w, "hero", "05-v2-5-exit") && w.actors.hero.capabilities.includes("gravity:up") }),
  segment({ id: "05-v2-6", title: "정원의 출구", goal: "편지와 함께 정원을 나가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => gardenEntities("05-v2-6"), enter: () => gardenWorld("05-v2-6"), execute: gardenMove, complete: (w) => atEntity(w, "hero", "05-v2-6-exit") }),
];

function storehouseEntities(id: string): Entity[] {
  const lantern = (x: number, y = 0) => quietEntity("06-v2-lantern", "등불", id, x, y, { kind: "lantern", tool: "lantern", lit: true, recoverable: true }, { movable: true, material: "light", weight: 0.2 });
  const key = (x: number, y = 0) => quietEntity("06-v2-key", "열쇠", id, x, y, { kind: "key", tool: "brass-key", recoverable: true }, { movable: true, material: "metal", weight: 0.1 });
  const door = (name: string, x: number, y = 0, suffix = "door") => quietEntity(`${id}-${suffix}`, name, id, x, y, { kind: "gate", locked: true, unlocked: false, open: false, acceptsKey: "brass-key" }, { material: "metal" });
  const exit = (name: string, x = 9, y = 0) => quietEntity(`${id}-exit`, name, id, x, y, { kind: "exit", safe: true }, { material: "stone" });
  switch (id) {
    case "06-v2-1": return [lantern(2), quietEntity(`${id}-alcove`, "어두운 벽감", id, 8, 0, { kind: "exit", safe: true, illuminated: false }, { material: "stone" })];
    case "06-v2-2": return [
      lantern(1),
      quietEntity(`${id}-hook`, "벽고리", id, 4, 1, { kind: "wall-hook", accepts: "lantern", usedWallHook: false }, { material: "metal" }),
      quietEntity(`${id}-ladder`, "사다리", id, 6, 0, { kind: "ladder", ladder: true, climbable: true, requiresTwoHands: true }, { material: "wood" }),
      quietEntity(`${id}-shelf`, "위 선반", id, 8, 3, { kind: "exit", safe: true }, { material: "wood" }),
    ];
    case "06-v2-3": {
      const light = lantern(2, 1);
      light.parent = `${id}-hook`;
      return [light, quietEntity(`${id}-hook`, "벽고리", id, 2, 1, { kind: "wall-hook", accepts: "lantern", usedWallHook: true }, { material: "metal" }), exit("출구")];
    }
    case "06-v2-4": return [key(2), door("자물쇠문", 6), exit("출구")];
    case "06-v2-5": return [key(1), door("아래문", 3, 0, "lower-door"), door("위문", 6, 1, "upper-door"), exit("출구", 9, 2)];
    default: return [lantern(1), key(3), door("문", 6), exit("출구")];
  }
}

function storehouseWorld(id: string): WorldState {
  return quietWorld(6, id, storehouseEntities(id));
}

function firstClosedDoorBetween(world: WorldState, from: number, to: number): Entity | undefined {
  return Object.values(world.entities)
    .filter((entity) => entity.properties.kind === "gate" && entity.properties.open !== true && crossesX(from, to, entity.location.x))
    .sort((a, b) => a.location.x - b.location.x)[0];
}

function approachStorehouse(world: WorldState, actorId: "hero" | "keeper", target: Entity): ActionResult | WorldState {
  const actor = world.actors[actorId];
  const closed = firstClosedDoorBetween(world, actor.location.x, target.location.x);
  if (closed && closed.id !== target.id) return quietBlocked(world, `${closed.name}이 닫혀 길을 막고 있어요.`);
  const next = structuredClone(world);
  moveQuietActor(next, actorId, target.location);
  return next;
}

function autoTakeTool(world: WorldState, actorId: "hero" | "keeper", item: Entity): ActionResult | WorldState {
  if (item.parent === actorId) return world;
  if ((item.parent === "hero" || item.parent === "keeper") && item.parent !== actorId) return quietBlocked(world, `${item.name}은 다른 주체가 들고 있어요.`);
  const approached = approachStorehouse(world, actorId, item);
  if ("outcome" in approached) return approached;
  const taken = takeQuietItem(approached, actorId, item.id);
  return taken && taken.outcome !== "done" ? taken : taken?.world ?? approached;
}

function storehouseExecute(world: WorldState, raw: PhysicalAction): ActionResult {
  const value = resolved(world, raw);
  if (isResult(value)) return value;
  let action = value;
  const namedInstrument = action.instrument ? world.entities[action.instrument] : undefined;
  const namedTarget = world.entities[action.target];
  if (action.verb === "place" && namedInstrument?.properties.tool === "lantern" && namedTarget?.properties.kind === "wall-hook") {
    action = { ...action, target: namedInstrument.id, destination: namedTarget.id };
    delete action.instrument;
  }
  if (action.actor !== "hero") return quietClarification(world, "이 창고에는 용사만 있어요.");
  const target = world.entities[action.target];
  if (!target) return quietClarification(world, "대상을 찾을 수 없어요.");
  const id = world.segmentId;

  if (action.verb === "take" && target.movable) {
    const approached = approachStorehouse(world, "hero", target);
    if ("outcome" in approached) return approached;
    return takeQuietItem(approached, "hero", target.id) ?? quietClarification(world, "물건을 챙길 수 없어요.");
  }

  if (action.verb === "place" && target.properties.tool === "lantern") {
    const destination = action.destination ? world.entities[action.destination] : undefined;
    if (!destination || destination.properties.kind !== "wall-hook") return quietClarification(world, "등불을 걸 벽걸이를 지정해 주세요.");
    let nextWorld = world;
    if (target.parent !== "hero") {
      const taken = autoTakeTool(nextWorld, "hero", target);
      if ("outcome" in taken) return taken;
      nextWorld = taken;
    }
    const approached = approachStorehouse(nextWorld, "hero", destination);
    if ("outcome" in approached) return approached;
    const placed = placeQuietItem(approached, "hero", target.id, destination.id);
    if (placed.outcome === "done") {
      placed.world.entities[destination.id].properties.usedWallHook = true;
      moveQuietActor(placed.world, "hero", { region: id, x: destination.location.x, y: 0 });
    }
    return placed;
  }

  if ((action.verb === "open" || action.verb === "turn") && target.properties.kind === "gate") {
    const key = action.instrument ? world.entities[action.instrument] : world.entities["06-v2-key"];
    if (!key || key.properties.tool !== "brass-key") return quietClarification(world, "문을 열 놋쇠 열쇠를 지정해 주세요.");
    const blocked = firstClosedDoorBetween(world, world.actors.hero.location.x, target.location.x);
    if (blocked && blocked.id !== target.id) return quietBlocked(world, `${blocked.name}부터 열어야 위쪽 문에 닿아요.`);
    let nextWorld = world;
    const taken = autoTakeTool(nextWorld, "hero", key);
    if ("outcome" in taken) return taken;
    nextWorld = structuredClone(taken);
    moveQuietActor(nextWorld, "hero", target.location);
    nextWorld.entities[target.id].properties.locked = false;
    nextWorld.entities[target.id].properties.unlocked = true;
    nextWorld.entities[target.id].properties.open = true;
    return quietResult(nextWorld, "done", `${target.name}을(를) 열고 열쇠를 그대로 챙겼어요.`);
  }

  if (action.verb === "climb" && id === "06-v2-2" && (target.id === `${id}-ladder` || target.id === `${id}-shelf`)) {
    const lantern = world.entities["06-v2-lantern"];
    if (lantern.parent === "hero") return quietBlocked(world, "등불을 벽걸이에 걸어 두 손을 비워야 해요.");
    if (lantern.parent !== `${id}-hook`) return quietBlocked(world, "어두운 사다리 곁 벽걸이에 불빛이 필요해요.");
    const next = structuredClone(world);
    moveQuietActor(next, "hero", next.entities[`${id}-shelf`].location);
    return quietResult(next, "done", "두 손으로 사다리를 올라 위쪽 선반에 닿았어요.");
  }

  if (movementVerb(action.verb)) {
    let nextWorld = world;
    const instrument = action.instrument ? world.entities[action.instrument] : undefined;
    if (instrument?.properties.tool === "lantern" && instrument.parent !== "hero") {
      const taken = autoTakeTool(nextWorld, "hero", instrument);
      if ("outcome" in taken) return taken;
      nextWorld = taken;
    }
    if (id === "06-v2-1" && target.id === `${id}-alcove` && nextWorld.entities["06-v2-lantern"].parent !== "hero") {
      return quietFailure(nextWorld, "불빛 없이 벽감으로 들어가 발밑을 놓쳤어요.");
    }
    if (id === "06-v2-3" && target.id === `${id}-exit` && nextWorld.entities["06-v2-lantern"].parent !== "hero") {
      return quietBlocked(nextWorld, "벽고리의 등불을 회수해야 출구까지 밝힐 수 있어요.");
    }
    if (id === "06-v2-6" && target.id === `${id}-exit` && nextWorld.entities["06-v2-lantern"].parent !== "hero") {
      return quietBlocked(nextWorld, "등불을 들고 나가야 해요.");
    }
    const travelTarget = id === "06-v2-5" && action.verb === "climb" && target.id === `${id}-upper-door`
      && nextWorld.entities[target.id].properties.open === true
      ? nextWorld.entities[`${id}-exit`]
      : nextWorld.entities[target.id];
    const approached = approachStorehouse(nextWorld, "hero", travelTarget);
    if ("outcome" in approached) return approached;
    return quietResult(approached, "done", `${travelTarget.name}에 도착했어요.`);
  }

  return executePhysicalAction(world, action);
}

const storehouseDefinitions: SegmentDefinition[] = [
  segment({ id: "06-v2-1", title: "어둠에 가져가기", goal: "벽감을 밝혀야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => storehouseEntities("06-v2-1"), enter: () => storehouseWorld("06-v2-1"), execute: storehouseExecute, complete: (w) => atEntity(w, "hero", "06-v2-1-alcove") && w.entities["06-v2-lantern"].parent === "hero" }),
  segment({ id: "06-v2-2", title: "두 손으로 오르기", goal: "위 선반에 올라가야 해요.", scene: { floors: [{ from: 0, to: 6, y: 0 }, { from: 6, to: 10, y: 3 }] }, entities: () => storehouseEntities("06-v2-2"), enter: () => storehouseWorld("06-v2-2"), execute: storehouseExecute, complete: (w) => atEntity(w, "hero", "06-v2-2-shelf") && w.entities["06-v2-lantern"].parent === "06-v2-2-hook" }),
  segment({ id: "06-v2-3", title: "두고 가지 않기", goal: "등불과 함께 다음 방으로 가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => storehouseEntities("06-v2-3"), enter: () => storehouseWorld("06-v2-3"), execute: storehouseExecute, complete: (w) => atEntity(w, "hero", "06-v2-3-exit") && w.entities["06-v2-lantern"].parent === "hero" }),
  segment({ id: "06-v2-4", title: "빌리는 열쇠", goal: "열쇠를 가지고 문 너머로 가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => storehouseEntities("06-v2-4"), enter: () => storehouseWorld("06-v2-4"), execute: storehouseExecute, complete: (w) => atEntity(w, "hero", "06-v2-4-exit") && w.entities["06-v2-key"].parent === "hero" && w.entities["06-v2-4-door"].properties.open === true }),
  segment({ id: "06-v2-5", title: "같은 열쇠", goal: "두 문 너머로 가야 해요.", scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 3, to: 6, y: 1 }, { from: 6, to: 10, y: 2 }] }, entities: () => storehouseEntities("06-v2-5"), enter: () => storehouseWorld("06-v2-5"), execute: storehouseExecute, complete: (w) => atEntity(w, "hero", "06-v2-5-exit") && w.entities["06-v2-key"].parent === "hero" && w.entities["06-v2-5-lower-door"].properties.open === true && w.entities["06-v2-5-upper-door"].properties.open === true }),
  segment({ id: "06-v2-6", title: "불빛을 챙겨서", goal: "등불과 함께 보관소를 나가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => storehouseEntities("06-v2-6"), enter: () => storehouseWorld("06-v2-6"), execute: storehouseExecute, complete: (w) => atEntity(w, "hero", "06-v2-6-exit") && w.entities["06-v2-lantern"].parent === "hero" && w.entities["06-v2-key"].parent === "hero" && w.entities["06-v2-6-door"].properties.open === true }),
];

function theatreEntities(id: string): Entity[] {
  const grip = (suffix = "grip", name = "막 손잡이") => quietEntity(`${id}-${suffix}`, name, id, 2, 0, { kind: "hold-handle", holdable: true, held: false, heldBy: "" }, { material: "metal" });
  const curtain = () => quietEntity(`${id}-curtain`, "무대막", id, 6, 0, { kind: "curtain", open: false, raised: false, blocksPath: true }, { material: "cloth" });
  switch (id) {
    case "07-v2-1": return [
      quietEntity(`${id}-meeting`, "합류 자리", id, 8, 0, { kind: "meeting-place", safe: true, rail: true }, { material: "stone" }),
      quietEntity(`${id}-path`, "무대길", id, 4, 0, { kind: "route", route: "meeting", rail: true }, { material: "metal" }),
    ];
    case "07-v2-2": return [grip(), curtain()];
    case "07-v2-3": return [grip(), curtain(), quietEntity(`${id}-arrival`, "도착 자리", id, 9, 0, { kind: "exit", safe: true }, { material: "stone" })];
    case "07-v2-4": return [grip("low-grip", "낮은 손잡이"), curtain(), quietEntity(`${id}-arrival`, "도착 자리", id, 9, 0, { kind: "exit", safe: true, rail: true }, { material: "stone" })];
    case "07-v2-5": return [
      quietEntity(`${id}-bench`, "긴 의자", id, 2, 0, { kind: "bridge", bridged: false, holders: "" }, { material: "wood", movable: true, weight: 2 }),
      quietEntity(`${id}-gap`, "틈", id, 5, 0, { kind: "gap", passageBlocked: true }, { material: "stone" }),
      quietEntity(`${id}-bank`, "건너편", id, 9, 0, { kind: "exit", safe: true, rail: true }, { material: "stone" }),
    ];
    default: return [
      curtain(),
      quietEntity(`${id}-latch`, "고정 걸쇠", id, 5, 0, { kind: "latch", holdable: true, latched: false }, { material: "metal" }),
      quietEntity(`${id}-exit`, "출구", id, 9, 0, { kind: "exit", safe: true, rail: true }, { material: "stone" }),
    ];
  }
}

function theatreWorld(id: string): WorldState {
  const entities = theatreEntities(id);
  const heroLocation = id === "07-v2-1" ? { region: id, x: 8, y: 0 } : { region: id, x: 0, y: 0 };
  const state = quietWorld(7, id, entities, { hero: { location: heroLocation }, keeper: { location: { region: id, x: 0, y: 0 } } });
  if (id === "07-v2-3") {
    state.actors.keeper.location = { region: id, x: 2, y: 0 };
    state.actors.keeper.holding = `${id}-grip`;
    state.entities[`${id}-grip`].properties.held = true;
    state.entities[`${id}-grip`].properties.heldBy = "keeper";
    state.entities[`${id}-curtain`].properties.open = true;
    state.entities[`${id}-curtain`].properties.raised = true;
    state.entities[`${id}-curtain`].properties.blocksPath = false;
  }
  if (id === "07-v2-6") {
    state.actors.keeper.location = { region: id, x: 4, y: 0 };
    state.actors.keeper.holding = `${id}-curtain`;
    state.entities[`${id}-curtain`].properties.held = true;
    state.entities[`${id}-curtain`].properties.heldBy = "keeper";
    state.entities[`${id}-curtain`].properties.open = true;
    state.entities[`${id}-curtain`].properties.raised = true;
    state.entities[`${id}-curtain`].properties.blocksPath = false;
  }
  return state;
}

function setCurtain(world: WorldState, open: boolean): void {
  const curtain = world.entities[`${world.segmentId}-curtain`];
  if (!curtain) return;
  curtain.properties.open = open;
  curtain.properties.raised = open;
  curtain.properties.blocksPath = !open;
}

function theatreExecute(world: WorldState, raw: PhysicalAction): ActionResult {
  const value = resolved(world, raw);
  if (isResult(value)) return value;
  const action = value;
  const actor = world.actors[action.actor];
  const target = world.entities[action.target];
  if (!actor || !target) return quietClarification(world, "주체와 대상을 다시 지정해 주세요.");
  const id = world.segmentId;

  if (action.verb === "hold" && (target.properties.kind === "hold-handle" || target.id === `${id}-curtain`)) {
    if (target.properties.held === true && target.properties.heldBy !== action.actor) return quietBlocked(world, `${target.name}은 다른 주체가 잡고 있어요.`);
    const next = structuredClone(world);
    moveQuietActor(next, action.actor, next.entities[target.id].location);
    next.actors[action.actor].holding = target.id;
    next.entities[target.id].properties.held = true;
    next.entities[target.id].properties.heldBy = action.actor;
    setCurtain(next, true);
    return quietResult(next, "done", `${action.actor === "hero" ? "용사가" : "등지기가"} ${target.name}을(를) 잡아 막을 올렸어요.`);
  }

  if (action.verb === "release") {
    if (actor.holding !== target.id) return quietBlocked(world, `${target.name}은 ${action.actor === "hero" ? "용사" : "등지기"}가 잡고 있지 않아요.`);
    const next = structuredClone(world);
    releaseQuietHold(next, action.actor);
    if (next.entities[`${id}-latch`]?.properties.latched !== true) setCurtain(next, false);
    return quietResult(next, "done", `${target.name}을(를) 놓았어요.`);
  }

  if (id === "07-v2-5" && (action.verb === "take" || action.verb === "hold" || action.verb === "push" || action.verb === "pull") && target.id === `${id}-bench`) {
    if (action.destination && action.destination !== `${id}-gap`) return quietClarification(world, "긴 의자를 놓을 틈을 다시 지정해 주세요.");
    const next = structuredClone(world);
    moveQuietActor(next, action.actor, next.entities[target.id].location);
    next.actors[action.actor].holding = target.id;
    const holders = new Set(String(next.entities[target.id].properties.holders || "").split("|").filter(Boolean));
    holders.add(action.actor);
    next.entities[target.id].properties.holders = [...holders].sort().join("|");
    const jointlyMoves = action.verb !== "take" && action.verb !== "hold" && holders.has("hero") && holders.has("keeper");
    if (jointlyMoves) {
      next.entities[target.id].location = { ...next.entities[`${id}-gap`].location };
      next.entities[target.id].properties.bridged = true;
      next.entities[`${id}-gap`].properties.passageBlocked = false;
      next.actors.hero.holding = null;
      next.actors.keeper.holding = null;
    }
    return quietResult(next, "done", jointlyMoves
      ? "둘이 긴 의자를 들어 틈 위에 다리로 놓았어요."
      : `${action.actor === "hero" ? "용사가" : "등지기가"} 긴 의자 한쪽을 잡았어요.`);
  }

  if (id === "07-v2-5" && action.verb === "place" && target.id === `${id}-bench`) {
    if (action.destination !== `${id}-gap`) return quietClarification(world, "긴 의자를 놓을 틈을 지정해 주세요.");
    const holders = new Set(String(target.properties.holders || "").split("|").filter(Boolean));
    if (!holders.has(action.actor)) return quietBlocked(world, `${action.actor === "hero" ? "용사" : "등지기"}도 긴 의자 한쪽을 먼저 잡아야 해요.`);
    if (!holders.has("hero") || !holders.has("keeper")) return quietBlocked(world, "두 사람이 긴 의자의 양쪽을 모두 잡아야 옮길 수 있어요.");
    if (target.properties.bridged === true && target.location.x === world.entities[`${id}-gap`].location.x) {
      return quietResult(world, "done", "긴 의자는 이미 둘이 놓은 자리에 있어요.");
    }
    const next = structuredClone(world);
    next.entities[target.id].location = { ...next.entities[`${id}-gap`].location };
    next.entities[target.id].properties.bridged = true;
    next.entities[`${id}-gap`].properties.passageBlocked = false;
    next.actors.hero.holding = null;
    next.actors.keeper.holding = null;
    return quietResult(next, "done", "둘이 긴 의자를 틈 위에 다리로 놓았어요.");
  }

  const latchesCurtain = id === "07-v2-6" && (
    ((action.verb === "turn" || action.verb === "hold") && target.id === `${id}-latch`)
    || ((action.verb === "place" || action.verb === "tie") && target.id === `${id}-curtain` && action.destination === `${id}-latch`)
    || (action.verb === "place" && target.id === `${id}-latch` && action.destination === `${id}-curtain`)
  );
  if (latchesCurtain) {
    const next = structuredClone(world);
    moveQuietActor(next, action.actor, next.entities[`${id}-latch`].location);
    next.entities[`${id}-latch`].properties.latched = true;
    setCurtain(next, true);
    return quietResult(next, "done", "걸쇠가 열린 막을 고정했어요.");
  }

  if (movementVerb(action.verb)) {
    if (id === "07-v2-1" && action.actor === "keeper" && target.id === `${id}-meeting`) {
      const next = structuredClone(world);
      moveQuietActor(next, "keeper", target.location);
      return quietResult(next, "done", "부름을 들은 등지기가 톱니길을 따라 만남터로 왔어요.");
    }
    const curtain = world.entities[`${id}-curtain`];
    const travelTarget = id === "07-v2-3" && target.id === `${id}-curtain` && curtain?.properties.open === true
      ? world.entities[`${id}-arrival`]
      : target;
    if (curtain && crossesX(actor.location.x, travelTarget.location.x, curtain.location.x) && curtain.properties.open !== true) {
      return quietBlocked(world, "닫힌 무대막이 길을 막고 있어요.");
    }
    if (id === "07-v2-5" && target.id === `${id}-bank` && world.entities[`${id}-bench`].properties.bridged !== true) {
      return quietFailure(world, "다리 없이 무대 사이 틈을 건널 수 없어요.");
    }
    if (id === "07-v2-6" && target.id === `${id}-exit` && action.actor === "keeper" && world.entities[`${id}-latch`].properties.latched !== true) {
      return quietBlocked(world, "등지기가 막을 놓기 전에 걸쇠로 고정해야 해요.");
    }
    const next = structuredClone(world);
    if (action.actor === "keeper" && next.actors.keeper.holding === `${id}-curtain`) {
      releaseQuietHold(next, "keeper");
      if (next.entities[`${id}-latch`]?.properties.latched !== true) setCurtain(next, false);
    }
    moveQuietActor(next, action.actor, travelTarget.location);
    return quietResult(next, "done", `${action.actor === "hero" ? "용사가" : "등지기가"} ${travelTarget.name}에 도착했어요.`);
  }

  return executePhysicalAction(world, action);
}

const theatreDefinitions: SegmentDefinition[] = [
  segment({ id: "07-v2-1", title: "첫 동행", goal: "등지기와 만나야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => theatreEntities("07-v2-1"), enter: () => theatreWorld("07-v2-1"), execute: theatreExecute, complete: (w) => atEntity(w, "keeper", "07-v2-1-meeting") && atEntity(w, "hero", "07-v2-1-meeting") }),
  segment({ id: "07-v2-2", title: "잡고 있기", goal: "등지기가 무대막을 들어 줘야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => theatreEntities("07-v2-2"), enter: () => theatreWorld("07-v2-2"), execute: theatreExecute, complete: (w) => w.actors.keeper.holding === "07-v2-2-grip" && w.entities["07-v2-2-curtain"].properties.raised === true }),
  segment({ id: "07-v2-3", title: "내가 지나간 뒤", goal: "용사도 건너가고, 등지기도 자유로워져야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => theatreEntities("07-v2-3"), enter: () => theatreWorld("07-v2-3"), execute: theatreExecute, complete: (w) => atEntity(w, "hero", "07-v2-3-arrival") && w.actors.keeper.holding === null }),
  segment({ id: "07-v2-4", title: "역할 바꾸기", goal: "이번엔 등지기를 막 너머로 보내야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => theatreEntities("07-v2-4"), enter: () => theatreWorld("07-v2-4"), execute: theatreExecute, complete: (w) => w.actors.hero.holding === "07-v2-4-low-grip" && atEntity(w, "keeper", "07-v2-4-arrival") }),
  segment({ id: "07-v2-5", title: "함께 나르기", goal: "함께 건너편으로 가야 해요.", scene: { floors: [{ from: 0, to: 3, y: 0 }, { from: 7, to: 10, y: 0 }] }, entities: () => theatreEntities("07-v2-5"), enter: () => theatreWorld("07-v2-5"), execute: theatreExecute, complete: (w) => w.entities["07-v2-5-bench"].properties.bridged === true && atEntity(w, "hero", "07-v2-5-bank") && atEntity(w, "keeper", "07-v2-5-bank") }),
  segment({ id: "07-v2-6", title: "둘이 도착하기", goal: "등지기와 함께 극장을 나가야 해요.", scene: { floors: [{ from: 0, to: 10, y: 0 }] }, entities: () => theatreEntities("07-v2-6"), enter: () => theatreWorld("07-v2-6"), execute: theatreExecute, complete: (w) => w.entities["07-v2-6-latch"].properties.latched === true && atEntity(w, "hero", "07-v2-6-exit") && atEntity(w, "keeper", "07-v2-6-exit") }),
];

export const QUIET_GARDEN_STAGE: CampaignStageDefinition = {
  id: 5,
  title: "뒤집힌 정원",
  contentRevision: "shared-v1",
  segments: gardenDefinitions,
  practice: gardenDefinitions[0],
  story: { afterSegment: "05-v2-6", object: "천장에 핀 꽃", text: "거꾸로 핀 꽃도 바람이 오는 쪽을 기억하고 있었다." },
};

export const QUIET_STOREHOUSE_STAGE: CampaignStageDefinition = {
  id: 6,
  title: "등불 보관소",
  contentRevision: "shared-v1",
  segments: storehouseDefinitions,
  practice: storehouseDefinitions[0],
  story: { afterSegment: "06-v2-6", object: "닳은 열쇠", text: "작은 열쇠는 마지막 문을 연 뒤에도 손안에 남았다." },
};

export const QUIET_THEATRE_STAGE: CampaignStageDefinition = {
  id: 7,
  title: "평형 인형극장",
  contentRevision: "shared-v1",
  segments: theatreDefinitions,
  practice: theatreDefinitions[0],
  story: { afterSegment: "07-v2-6", object: "낡은 무대막", text: "막 뒤의 길은 한 사람이 아닌 두 사람의 발자국을 기다렸다." },
};
