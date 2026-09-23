import { at, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../../../src/campaign/level";
import { currentLoad, entityMass, executePhysicalAction, validateAction } from "../../../src/campaign/physics";
import type { ActionResult } from "../../../src/campaign/program";
import type { Actor, Entity, PhysicalAction, Scalar, WorldState } from "../../../src/campaign/types";

const MOVEMENT = new Set<PhysicalAction["verb"]>(["move", "jump", "duck", "climb"]);
const LEFT = "10-5-left-handle";
const RIGHT = "10-5-right-handle";
const SQUARE = "10-5-square-handle";
const LEFT_MAP = "10-5-left-map";
const RIGHT_MAP = "10-5-right-map";
function entity(id: string, name: string, region: string, x: number, kind: string, properties: Record<string, Scalar> = {}, patch: Partial<Entity> = {}): Entity {
  return makeEntity(id, name, region, x, { reach: 1, description: name, properties: { kind, ...properties }, ...patch });
}
function object(id: string, name: string, region: string, x: number, slot: "small" | "large", weight: number, properties: Record<string, Scalar> = {}, material: Entity["material"] = "wood"): Entity {
  return entity(id, name, region, x, "portable-tool", { slot, recoverable: true, ...properties }, { movable: true, material, weight });
}
function keeper(region: string): Actor { return { id: "keeper", location: { region, x: 0, y: 0 }, holding: null, carrying: [], riding: null, capabilities: ["weight:0.3", "rail-only", "no-jump", "no-stairs", "max-weight:0.5", "carry-small:1"] }; }
function syncCarried(world: WorldState, actor: Actor): void {
  const visit = (id: string) => { const item = world.entities[id]; if (!item) return; item.location = { ...actor.location }; for (const child of Object.values(world.entities)) if (child.parent === id) visit(child.id); };
  actor.carrying.forEach(visit);
}
/** A seal change puts tools back on its previous shelf. Within a seal every object keeps its identity. */
function enter(id: string, current: Entity[], previous: WorldState | null, withKeeper = false, newSeal = false): WorldState {
  const retained = previous ? structuredClone(Object.values(previous.entities)) : [];
  for (const item of retained) {
    if (item.properties.held === true) { item.properties.held = false; item.properties.heldBy = ""; }
    if (newSeal && (item.parent === "hero" || item.parent === "keeper") && item.id !== "letter") item.parent = null;
  }
  const items = new Map(retained.map((item) => [item.id, item]));
  current.forEach((item) => items.set(item.id, item));
  const hero = makeHero(id);
  if (!newSeal) hero.carrying = previous?.actors.hero.carrying.filter((key) => key !== "letter" && items.has(key)) ?? [];
  const world = makeWorld(10, id, [...items.values()], hero);
  if (withKeeper) {
    world.actors.keeper = keeper(id);
    if (!newSeal) world.actors.keeper.carrying = previous?.actors.keeper?.carrying.filter((key) => items.has(key)) ?? [];
  }
  for (const actor of Object.values(world.actors)) syncCarried(world, actor);
  world.visible = [...new Set([...current.map((item) => item.id), ...Object.values(world.actors).flatMap((actor) => actor.carrying)])];
  return world;
}
function result(world: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult { return { world, outcome, reason }; }
const blocked = (world: WorldState, reason: string) => result(world, "blocked", reason);
const clarify = (world: WorldState, reason: string) => result(world, "clarification", reason);
const fail = (world: WorldState, reason: string) => result(world, "failure", reason);
function movedPoint(world: WorldState, action: PhysicalAction): Actor["location"] | null {
  if (!MOVEMENT.has(action.verb)) return null;
  const actor = world.actors[action.actor], target = world.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return null;
  const dx = target.location.x - actor.location.x, dy = target.location.y - actor.location.y;
  const distance = Math.hypot(dx, dy), ratio = distance === 0 ? 0 : Math.min(1, 1 / distance);
  return { region: actor.location.region, x: actor.location.x + dx * ratio, y: actor.location.y + dy * ratio };
}
function crosses(world: WorldState, action: PhysicalAction, boundary: number): boolean {
  const next = movedPoint(world, action), actor = world.actors[action.actor];
  return !!next && ((actor.location.x < boundary && next.x >= boundary) || (actor.location.x > boundary && next.x <= boundary));
}
function physical(world: WorldState, action: PhysicalAction, refresh: (world: WorldState) => void = () => {}): ActionResult {
  // Climbing a marked fixed route is movement along it, not riding a movable platform.
  const route = action.verb === "climb" && world.entities[action.target]?.properties.climbable === true && world.entities[action.target]?.movable === false;
  const moved = executePhysicalAction(world, route ? { ...action, verb: "move" } : action, { movementStep: 1 });
  if (moved.outcome === "done" || moved.outcome === "progress") refresh(moved.world);
  return moved;
}
function advance(world: WorldState, refresh: (world: WorldState) => void, canChange = false) {
  const next = structuredClone(world); next.tick += 1; refresh(next); return { world: next, events: [], canChange };
}
function approachRelease(world: WorldState, action: PhysicalAction, refresh: (world: WorldState) => void): WorldState {
  const held = world.actors[action.actor]?.holding;
  if (!MOVEMENT.has(action.verb) || !held) return world;
  const released = executePhysicalAction(world, { kind: "action", actor: action.actor, verb: "release", target: held });
  if (released.outcome !== "done") return world;
  refresh(released.world); return released.world;
}
function parentedMove(world: WorldState, action: PhysicalAction, refresh: (world: WorldState) => void): ActionResult {
  const moved = physical(world, action);
  if ((moved.outcome === "done" || moved.outcome === "progress") && (action.verb === "push" || action.verb === "pull") && action.destination) moved.world.entities[action.target].parent = action.destination;
  if (moved.outcome === "done" || moved.outcome === "progress") refresh(moved.world);
  return moved;
}

function armPhase(world: WorldState) { return (["low", "low", "high", "high", "retracted", "retracted", "retracted", "retracted", "retracted", "retracted", "retracted"] as const)[(world.tick - (world.segmentStartedAt ?? 0)) % 11]; }
function refreshPassage(world: WorldState) {
  world.entities["10-1-arm"].properties.phase = armPhase(world);
  world.entities["10-1-arm"].properties.orientation = (world.tick - (world.segmentStartedAt ?? 0)) % 11;
  world.entities["10-1-gap"].properties.bridged = world.entities["10-1-plank"].parent === "10-1-gap";
}
const familiarGesture: SegmentDefinition = {
  id: "10-1", title: "익숙한 몸짓이 커졌을 뿐", goal: "팔이 접힌 안전창에 뛰거나 낮은 판자 길을 만들어 조작대 도착하기",
  description: "낮은 홈은 안전하고 중앙 1~4칸은 팔의 범위입니다. 위 계단은 판자 투하점에서 끝납니다. 되거두기 일곱 박자는 중앙을 지날 시간보다 깁니다.",
  hints: ["낮은 홈에서 팔이 몸 안으로 들어가는 때를 보세요.", "위 보행대에서 판자를 내려놓으면 낮은 홈 안에 안전한 길이 남습니다.", "낮은 석조 홈으로 가서 팔이 몸 안으로 접힐 때까지 기다린 다음, 짧은 바닥 틈을 뛰어넘고 바람판 조작대로 가."],
  enter: (previous) => { const world = enter("10-1", [
    entity("10-1-arm", "문지기의 기계 팔", "10-1", 2, "boss-arm", { phase: "low", orientation: 0, cycle: "low|high|retracted", dangerStart: 1, dangerEnd: 4 }, { propertyOptions: { phase: ["low", "high", "retracted"], cycle: ["low|high|retracted"] }, description: "현재 자세는 낮은 쓸기, 높은 휘두르기, 되거두기 중 하나입니다. 몸 안으로 접힌 되거두기에는 중앙 통로가 비어 있습니다." }),
    entity("10-1-alcove", "낮은 석조 홈", "10-1", 1, "safe-alcove", { safe: true, climbable: true }),
    entity("10-1-walkway", "계단 위 판자 투하점", "10-1", 1, "walkway", { climbable: true, safe: true }, { location: { region: "10-1", x: 1, y: 2 } }),
    object("10-1-plank", "긴 판자", "10-1", 1, "large", 1),
    entity("10-1-gap", "낮은 홈의 짧은 틈", "10-1", 2, "gap", { bridged: false, width: 1 }, { reach: 2.3, description: "위 투하점에서 손잡이를 놓아 내릴 수 있는 틈. 판자는 팔 쓸기보다 낮게 놓입니다." }),
    entity("10-1-console", "바람판 조작대", "10-1", 5, "console", { safe: true }),
  ], previous); world.entities["10-1-plank"].location.y = 2; refreshPassage(world); return world; },
  execute: (world, action) => {
    const actor = world.actors[action.actor], next = movedPoint(world, action);
    if (action.target === "10-1-plank" && action.verb === "place" && action.destination === "10-1-gap" && !at(world, action.actor, "10-1-walkway")) return clarify(world, "판자는 계단 위 투하점에서 내려놓아야 양 끝이 돌턱에 닿아요.");
    if (next) {
      if (next.y > actor.location.y && next.y > 0.1 && action.verb !== "climb") return blocked(world, "위 투하점은 계단을 올라가야 닿아요.");
      if (actor.location.y > 0.1 && next.x > 1.01) return blocked(world, "위 보행대는 투하점에서 끝나요. 낮은 홈으로 내려와야 해요.");
      if (next.x > 1.1 && next.x < 4.9 && next.y < 0.1) {
        if (world.entities["10-1-gap"].properties.bridged === true) { if (action.verb !== "duck") return fail(world, "판자 길은 낮은 홈 안에 있어요. 고개가 홈 천장에 부딪혔어요."); }
        else if (world.entities["10-1-arm"].properties.phase !== "retracted" || (crosses(world, action, 1.5) && action.verb !== "jump")) return fail(world, "현재 높이의 팔이나 뛰어넘지 않은 틈에 몸이 닿았어요. 틈은 점프로 넘고 팔이 접힌 동안 통로를 지나야 해요.");
      }
    }
    return physical(world, action, refreshPassage);
  },
  idleAction: (world) => world.actors.hero.location.x < 1 && world.actors.hero.location.y === 0 ? { kind: "action", actor: "hero", verb: "move", target: "10-1-alcove" } : null,
  advance: (world) => {
    const next = advance(world, refreshPassage, true), hero = next.world.actors.hero;
    if (hero.location.x > 1.1 && hero.location.x < 4.9 && hero.location.y < 0.1 && next.world.entities["10-1-gap"].properties.bridged !== true && next.world.entities["10-1-arm"].properties.phase !== "retracted") return { ...next, failure: "안전창이 끝난 중앙 통로를 팔이 다시 훑었어요. 기다릴 때는 낮은 석조 홈으로 돌아가야 해요." };
    return next;
  }, complete: (world) => at(world, "hero", "10-1-console"),
};

const ROUTES = ["vent", "turbine", "pressure"] as const;
function refreshSeal(world: WorldState) {
  const vane = world.entities["10-2-vane"], pin = world.entities["10-2-pin"];
  vane.properties.route = ROUTES[Number(vane.properties.orientation) % 3];
  vane.properties.connectedTo = `10-2-${vane.properties.route}`;
  world.entities["10-2-turbine"].properties.flowing = vane.properties.route === "turbine";
  world.entities["10-2-balcony"].properties.open = pin.properties.removed === true && vane.properties.route === "vent";
  if (pin.properties.removed === true) pin.properties.latchedOut = true;
}
const attackTurnsSeal: SegmentDefinition = {
  id: "10-2", title: "공격이 돌리는 첫 봉인", goal: "직접 압력 또는 걸린 추의 낙하로 핀을 빼고 바람을 배출한 뒤 발코니 오르기",
  description: "바람판은 배출구→풍차→압력판 순서로 한 칸씩 회전합니다. 압력은 두 박자에 핀을 밀고 풍차는 세 박자에 추를 걸쇠까지 올립니다.",
  hints: ["투명 관 세 개의 끝과 큰 추의 높이 눈금을 보세요.", "올라가는 추는 바람을 끊으면 내려오고, 위 걸쇠에 걸린 뒤에만 남습니다.", "바람판을 압력판에 맞을 때까지 돌리고 핀이 빠질 때까지 기다려. 그 뒤 배출구에 맞을 때까지 돌리고 흉갑 발코니로 올라가."],
  enter: (previous) => { const world = enter("10-2", [
    entity("10-2-vane", "세 갈래 바람판", "10-2", 0, "wind-vane", { orientation: 0, route: "vent", cycle: "vent|turbine|pressure", connectedTo: "10-2-vent" }, { propertyOptions: { route: ["vent", "turbine", "pressure"], cycle: ["vent|turbine|pressure"] } }),
    entity("10-2-vent", "안전 배출구", "10-2", 1, "vent", { safe: true }),
    entity("10-2-turbine", "추를 올리는 풍차", "10-2", 2, "turbine", { flowing: false, connectedTo: "10-2-heavy-weight" }),
    entity("10-2-pressure", "넓은 압력판", "10-2", 2, "pressure-plate", { pressure: 0, required: 2, connectedTo: "10-2-pin" }),
    entity("10-2-heavy-weight", "밀폐 통로의 무거운 추", "10-2", 2, "heavy-weight", { height: 0, latched: false, connectedTo: "10-2-pin" }, { weight: 5, location: { region: "10-2", x: 2, y: -3 } }),
    entity("10-2-release", "추 해제 줄", "10-2", 1, "release-cord", { actuator: true, strokes: 0, connectedTo: "10-2-heavy-weight" }),
    entity("10-2-pin", "첫 봉인 잠금핀", "10-2", 3, "seal-pin", { removed: false, latchedOut: false }, { location: { region: "10-2", x: 3, y: -3 } }),
    entity("10-2-balcony", "내려온 흉갑 발코니", "10-2", 4, "checkpoint-balcony", { open: false, climbable: true, checkpoint: 1 }),
  ], previous); refreshSeal(world); return world; },
  execute: (world, action) => {
    if (MOVEMENT.has(action.verb)) {
      const next = movedPoint(world, action);
      if (next && next.x >= 2 && world.entities["10-2-vane"].properties.route !== "vent") return fail(world, "아직 통로에 남은 풍압이 용사를 밀어냈어요. 핀 뒤에는 배출구로 돌려야 해요.");
      if (next && next.x > 2 && world.entities["10-2-pin"].properties.removed !== true) return blocked(world, "잠금핀이 남아 발코니 계단이 내려오지 않았어요.");
    }
    const moved = physical(world, action, refreshSeal);
    if (moved.outcome === "done" && (action.verb === "pull" || action.verb === "push") && action.target === "10-2-release") {
      const weight = moved.world.entities["10-2-heavy-weight"];
      if (weight.properties.latched === true) {
        weight.properties.latched = false; weight.properties.height = 0;
        moved.world.entities["10-2-pin"].properties.removed = true;
        moved.reason = "실제로 걸려 있던 추가 내려가며 사슬로 핀을 뽑았어요.";
      } else moved.reason = "해제 줄을 당겼지만 위 걸쇠에 걸린 추가 없어 사슬이 움직이지 않았어요.";
      refreshSeal(moved.world);
    }
    return moved;
  },
  advance: (world) => {
    const next = structuredClone(world); next.tick += 1;
    const route = next.entities["10-2-vane"].properties.route, weight = next.entities["10-2-heavy-weight"], plate = next.entities["10-2-pressure"];
    plate.properties.pressure = route === "pressure" ? Math.min(2, Number(plate.properties.pressure) + 1) : 0;
    if (Number(plate.properties.pressure) >= 2) next.entities["10-2-pin"].properties.removed = true;
    if (weight.properties.latched !== true) {
      weight.properties.height = route === "turbine" ? Math.min(3, Number(weight.properties.height) + 1) : 0;
      weight.properties.latched = Number(weight.properties.height) === 3;
    }
    refreshSeal(next); return { world: next, events: [], canChange: route === "turbine" && weight.properties.latched !== true || route === "pressure" && Number(plate.properties.pressure) < 2 };
  },
  idleAction: (world) => world.entities["10-2-pin"].properties.latchedOut === true && world.entities["10-2-vane"].properties.route === "vent" && !at(world, "hero", "10-2-balcony") ? { kind: "action", actor: "hero", verb: "move", target: "10-2-balcony" } : null,
  complete: (world) => at(world, "hero", "10-2-balcony") && world.entities["10-2-pin"].properties.latchedOut === true && world.entities["10-2-vane"].properties.route === "vent",
};

const sides = ["normal", "inverse"] as const;
function refreshGarden(world: WorldState) {
  for (const side of sides) {
    const grid = world.entities[`10-3-${side}-grid`], step = `10-3-${side}-step`;
    grid.properties.reinforced = world.entities[`10-3-${side}-support`].parent === grid.id;
    const boxes = Object.values(world.entities).filter((item) => item.properties.kind === "rail-box" && item.parent === step);
    const overloaded = boxes.some((item) => entityMass(world, item.id) > 0.5) && grid.properties.reinforced !== true;
    if (overloaded) {
      grid.properties.collapsed = true;
      for (const box of boxes) if (box.id.endsWith("-glass")) box.properties.intact = false;
    }
    grid.properties.safeStep = !overloaded && boxes.length > 0;
  }
}
const mirrorGarden: SegmentDefinition = {
  id: "10-3", title: "거울 쪽 정원", goal: "유리 종을 깨지 않고 두 중력 구역에 발판을 만들어 조작대 도착하기",
  description: "금빛 경계 양쪽 중력은 고정입니다. 레일의 빈 상자는 0.4, 유리 종 상자는 1, 약한 격자는 0.5 하중입니다. 넓은 받침은 아래에서 하중을 석벽으로 전달합니다.",
  hints: ["각 구역의 돌 화살표와 고정 레일을 보세요.", "빈 상자만 써도 되고 격자 아래를 보강하면 유리 종 상자도 쓸 수 있습니다.", "정상중력 빈 상자 앞으로 가서 단차 홈에 밀어. 금빛 경계 도착선을 지나 역중력 입구로 간 뒤, 역중력 빈 상자도 그 구역 단차 홈에 밀고 조작대로 가."],
  enter: (previous) => {
    const current = sides.flatMap((side) => {
      const region = `10-3-${side}`, label = side === "normal" ? "정상중력" : "역중력";
      return [
        entity(`${region}-marker`, `${label} 돌 화살표`, region, 0, "room-gravity-marker", { fixedGravity: true, gravity: side === "normal" ? "down" : "up" }),
        entity(`${region}-entry`, `${label} 입구`, region, 0, "boundary", { safe: true }),
        entity(`${region}-grid`, `${label} 금간 격자`, region, 2, "weak-grid", { reinforced: false, collapsed: false, safeStep: false, capacityMark: 0.5 }),
        entity(`${region}-step`, `${label} 단차 홈`, region, 2, "step-socket", { rail: true }),
        object(`${region}-empty`, `${label} 빈 상자`, region, 1, "large", 0.4, { kind: "rail-box", railFixed: true, intact: true }),
        object(`${region}-glass`, `${label} 유리 종 상자`, region, 1, "large", 1, { kind: "rail-box", railFixed: true, intact: true }),
        object(`${region}-support`, `${label} 넓은 받침`, region, 1, "large", 0.8, { railFixed: true }),
        entity(side === "normal" ? "10-3-boundary" : "10-3-console", side === "normal" ? "금빛 경계 도착선" : "두 번째 봉인 조작대", region, 3, "safe-line", { safe: true }),
      ];
    });
    const world = enter("10-3", current, previous, false, true);
    world.actors.hero.location.region = "10-3-normal"; world.actors.hero.capabilities.push("gravity:down"); syncCarried(world, world.actors.hero); refreshGarden(world); return world;
  },
  execute: (world, action) => {
    const target = world.entities[action.target];
    if (!target) return physical(world, action, refreshGarden);
    if (target.properties.railFixed === true && action.verb === "take") return clarify(world, "이 물건은 구역의 고정 안내 홈에 붙어 있어 들 수 없어요. 같은 구역의 받침 자리로 밀어 주세요.");
    if (MOVEMENT.has(action.verb) && target.location.region !== world.actors[action.actor]?.location.region) {
      if (action.actor !== "hero" || action.verb !== "move" || action.target !== "10-3-inverse-entry" || !at(world, "hero", "10-3-boundary")) return clarify(world, "다른 중력 구역은 금빛 경계 도착선에서 입구로 걸어 이어져요.");
      const next = structuredClone(world); next.actors.hero.location = { ...target.location }; next.actors.hero.capabilities = ["weight:1", "gravity:up"]; syncCarried(next, next.actors.hero); return result(next, "done", "금빛 경계를 지나 돌 화살표가 가리키는 천장 바닥에 섰어요.");
    }
    const side = world.actors[action.actor]?.location.region.endsWith("inverse") ? "inverse" : "normal";
    if (crosses(world, action, 1.5) && world.entities[`10-3-${side}-grid`].properties.safeStep !== true) return blocked(world, "이 구역 단차에는 아직 실제 발판이 없어요.");
    if (target.properties.kind === "rail-box" && ["push", "pull", "place"].includes(action.verb)) {
      const region = target.location.region;
      if (action.destination !== `${region}-step` && action.destination !== `${region}-entry`) return clarify(world, "레일 상자는 같은 구역의 단차 홈이나 입구 쪽 끝으로만 움직여요.");
      const validation = validateAction(world, action); if (validation.outcome !== "valid") return result(world, validation.outcome, validation.reason);
    }
    const moved = parentedMove(world, action, refreshGarden);
    if ((moved.outcome === "done" || moved.outcome === "progress") && sides.some((part) => moved.world.entities[`10-3-${part}-grid`].properties.collapsed === true)) return fail(moved.world, "보강 없는 격자가 실제 하중을 버티지 못하고 갈라졌어요. 유리 종이 실려 있었다면 함께 깨졌어요.");
    return moved;
  },
  idleAction: (world) => {
    const side = world.actors.hero.location.region.endsWith("inverse") ? "inverse" : "normal";
    if (world.entities[`10-3-${side}-grid`].properties.safeStep !== true) return null;
    const target = side === "inverse" ? "10-3-console" : at(world, "hero", "10-3-boundary") ? "10-3-inverse-entry" : "10-3-boundary";
    return at(world, "hero", target) ? null : { kind: "action", actor: "hero", verb: "move", target };
  },
  advance: (world) => advance(world, refreshGarden),
  complete: (world) => at(world, "hero", "10-3-console") && sides.every((side) => world.entities[`10-3-${side}-grid`].properties.safeStep === true && world.entities[`10-3-${side}-glass`].properties.intact === true),
};

function refreshDoors(world: WorldState) {
  const front = world.entities["10-4-front-door"], rear = world.entities["10-4-rear-door"];
  front.properties.open = front.properties.locked === true || currentLoad(world, "10-4-front-plate") >= 1;
  rear.properties.open = currentLoad(world, "10-4-rear-plate") >= 1 || world.entities["10-4-wedge"].parent === "10-4-rear-socket";
  world.entities["10-4-side-gap"].properties.bridged = world.entities["10-4-plank"].parent === "10-4-side-gap";
}
const recoverTool: SegmentDefinition = {
  id: "10-4", title: "한 번 쓴 도구를 되찾는 길", goal: "한 장의 판자를 회수해 두 문을 지나 봉인 손잡이 당기기",
  description: "앞문 무게 발판, 틈이 있는 옆길, 안쪽 고정 손잡이, 뒷문 무게 발판이 이어집니다. 쐐기는 발판을 누르기엔 가볍지만 열린 문 아래를 받칩니다.",
  hints: ["앞문 안쪽 손잡이는 문을 열린 채 남깁니다.", "판자를 발판에 쓰거나 옆길의 틈을 덮은 뒤 앞문을 고정하세요.", "판자를 앞문 발판에 놓고 안쪽 손잡이로 가서 당겨. 앞문 발판으로 돌아가 판자를 회수하고 뒷문 발판 앞으로 이동해서 놓은 뒤 봉인 손잡이로 가서 당겨."],
  enter: (previous) => { const world = enter("10-4", [
    object("10-4-plank", "유일한 긴 판자", "10-4", 0, "large", 1), object("10-4-wedge", "나무 쐐기", "10-4", 0, "small", 0.2),
    entity("10-4-front-plate", "앞문 무게 발판", "10-4", 1, "weight-plate", { requiredWeight: 1 }),
    entity("10-4-front-door", "앞문", "10-4", 2, "door", { open: false, locked: false }),
    entity("10-4-side-start", "옆길 시작", "10-4", 1, "walkway", { climbable: true }, { location: { region: "10-4", x: 1, y: 1 } }),
    entity("10-4-side-gap", "옆길 짧은 틈", "10-4", 2, "gap", { bridged: false }, { location: { region: "10-4", x: 2, y: 1 } }),
    entity("10-4-side-end", "안쪽 손잡이 옆길", "10-4", 3, "walkway", { climbable: true }, { location: { region: "10-4", x: 3, y: 1 } }),
    entity("10-4-inside-latch", "앞문 안쪽 고정 손잡이", "10-4", 3, "latch-handle", { actuator: true, strokes: 0 }),
    entity("10-4-rear-plate", "뒷문 무게 발판", "10-4", 4, "weight-plate", { requiredWeight: 1 }),
    entity("10-4-rear-socket", "열린 뒷문 쐐기 홈", "10-4", 4, "wedge-socket"),
    entity("10-4-rear-door", "뒷문", "10-4", 5, "door", { open: false }),
    entity("10-4-seal-handle", "두 번째 봉인 해제 손잡이", "10-4", 6, "seal-handle", { actuator: true, strokes: 0 }),
    entity("10-4-balcony", "어깨 관측 발코니", "10-4", 7, "checkpoint-balcony", { open: false, checkpoint: 2 }),
  ], previous); refreshDoors(world); return world; },
  execute: (world, action) => {
    const actor = world.actors[action.actor], next = movedPoint(world, action);
    if (!actor) return clarify(world, "이 구간에는 지시한 주체가 없어요.");
    if (action.verb === "place" && action.target === "10-4-wedge" && action.destination === "10-4-rear-socket" && world.entities["10-4-rear-door"].properties.open !== true) return blocked(world, "뒷문이 닫혀 쐐기를 넣을 틈이 없어요. 먼저 실제 하중으로 들어 올려 주세요.");
    if (next && crosses(world, action, 2)) {
      if (actor.location.y >= 0.8 && next.y >= 0.8) { if (world.entities["10-4-side-gap"].properties.bridged !== true) return blocked(world, "옆길 틈에 판자가 없어 안쪽까지 이어지지 않아요."); }
      else if (world.entities["10-4-front-door"].properties.open !== true) return blocked(world, "앞문은 발판 하중이나 안쪽 고정이 없어 닫혀 있어요.");
    }
    if (next && next.x > 3 && next.y > 0.1) return blocked(world, "옆길은 안쪽 손잡이에서 끝나요. 정면 안전 발판으로 내려와야 해요.");
    if (crosses(world, action, 5) && world.entities["10-4-rear-door"].properties.open !== true) return blocked(world, "뒷문 발판과 쐐기 홈이 모두 비어 길이 닫혔어요.");
    if ((action.verb === "pull" || action.verb === "push") && action.target === "10-4-inside-latch" && actor.location.x < 2) return clarify(world, "안쪽 고정 손잡이는 앞문을 지나거나 옆길 안쪽에 도착해야 닿아요.");
    if ((action.verb === "pull" || action.verb === "push") && action.target === "10-4-seal-handle" && actor.location.x < 5) return clarify(world, "봉인 손잡이는 뒷문을 실제로 지난 뒤에 닿아요.");
    const moved = parentedMove(world, action, refreshDoors);
    if (moved.outcome === "done" && ["pull", "push"].includes(action.verb) && !action.destination) {
      if (action.target === "10-4-inside-latch") moved.world.entities["10-4-front-door"].properties.locked = true;
      if (action.target === "10-4-seal-handle") moved.world.entities["10-4-balcony"].properties.open = true;
      refreshDoors(moved.world);
    }
    return moved;
  },
  idleAction: (world) => {
    if (world.actors.hero.location.y !== 0) return null;
    const x = world.actors.hero.location.x;
    if (x < 3 && world.entities["10-4-front-door"].properties.open === true) return { kind: "action", actor: "hero", verb: "move", target: "10-4-inside-latch" };
    if (x >= 3 && x < 6 && world.entities["10-4-rear-door"].properties.open === true) return { kind: "action", actor: "hero", verb: "move", target: "10-4-seal-handle" };
    return null;
  },
  advance: (world) => advance(world, refreshDoors), complete: (world) => Number(world.entities["10-4-seal-handle"].properties.strokes) > 0 && world.actors.hero.location.x >= 5,
};

function connections(region: string, x: number): Entity[] {
  return [entity(LEFT_MAP, "왼쪽 걸쇠 연결 관", region, 0, "connection-sample", { connectedTo: LEFT }), entity(RIGHT_MAP, "오른쪽 걸쇠 연결 관", region, 0, "connection-sample", { connectedTo: RIGHT }),
    entity(LEFT, "삼각 무늬 유지 손잡이", region, x, "hold-handle", { rail: true, holdable: true, held: false, heldBy: "" }), entity(RIGHT, "원 무늬 유지 손잡이", region, x, "hold-handle", { rail: true, holdable: true, held: false, heldBy: "" }),
    entity(SQUARE, "사각 무늬 배출 손잡이", region, x, "hold-handle", { rail: true, actuator: true, strokes: 0 }), entity("10-5-drain", "안전 배출관", region, x, "drain", { flowing: false })];
}
function refreshSight(world: WorldState) {
  const vented = world.entities["10-5-vent"].properties.open === true;
  const canSee = vented || world.actors.hero.location.x < 1;
  world.entities["10-5-fog"].properties.cleared = vented;
  const maps = [LEFT_MAP, RIGHT_MAP, "10-5-scope"];
  world.visible = [...new Set([...world.visible.filter((id) => !maps.includes(id)), ...(canSee ? maps : [])])];
}
const seenConnection: SegmentDefinition = {
  id: "10-5", title: "안개가 덮이기 전에 본 연결", goal: "실제 연결을 기억하거나 환기로 남기고 등지기와 아래 작업대 도착하기",
  description: "발코니에서 두 걸쇠의 관을 끝까지 볼 수 있습니다. 아래로 가면 관 중간만 가려집니다. 손잡이와 톱니 레일은 계속 보이며 연결은 바뀌지 않습니다.",
  hints: ["확대경과 왼쪽·오른쪽 연결 관을 보세요.", "현재 관측을 기억하거나 고정 환기판을 열어 시야를 유지할 수 있습니다.", "발코니 확대경으로 왼쪽 연결 관을 관찰하고 기억한 다음 오른쪽 연결 관도 관찰하고 기억해. 용사와 등지기는 아래 작업대로 가."],
  enter: (previous) => enter("10-5", [
    ...connections("10-5", 2), entity("10-5-scope", "발코니 확대경", "10-5", 0, "scope", { safe: true }),
    entity("10-5-vent", "걸쇠 달린 고정 환기판", "10-5", 0, "vent", { open: false }), entity("10-5-fog", "관 중간의 안개", "10-5", 1, "fog", { cleared: false }),
    entity("10-5-workbench", "등지기와 만나는 작업대", "10-5", 3, "workbench", { safe: true, rail: true }),
  ], previous, true, true),
  execute: (world, action) => {
    const observing = action.verb === "observe" || action.verb === "remember";
    if (observing && (action.instrument === "10-5-scope" || action.target === "10-5-scope")) {
      const actor = world.actors[action.actor], scope = world.entities["10-5-scope"];
      if (!actor || !world.visible.includes(scope.id) || actor.location.region !== scope.location.region || Math.hypot(actor.location.x - scope.location.x, actor.location.y - scope.location.y) > scope.reach) return clarify(world, "고정 확대경은 발코니 관측 자리에서 실제로 들여다봐야 해요.");
      if (action.instrument && ![LEFT_MAP, RIGHT_MAP].includes(action.target)) return clarify(world, "확대경은 실제 보이는 왼쪽 또는 오른쪽 걸쇠의 관을 살펴보는 도구예요.");
      if (action.instrument) { const direct = { ...action }; delete direct.instrument; return physical(world, direct); }
    }
    if (observing && action.target === "10-5-scope") {
      let observed = physical(world, action); if (observed.outcome !== "done") return observed;
      for (const map of [LEFT_MAP, RIGHT_MAP]) { observed = executePhysicalAction(observed.world, { ...action, target: map }); if (observed.outcome !== "done") return observed; }
      return result(observed.world, "done", "확대경에서 두 관의 실제 접합과 걸쇠 연결을 이번 시도에 기록했어요.");
    }
    const moved = physical(world, action, refreshSight);
    if (moved.outcome === "done" && ["pull", "push"].includes(action.verb) && action.target === SQUARE) {
      moved.world.entities["10-5-drain"].properties.flowing = true;
      moved.world.facts.push({ entity: SQUARE, property: "connectedTo", value: "10-5-drain", attempt: world.attempt, tick: world.tick });
      moved.reason = "사각 손잡이의 힘이 안전 배출관에서 나오는 모습을 직접 확인했어요.";
    }
    return moved;
  },
  idleAction: (world) => {
    const observed = [LEFT_MAP, RIGHT_MAP].every((entity) => world.facts.some((fact) => fact.entity === entity && fact.property === "connectedTo" && fact.attempt === world.attempt));
    return (observed || world.entities["10-5-vent"].properties.open === true) && !at(world, "hero", "10-5-workbench") ? { kind: "action", actor: "hero", verb: "move", target: "10-5-workbench" } : null;
  },
  advance: (world) => advance(world, refreshSight), complete: (world) => at(world, "hero", "10-5-workbench") && at(world, "keeper", "10-5-workbench"),
};

function refreshFinal(world: WorldState) {
  const plate = world.entities["10-6-lock-plate"];
  const left = world.entities[LEFT].properties.held === true;
  const right = world.entities[RIGHT].properties.held === true || world.entities["10-6-wedge"].parent === "10-6-right-socket" || currentLoad(world, "10-6-right-plate") >= 0.3;
  const heroArrived = at(world, "hero", plate.id), keeperArrived = at(world, "keeper", plate.id);
  if (heroArrived || keeperArrived || currentLoad(world, plate.id) >= 0.3) plate.properties.locked = true;
  plate.properties.heroArrived = heroArrived; plate.properties.keeperArrived = keeperArrived;
  world.entities["10-6-keeper-exit"].properties.keeperArrived = at(world, "keeper", "10-6-keeper-exit");
  world.entities["10-6-hero-exit"].properties.heroArrived = at(world, "hero", "10-6-hero-exit");
  const locked = plate.properties.locked === true;
  world.entities["10-6-left-latch"].properties.locked = locked;
  world.entities["10-6-right-latch"].properties.locked = locked;
  world.entities["10-6-left-latch"].properties.open = locked || left;
  world.entities["10-6-right-latch"].properties.open = locked || right;
  world.entities["10-6-work-door"].properties.open = locked || left && right;
}
const finalDuty: SegmentDefinition = {
  id: "10-6", title: "마지막 유지 임무", goal: "먼저 건넌 주체가 잠금판을 눌러 둘 다 출구로 온 뒤 용사가 편지의 문 열기",
  description: "작업문→바닥 잠금판→출구 안전선→편지의 문 순서입니다. 잠금판에 실제 올라서면 두 걸쇠가 영구 고정됩니다. 관측한 삼각·원 손잡이는 그대로 이어집니다.",
  hints: ["손잡이를 잡은 몸이 떠나면 그 힘은 끝나요.", "한 명이 먼저 판에 도착해 잠근 뒤 남은 손을 놓아야 합니다.", "등지기는 잠금판이 고정될 때까지 삼각 손잡이를 잡고, 고정되면 등지기 출구로 가. 동시에 용사는 원 손잡이를 먼저 잡고 쐐기를 원 손잡이 홈에 놓은 다음 잠금판으로 가서 눌러. 이어서 용사는 용사 출구로 가서 등지기가 출구에 올 때까지 기다리고 배달문을 열어."],
  enter: (previous) => {
    const world = enter("10-6", [
      ...connections("10-6", 0), entity("10-6-left-latch", "작업문 왼쪽 걸쇠", "10-6", 1, "latch", { locked: false, open: false }), entity("10-6-right-latch", "작업문 오른쪽 걸쇠", "10-6", 1, "latch", { locked: false, open: false }),
      object("10-6-wedge", "마지막 나무 쐐기", "10-6", 0, "small", 0.2), entity("10-6-right-socket", "원 손잡이 쐐기 홈", "10-6", 0, "wedge-socket"),
      object("10-6-weight", "작은 평형추", "10-6", 0, "small", 0.3, {}, "metal"), entity("10-6-right-plate", "원 손잡이 연결 무게 발판", "10-6", 0, "weight-plate", { requiredWeight: 0.3, rail: true }),
      entity("10-6-work-door", "봉인 III 작업문", "10-6", 2, "door", { open: false }),
      entity("10-6-lock-plate", "영구 바닥 잠금판", "10-6", 3, "lock-panel", { actuator: true, strokes: 0, locked: false, rail: true, requiredWeight: 0.3, heroArrived: false, keeperArrived: false }, { description: "문을 건너 판 위에 실제로 올라서거나 그 자리에서 누르면 걸쇠가 영구 고정됩니다." }),
      entity("10-6-hero-exit", "용사 출구 안전선", "10-6", 4, "safe-line", { safe: true, heroArrived: false }), entity("10-6-keeper-exit", "등지기 출구 레일", "10-6", 4, "rail-stop", { safe: true, rail: true, keeperArrived: false }),
      entity("10-6-delivery-door", "편지의 배달문", "10-6", 5, "delivery-door", { open: false }), entity("10-6-ending-letter", "봉인이 풀린 편지", "10-6", 5, "story-object", { optional: true }, { material: "cloth" }),
    ], previous, true);
    const vented = previous?.entities["10-5-vent"]?.properties.open === true;
    if (!vented) world.visible = world.visible.filter((id) => id !== LEFT_MAP && id !== RIGHT_MAP);
    world.visible = world.visible.filter((id) => id !== "10-6-ending-letter"); refreshFinal(world); return world;
  },
  execute: (original, action) => {
    const world = approachRelease(original, action, refreshFinal);
    if (action.verb === "place" && action.target === "10-6-wedge" && action.destination === "10-6-right-socket") {
      if (action.actor !== "hero") return clarify(world, "쐐기 홈은 용사의 손 모양에 맞아요. 등지기는 평형추를 운반하고 발판을 누를 수 있어요.");
      if (world.entities[RIGHT].properties.held !== true) return blocked(world, "원 손잡이를 실제로 당겨야 쐐기 홈이 드러나요.");
    }
    if (crosses(world, action, 2) && world.entities["10-6-work-door"].properties.open !== true) return fail(world, "유지하던 손이 먼저 떨어져 작업문이 닫혔어요. 잠금판 안착 전에는 유지 임무를 끝낼 수 없어요.");
    if (["push", "pull", "turn", "hold"].includes(action.verb) && action.target === "10-6-lock-plate" && !at(world, action.actor, "10-6-lock-plate")) return clarify(world, "바닥 잠금판은 문을 건너 판 위에 실제 도착한 주체만 누를 수 있어요.");
    if (action.verb === "open" && action.target === "10-6-delivery-door") {
      if (action.actor !== "hero") return clarify(world, "배달할 편지를 가진 용사가 마지막 문을 열어요.");
      if (world.entities["10-6-lock-plate"].properties.locked !== true || !at(world, "hero", "10-6-hero-exit") || !at(world, "keeper", "10-6-keeper-exit")) return blocked(world, "문이 열리는 순간이 끝이 아니에요. 잠금판을 고정하고 두 주체가 출구 안전선 안에 모여야 해요.");
      if (world.entities.letter.parent !== "hero" || !world.actors.hero.carrying.includes("letter")) return blocked(world, "용사의 편지 주머니가 마지막 문 앞에 있어야 해요.");
    }
    return physical(world, action, refreshFinal);
  },
  idleAction: (world) => world.entities["10-6-lock-plate"].properties.locked === true && !at(world, "hero", "10-6-hero-exit") ? { kind: "action", actor: "hero", verb: "move", target: "10-6-hero-exit" } : null,
  advance: (world) => advance(world, refreshFinal),
  complete: (world) => world.entities["10-6-lock-plate"].properties.locked === true && at(world, "hero", "10-6-hero-exit") && at(world, "keeper", "10-6-keeper-exit") && world.entities.letter.parent === "hero" && world.actors.hero.carrying.includes("letter") && world.entities["10-6-delivery-door"].properties.open === true,
};

const practice: SegmentDefinition = {
  id: "10-practice", title: "되거두기 모형", goal: "모형 팔이 접히면 안전선으로 이동하기", description: "본편과 별개인 안전한 팔 모형과 도착선입니다.",
  hints: ["팔이 접히면 안전선 앞이 비어요.", "조건을 문장으로 정하면 그 사건까지 기다립니다.", "모형 팔이 접힐 때까지 기다렸다가 안전선으로 가."],
  enter: () => enter("10-practice", [entity("10-practice-arm", "모형 팔", "10-practice", 0, "boss-arm", { phase: "extended", orientation: 0 }, { propertyOptions: { phase: ["extended", "retracted"] } }), entity("10-practice-line", "안전선", "10-practice", 1, "safe-line", { safe: true })], null),
  execute: (world, action) => MOVEMENT.has(action.verb) && action.target === "10-practice-line" && world.entities["10-practice-arm"].properties.phase !== "retracted" ? blocked(world, "모형 팔이 아직 앞을 막고 있어 안전한 시작선에서 기다려요.") : physical(world, action),
  advance: (world) => advance(world, (next) => { next.entities["10-practice-arm"].properties.orientation = next.tick % 4; next.entities["10-practice-arm"].properties.phase = next.tick % 4 >= 2 ? "retracted" : "extended"; }, true),
  complete: (world) => at(world, "hero", "10-practice-line"),
};
export const WARDEN_STAGE: CampaignStageDefinition = {
  contentRevision: "shared-v1", id: 10, title: "돌아오지 못한 문지기", practice, segments: [familiarGesture, attackTurnsSeal, mirrorGarden, recoverTool, seenConnection, finalDuty], story: { afterSegment: "10-6", object: "10-6-ending-letter", text: "여기까지는 내가 길을 적었어. 다음 길은 네가 골라 줘. 이제는 같이 가자." } };
