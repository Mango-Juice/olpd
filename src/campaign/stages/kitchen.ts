import { elapsedTicks, makeEntity, makeHero, makeWorld, type CampaignStageDefinition, type SegmentDefinition } from "../level";
import { executePhysicalAction } from "../physics";
import type { ActionResult } from "../program";
import type { Entity, PhysicalAction, Scalar, WorldEvent, WorldState } from "../types";

const STAGE_ID = 3 as const;

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

function world(segmentId: string, entities: Entity[], heroX = 0): WorldState {
  const initial = makeWorld(STAGE_ID, segmentId, entities, makeHero(segmentId, heroX));
  initial.actors.hero.carrying = Object.values(initial.entities)
    .filter((item) => item.parent === "hero")
    .map((item) => item.id);
  return initial;
}

function carriedLetter(region: string, previous: WorldState | null): Entity {
  const prior = previous?.entities.letter;
  if (prior) {
    const retained = structuredClone(prior);
    retained.location = { region, x: 0, y: 0 };
    retained.parent = "hero";
    retained.properties = { ...retained.properties, kind: "object", slot: "small" };
    return retained;
  }
  return entity("letter", "편지", region, 0, { kind: "object", slot: "small", dry: true }, { material: "cloth", movable: true, weight: 0, parent: "hero" });
}

function clone(worldState: WorldState): WorldState {
  return structuredClone(worldState);
}

function moveContents(worldState: WorldState, parentId: string, location: Entity["location"], visited = new Set<string>()): void {
  if (visited.has(parentId)) return;
  visited.add(parentId);
  for (const child of Object.values(worldState.entities)) {
    if (child.parent !== parentId) continue;
    child.location = { ...location };
    moveContents(worldState, child.id, location, visited);
  }
}

function moveHeroWithInventory(worldState: WorldState, location: Entity["location"]): void {
  worldState.actors.hero.location = { ...location };
  for (const id of worldState.actors.hero.carrying) {
    const carried = worldState.entities[id];
    if (!carried) continue;
    carried.location = { ...location };
    moveContents(worldState, id, location);
  }
}

function result(worldState: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult {
  return { world: worldState, outcome, reason };
}

function fail(worldState: WorldState, reason: string): ActionResult {
  return result(clone(worldState), "failure", reason);
}

function property(worldState: WorldState, id: string, name: string): Scalar | undefined {
  return worldState.entities[id]?.properties[name];
}

function at(worldState: WorldState, id: string, x: number): boolean {
  return worldState.entities[id]?.location.x === x;
}

function event(
  after: WorldState,
  id: string,
  target: string,
  reason: string,
  changes: WorldEvent["changes"],
): WorldEvent {
  return {
    id: `${after.segmentId}:${after.attempt}:${after.tick}:${id}`,
    tick: after.tick,
    attempt: after.attempt,
    instructionId: null,
    actor: null,
    target,
    outcome: "observed",
    reason,
    changes: changes.filter((change) => change.before !== change.after),
  };
}

function change(entityId: string, name: string, before: Scalar | null, after: Scalar | null): WorldEvent["changes"][number] {
  return { entity: entityId, property: name, before, after };
}

function baseAdvance(worldState: WorldState): WorldState {
  const next = clone(worldState);
  next.tick += 1;
  return next;
}

function isMove(action: PhysicalAction, target: string): boolean {
  return (action.verb === "move" || action.verb === "jump" || action.verb === "duck") && action.target === target;
}

function movementCrossesRange(state: WorldState, action: PhysicalAction, start: number, end: number): boolean {
  if (action.verb !== "move" && action.verb !== "jump" && action.verb !== "duck") return false;
  const actor = state.actors[action.actor];
  const target = state.entities[action.target];
  if (!actor || !target || actor.location.region !== target.location.region) return false;
  const low = Math.min(actor.location.x, target.location.x);
  const high = Math.max(actor.location.x, target.location.x);
  return low <= end && high >= start && actor.location.x !== target.location.x;
}

const practice: SegmentDefinition = {
  id: "03-practice",
  title: "왕복 추와 찬장",
  goal: "추가 왼쪽 고리에 닿아 문이 열린 사건 뒤 찬장을 지난다.",
  description: "대기 공간에서 반복 사건과 다음 사건까지 기다리는 법을 비용 없이 연습한다.",
  hints: ["추의 양끝 고리를 관찰해 보세요.", "왼쪽 고리 도착 뒤에만 찬장 문이 열려요.", "추가 왼쪽 고리에 닿은 뒤 찬장을 지나가세요."],
  enter: () => world("03-practice", [
    entity("practice-alcove", "대기 공간", "03-practice", 0, { kind: "platform", safe: true, capacity: 1 }),
    entity("practice-pendulum", "왕복 추", "03-practice", 1, { kind: "gear", phase: "right", cycle: "right|middle|left|middle", periodTicks: 4 }),
    entity("practice-door", "찬장 문", "03-practice", 2, { kind: "handle", open: false, opensWhen: "practice-pendulum:left" }),
    entity("practice-exit", "찬장 너머", "03-practice", 3, { kind: "platform", safe: true }),
  ]),
  execute: (state, action) => {
    if (isMove(action, "practice-exit") && property(state, "practice-door", "open") !== true) {
      return result(state, "blocked", "추가 왼쪽 고리에 닿아 찬장 문이 열린 사건을 기다려야 해요.");
    }
    return executePhysicalAction(state, action);
  },
  advance: (state) => {
    const next = baseAdvance(state);
    const phases = ["right", "middle", "left", "middle"] as const;
    const prior = String(property(state, "practice-pendulum", "phase"));
    const phase = phases[elapsedTicks(next) % phases.length];
    next.entities["practice-pendulum"].properties.phase = phase;
    const wasOpen = Boolean(property(state, "practice-door", "open"));
    const open = phase === "left";
    next.entities["practice-door"].properties.open = open;
    return {
      world: next,
      canChange: true,
      events: [event(next, "pendulum", "practice-pendulum", `왕복 추가 ${phase} 구간에 닿았어요.`, [
        change("practice-pendulum", "phase", prior, phase),
        change("practice-door", "open", wasOpen, open),
      ])],
    };
  },
  complete: (state) => state.actors.hero.location.x === 3,
};

const steamDoor: SegmentDefinition = {
  id: "03-1",
  title: "김 빠지는 문",
  goal: "편지를 젖게 하지 않고 뜨거운 관을 피해 오븐 앞 통로를 지난다.",
  description: "김 종료 사건은 압력 바늘의 빈 원과 내려가는 바람음으로 함께 보인다.",
  hints: ["차양 아래에서는 얼마든지 안전하게 기다릴 수 있어요.", "바늘의 빈 원은 김 배출이 끝났다는 뜻이에요.", "김이 완전히 멎을 때까지 기다린 뒤 통로를 지나가세요."],
  enter: (previous) => world("03-1", [
    entity("03-1-awning", "안전 차양", "03-1", 0, { kind: "awning", safe: true, shelterCapacity: 1 }),
    entity("03-1-pressure-dial", "압력 바늘", "03-1", 1, { kind: "gear", phase: "venting", cycle: "venting|venting|stopped", periodTicks: 3, emptyCircle: false }),
    entity("03-1-steam-pipe", "김 관", "03-1", 2, { kind: "pipe", active: true, rangeStart: 1, rangeEnd: 3, fixedGrate: true, stoppable: false }),
    entity("03-1-passage", "오븐 앞 통로", "03-1", 4, { kind: "platform", safe: true, wetRisk: true, rangeStart: 1, rangeEnd: 3 }, { description: "김 위험 구간을 모두 지난 오븐 앞 통로의 끝지점" }),
    entity("03-1-exit", "통로 너머", "03-1", 4, { kind: "platform", safe: true }),
    carriedLetter("03-1", previous),
  ]),
  execute: (state, action) => {
    if (movementCrossesRange(state, action, 1, 3) && property(state, "03-1-steam-pipe", "active") === true) {
      const next = clone(state);
      next.entities.letter.properties.dry = false;
      return result(next, "failure", "김이 나는 동안 통로에 들어가 증기에 밀렸고 편지가 젖었어요. 빈 원 사건을 기다려야 해요.");
    }
    return executePhysicalAction(state, action);
  },
  advance: (state) => {
    const next = baseAdvance(state);
    const phase = elapsedTicks(next) % 3 === 2 ? "stopped" : "venting";
    const prior = String(property(state, "03-1-pressure-dial", "phase"));
    const wasActive = Boolean(property(state, "03-1-steam-pipe", "active"));
    next.entities["03-1-pressure-dial"].properties.phase = phase;
    next.entities["03-1-pressure-dial"].properties.emptyCircle = phase === "stopped";
    next.entities["03-1-steam-pipe"].properties.active = phase !== "stopped";
    return {
      world: next,
      canChange: true,
      events: [event(next, "steam", "03-1-steam-pipe", phase === "stopped" ? "바늘이 빈 원으로 돌아오고 김이 완전히 멎었어요." : "김 관이 통로를 가로질러 배출 중이에요.", [
        change("03-1-pressure-dial", "phase", prior, phase),
        change("03-1-steam-pipe", "active", wasActive, phase !== "stopped"),
      ])],
    };
  },
  complete: (state) => state.actors.hero.location.x === 4 && property(state, "letter", "dry") === true,
};

const passingClaw: SegmentDefinition = {
  id: "03-2",
  title: "지나가는 집게",
  goal: "밀가루 쟁반과 함께 반대편 홈에 도착한다.",
  description: "집게 그림자는 접근 예고이고 반대편 고리의 두 딸깍은 이탈 완료다.",
  hints: ["그림자가 지나간 것과 집게가 빠져나간 것은 달라요.", "쟁반 모서리는 정지 홈에 맞고 좁은 옆길은 집게 범위 밖이에요.", "이탈 완료 뒤 중앙을 건너거나 정지 홈과 옆길을 이용하세요."],
  enter: (previous) => world("03-2", [
    entity("03-2-left-alcove", "왼쪽 대피 공간", "03-2", 0, { kind: "platform", safe: true }),
    entity("03-2-claw", "회전 집게", "03-2", 2, { kind: "tongs", phase: "approach", cycle: "approach|sweep|away", periodTicks: 3, stopped: false, collision: false, rangeStart: 1, rangeEnd: 4 }),
    entity("03-2-shadow", "집게 그림자", "03-2", 1, { kind: "platform", warning: true, bodyClear: false }, { material: "light" }),
    entity("03-2-tray", "밀가루 쟁반", "03-2", 0, { kind: "tray", slot: "large", route: "left", cornerFitsStop: true, struck: false }, { material: "wood", movable: true, weight: 2, capacity: 3 }),
    entity("03-2-stop-slot", "쟁반 정지 홈", "03-2", 0, { kind: "platform", acceptsCorner: true, stops: "03-2-claw" }),
    entity("03-2-side-chute", "옆쪽 빼는 곳", "03-2", 0, { kind: "channel", outsideClawRange: true }),
    entity("03-2-service-lane", "좁은 옆길", "03-2", 3, { kind: "channel", outsideClawRange: true }, { reach: 3 }),
    entity("03-2-exit-stand", "출구 받침", "03-2", 5, { kind: "shelf", capacity: 3, safe: true }, { reach: 5 }),
    entity("03-2-right-alcove", "오른쪽 대피 공간", "03-2", 5, { kind: "platform", safe: true }),
    carriedLetter("03-2", previous),
  ]),
  execute: (state, action) => {
    if ((action.verb === "push" || action.verb === "pull") && action.target === "03-2-tray") {
      const route = property(state, "03-2-tray", "route");
      if (action.destination === "03-2-side-chute" && route !== "stopped") {
        return result(state, "clarification", "측면 인출구는 정지 홈에 걸린 쟁반 모서리에서만 손이 닿아요.");
      }
      if (action.destination === "03-2-service-lane" && route !== "side-chute") {
        return result(state, "clarification", "좁은 옆길 입구는 옆쪽 빼는 곳과 이어져 있어 먼저 그곳으로 빼야 해요.");
      }
    }
    const centralTrayMove = (action.verb === "push" || action.verb === "pull") && action.target === "03-2-tray" && action.destination === "03-2-exit-stand";
    if (centralTrayMove
      && property(state, "03-2-tray", "route") !== "service"
      && property(state, "03-2-claw", "stopped") !== true
      && property(state, "03-2-claw", "phase") !== "away") {
      const collided = clone(state);
      collided.entities["03-2-claw"].properties.collision = true;
      collided.entities["03-2-tray"].properties.struck = true;
      return result(collided, "failure", property(state, "03-2-claw", "phase") === "approach"
        ? "그림자는 예고일 뿐이에요. 집게 본체가 쟁반을 왼쪽 대피 공간으로 밀었어요."
        : "집게가 중앙 작업대를 쓸고 있어 쟁반과 용사가 대피 공간으로 밀렸어요.");
    }
    const next = executePhysicalAction(state, action);
    if (next.outcome !== "done") return next;
    const moved = clone(next.world);
    if ((action.verb === "push" || action.verb === "pull") && action.target === "03-2-tray") {
      const route = action.destination === "03-2-stop-slot" ? "stopped"
        : action.destination === "03-2-side-chute" ? "side-chute"
        : action.destination === "03-2-service-lane" ? "service"
        : action.destination === "03-2-exit-stand" ? (property(state, "03-2-tray", "route") === "service" ? "service-exit" : "central-exit")
        : String(property(state, "03-2-tray", "route"));
      moved.entities["03-2-tray"].properties.route = route;
      moved.entities["03-2-claw"].properties.stopped = action.destination === "03-2-stop-slot";
      if (action.destination) moveHeroWithInventory(moved, moved.entities[action.destination].location);
    }
    return result(moved, "done", next.reason);
  },
  advance: (state) => {
    const next = baseAdvance(state);
    if (property(next, "03-2-claw", "stopped") === true) return { world: next, events: [], canChange: false };
    const phases = ["approach", "sweep", "away"] as const;
    const phase = phases[elapsedTicks(next) % phases.length];
    const prior = String(property(state, "03-2-claw", "phase"));
    next.entities["03-2-claw"].properties.phase = phase;
    next.entities["03-2-shadow"].properties.bodyClear = phase === "away";
    return { world: next, canChange: true, events: [event(next, "claw", "03-2-claw", phase === "away" ? "집게가 반대편 고리에 닿아 두 번 딸깍였어요." : phase === "sweep" ? "집게 본체가 중앙을 쓸고 있어요." : "그림자가 먼저 작업대를 지나가요.", [change("03-2-claw", "phase", prior, phase)])] };
  },
  complete: (state) => at(state, "03-2-tray", 5) && state.actors.hero.location.x === 5,
};

const risingDough: SegmentDefinition = {
  id: "03-3",
  title: "기다려야 부푸는 다리",
  goal: "반죽을 발판 크기에서 단단하게 만들어 출구 턱을 오른다.",
  description: "팽창을 멈추는 것과 말랑한 반죽이 굳는 것은 서로 다른 사건이다.",
  hints: ["발판 문양 크기에 도달한 뒤에도 열은 반죽을 계속 부풀려요.", "램프를 끄면 팽창은 멈추지만 식는 시간이 필요해요.", "발판 크기에서 열을 끄거나 식힘 선반으로 옮긴 뒤 손자국 표식까지 기다리세요."],
  enter: (previous) => world("03-3", [
    entity("03-3-mold", "낮은 반죽 틀", "03-3", 0, { kind: "tray", capacity: 3, growthArea: true }),
    entity("03-3-lamp", "온기 램프", "03-3", 0, { kind: "handle", on: true, growthPerTick: 1, rangeStart: 0, rangeEnd: 0 }),
    entity("03-3-dough", "반죽", "03-3", 0, { kind: "platform", slot: "large", size: 0, silhouette: "flat", firmness: "soft", cooling: 0, climbable: false, stable: false, collapsed: false, cooledAt: "none" }, { material: "water", movable: true, weight: 1, capacity: 1, parent: "03-3-mold" }),
    entity("03-3-cooling-rack", "식힘 선반", "03-3", 1, { kind: "shelf", capacity: 3, coolingPerTick: 1 }),
    entity("03-3-safety-net", "아래쪽 안전망", "03-3", 1, { kind: "net", catchesDough: true, safe: true }, { material: "cloth" }),
    entity("03-3-exit-ledge", "출구 턱", "03-3", 3, { kind: "platform", height: 2, safe: true }),
    entity("03-3-napkin", "반으로 접힌 낡은 냅킨", "03-3", 1, { kind: "object", slot: "small", story: "누군가는 내가 천천히 먹을 때까지 늘 기다려 줬다." }, { material: "cloth", movable: true, weight: 0 }),
    carriedLetter("03-3", previous),
  ]),
  execute: (state, action) => {
    if (isMove(action, "03-3-exit-ledge")) {
      if (property(state, "03-3-dough", "size") !== 2 || property(state, "03-3-dough", "firmness") !== "hard") {
        const collapsed = clone(state);
        collapsed.entities["03-3-dough"].properties.collapsed = true;
        collapsed.entities["03-3-dough"].properties.silhouette = "collapsed";
        return result(collapsed, "failure", property(state, "03-3-dough", "firmness") === "soft" ? "굳기 전 반죽을 밟아 주저앉았어요. 손자국 굳음 표식을 기다려야 해요." : "반죽이 출구 턱에 닿는 발판 크기가 아니에요.");
      }
    }
    if (action.verb === "climb" && action.target === "03-3-dough" && property(state, "03-3-dough", "firmness") !== "hard") {
      const collapsed = clone(state);
      collapsed.entities["03-3-dough"].properties.collapsed = true;
      collapsed.entities["03-3-dough"].properties.silhouette = "collapsed";
      return result(collapsed, "failure", "말랑한 반죽을 밟아 주저앉았어요. 냉각 완료 사건이 빠졌어요.");
    }
    const next = executePhysicalAction(state, action);
    if (next.outcome !== "done") return next;
    if ((action.verb === "pull" || action.verb === "push") && action.target === "03-3-dough" && action.destination === "03-3-cooling-rack") {
      next.world.entities["03-3-dough"].properties.cooledAt = "rack";
    }
    return next;
  },
  advance: (state) => {
    const next = baseAdvance(state);
    const dough = next.entities["03-3-dough"];
    const priorSize = Number(property(state, "03-3-dough", "size"));
    const priorFirmness = String(property(state, "03-3-dough", "firmness"));
    const inMold = dough.location.x === next.entities["03-3-mold"].location.x;
    const heated = inMold && property(next, "03-3-lamp", "on") === true;
    if (heated) dough.properties.size = priorSize + 1;
    else if (priorSize === 2 && priorFirmness !== "hard") dough.properties.cooling = Number(dough.properties.cooling) + 1;
    const size = Number(dough.properties.size);
    if (size >= 4) {
      dough.properties.silhouette = "burst";
      return { world: next, events: [], canChange: false, failure: "열원을 계속 둬 반죽이 과팽창해 안전망 위로 터졌어요. 발판 크기에서 팽창 원인을 제거해야 해요." };
    }
    dough.properties.silhouette = size === 0 ? "flat" : size < 2 ? "rising" : size === 2 ? "platform" : "overexpanded";
    if (!heated && size === 2 && Number(dough.properties.cooling) >= (dough.location.x === 1 ? 1 : 2)) {
      dough.properties.firmness = "hard";
      dough.properties.climbable = true;
      dough.properties.stable = true;
    }
    return {
      world: next,
      canChange: heated || dough.properties.firmness !== "hard",
      events: [event(next, "dough", "03-3-dough", dough.properties.firmness === "hard" ? "손자국 굳음 표식이 나타났어요." : heated ? `반죽이 ${String(dough.properties.silhouette)} 크기로 부풀었어요.` : "반죽의 온도 눈금이 내려가고 있어요.", [
        change("03-3-dough", "size", priorSize, Number(dough.properties.size)),
        change("03-3-dough", "firmness", priorFirmness, String(dough.properties.firmness)),
      ])],
    };
  },
  idleAction: (state) => property(state, "03-3-dough", "size") === 2
    && property(state, "03-3-dough", "firmness") === "hard"
    && state.actors.hero.location.x !== state.entities["03-3-exit-ledge"].location.x
    ? { kind: "action", actor: "hero", verb: "move", target: "03-3-exit-ledge" }
    : null,
  complete: (state) => state.actors.hero.location.x === 3 && property(state, "03-3-dough", "size") === 2 && property(state, "03-3-dough", "firmness") === "hard",
};

function plate(id: string, name: string, identity: string, position: string, x: number): Entity {
  return entity(id, name, "03-4", x, { kind: "tray", slot: "large", identity, position, amount: 0, capacity: 1, recovered: false }, { material: "metal", movable: true, weight: 1, capacity: 1, parent: "03-4-belt" });
}

const plateRhythm: SegmentDefinition = {
  id: "03-4",
  title: "접시 세 장의 박자",
  goal: "별 접시만 수프 한 국자를 담아 출구 저울에 놓는다.",
  description: "접시의 테두리 정체성, 왼쪽 채움 자리, 국자 한 칸 용량이 모두 공개된다.",
  hints: ["별·달·잎 테두리는 이동해도 같은 접시를 가리켜요.", "나무주걱은 벨트 톱니만 멈추고 국자는 계속 움직여요.", "별 접시가 왼쪽 채움 자리에 왔을 때 한 번 채운 뒤 저울로 옮기세요."],
  enter: (previous) => world("03-4", [
    entity("03-4-first-alcove", "첫 대기 공간", "03-4", 0, { kind: "platform", safe: true }),
    entity("03-4-belt", "세 높이 컨베이어", "03-4", 1, { kind: "platform", running: true, positions: "left-fill|center|right-drain", periodTicks: 3 }),
    entity("03-4-ladle", "흔들리는 국자", "03-4", 0, { kind: "tongs", phase: "away", cycle: "away|pour", periodTicks: 2, serving: 1 }),
    entity("03-4-star-plate", "별 테두리 접시", "03-4", 0, { kind: "tray", slot: "large", identity: "star", position: "left-fill", amount: 0, capacity: 1, recovered: false }, { material: "metal", movable: true, weight: 1, capacity: 1, parent: "03-4-belt" }),
    plate("03-4-moon-plate", "달 테두리 접시", "moon", "center", 1),
    entity("03-4-leaf-plate", "잎 테두리 접시", "03-4", 2, { kind: "tray", slot: "large", identity: "leaf", position: "recovery", amount: 0, capacity: 1, recovered: true }, { material: "metal", movable: true, weight: 1, capacity: 1, parent: "03-4-recovery" }),
    entity("03-4-gear", "큰 벨트 톱니", "03-4", 0, { kind: "gear", acceptsWedge: true, stopped: false, stoppedAt: "none", linkedDevice: "03-4-belt" }, { capacity: 2 }),
    entity("03-4-spatula", "나무주걱", "03-4", 0, { kind: "handle", slot: "small", wedge: true }, { material: "wood", movable: true, weight: 1 }),
    entity("03-4-scale", "출구 저울", "03-4", 3, { kind: "shelf", acceptsIdentity: "star", requiredAmount: 1, capacity: 2, rejectedIdentity: "none" }, { reach: 3 }),
    entity("03-4-recovery", "회수 통", "03-4", 2, { kind: "drain", emptiesAt: "right-drain", capacity: 4 }),
    entity("03-4-exit", "출구 안전 공간", "03-4", 3, { kind: "platform", safe: true }),
    carriedLetter("03-4", previous),
  ]),
  execute: (state, action) => {
    const target = state.entities[action.target];
    if ((action.verb === "push" || action.verb === "pull" || action.verb === "place") && action.destination === "03-4-scale" && target?.properties.identity !== undefined) {
      if (target.properties.identity !== "star") {
        const rejected = clone(state);
        rejected.entities["03-4-scale"].properties.rejectedIdentity = String(target.properties.identity);
        return result(rejected, "failure", `${target.name}의 테두리가 저울의 별 문양과 맞지 않아 되감아요.`);
      }
      if (target.properties.amount !== 1) return fail(state, target.properties.amount === 0 ? "별 접시가 아직 비어 있어요. 왼쪽 채움 뒤에 옮겨야 해요." : "별 접시가 한 칸 용량을 넘어 수프가 넘쳤어요.");
      if (target.properties.position !== "left-fill" && target.properties.position !== "center") return fail(state, "별 접시가 오른쪽 배수대에 닿아 수프가 비워졌어요.");
    }
    const next = executePhysicalAction(state, action);
    if (next.outcome !== "done") return next;
    const moved = next.world;
    if ((action.verb === "place" || action.verb === "push") && action.target === "03-4-spatula" && action.destination === "03-4-gear") {
      moved.entities["03-4-spatula"].parent = "03-4-gear";
      moved.entities["03-4-belt"].properties.running = false;
      moved.entities["03-4-gear"].properties.stopped = true;
      moved.entities["03-4-gear"].properties.stoppedAt = Object.values(moved.entities).find((candidate) => candidate.properties.identity === "star")?.properties.position ?? "unknown";
    }
    if (action.verb === "take" && action.target === "03-4-spatula" && state.entities["03-4-spatula"].parent === "03-4-gear") {
      moved.entities["03-4-belt"].properties.running = true;
      moved.entities["03-4-gear"].properties.stopped = false;
      moved.entities["03-4-gear"].properties.stoppedAt = "none";
    }
    if (action.destination === "03-4-scale" && moved.entities[action.target]?.properties.identity === "star") {
      moved.entities[action.target].parent = "03-4-scale";
      moved.entities[action.target].properties.position = "scale";
    }
    return next;
  },
  advance: (state) => {
    const next = baseAdvance(state);
    const beltRunning = property(next, "03-4-belt", "running") === true;
    const positions = ["left-fill", "center", "right-drain"];
    const priorPhase = String(property(state, "03-4-ladle", "phase"));
    const phase = elapsedTicks(next) % 2 === 1 ? "pour" : "away";
    next.entities["03-4-ladle"].properties.phase = phase;
    let overflow: string | null = null;
    if (phase === "pour") {
      for (const id of ["03-4-star-plate", "03-4-moon-plate", "03-4-leaf-plate"]) {
        if (property(next, id, "position") !== "left-fill") continue;
        const amount = Number(property(next, id, "amount")) + 1;
        next.entities[id].properties.amount = amount;
        if (amount > next.entities[id].capacity) overflow = id;
      }
    }
    if (beltRunning) {
      for (const id of ["03-4-star-plate", "03-4-moon-plate", "03-4-leaf-plate"]) {
        const current = String(property(next, id, "position"));
        if (current === "scale" || current === "recovery") continue;
        const position = positions[(positions.indexOf(current) + 1) % positions.length];
        next.entities[id].properties.position = position;
        next.entities[id].location.x = positions.indexOf(position);
        if (position === "right-drain") {
          next.entities[id].properties.amount = 0;
          next.entities[id].properties.recovered = true;
          next.entities[id].properties.position = "recovery";
          next.entities[id].parent = "03-4-recovery";
          next.entities[id].location = { ...next.entities["03-4-recovery"].location };
        }
      }
    }
    if (overflow) return { world: next, events: [], canChange: false, failure: `${next.entities[overflow].name}이(가) 한 칸 용량을 넘어 수프가 넘쳤어요.` };
    return {
      world: next,
      canChange: true,
      events: [event(next, "conveyor", "03-4-belt", phase === "pour" ? "국자가 왼쪽 채움 자리의 접시에 한 국자를 부었어요." : beltRunning ? "컨베이어가 접시를 다음 자리로 옮겼어요." : "주걱이 톱니를 고정했지만 국자는 계속 흔들려요.", [change("03-4-ladle", "phase", priorPhase, phase)])],
    };
  },
  complete: (state) => state.entities["03-4-star-plate"].parent === "03-4-scale"
    && property(state, "03-4-star-plate", "amount") === 1
    && property(state, "03-4-moon-plate", "amount") === 0
    && state.entities["03-4-moon-plate"].parent === "03-4-recovery"
    && property(state, "03-4-leaf-plate", "amount") === 0
    && state.entities["03-4-leaf-plate"].parent === "03-4-recovery",
};

const midnightTable: SegmentDefinition = {
  id: "03-5",
  title: "자정의 한 상",
  goal: "단단한 빵을 접시에 담고 김이 멎은 뒤 출구 면에서 받아 편지와 함께 문을 지난다.",
  description: "큰 시계는 오븐 종, 김 배출, 집게 왕복, 식탁 정렬의 결정적 순서를 보여 준다.",
  hints: ["오븐 종은 전체 주기의 반복 기준점이에요.", "수동 쟁반과 좁은 옆길은 중앙 집게 범위 밖이에요.", "빵을 식힌 뒤 김 종료와 식탁 출구 정렬을 연결하거나, 출구 정렬에서 걸쇠를 걸고 옆길을 이용하세요."],
  enter: (previous) => world("03-5", [
    entity("03-5-clock", "천장 큰 시계", "03-5", 0, { kind: "gear", event: "oven-bell", sequence: "oven-bell|steam-venting|steam-stopped|claw-sweep|claw-away|table-aligned", periodTicks: 6 }),
    entity("03-5-ovens", "네 방향 오븐", "03-5", 0, { kind: "oven", bell: true, range: 1 }),
    entity("03-5-steam", "김 관", "03-5", 3, { kind: "pipe", active: false, rangeStart: 3, rangeEnd: 4 }),
    entity("03-5-claw", "집게 레일", "03-5", 2, { kind: "tongs", phase: "home", rangeStart: 1, rangeEnd: 3 }),
    entity("03-5-bread-mold", "부푸는 빵 틀", "03-5", 0, { kind: "tray", capacity: 3, heated: true }),
    entity("03-5-bread", "빵 반죽", "03-5", 0, { kind: "platform", slot: "large", size: 2, silhouette: "platform", firmness: "soft", cooling: 0 }, { material: "water", movable: true, weight: 1, parent: "03-5-bread-mold" }),
    entity("03-5-cooling-rack", "식힘 선반", "03-5", 1, { kind: "shelf", capacity: 3, coolingPerTick: 1 }),
    entity("03-5-table", "중앙 회전 식탁", "03-5", 2, { kind: "platform", orientation: 0, aligned: false, locked: false, exitOrientation: 1 }, { material: "wood", capacity: 5 }),
    entity("03-5-table-latch", "식탁 멈춤 걸쇠", "03-5", 4, { kind: "handle", on: false, armed: false, catchesAt: "exit", linkedDevice: "03-5-table", visibleState: "raised" }, { material: "metal", reach: 1 }),
    entity("03-5-plate", "완성 접시", "03-5", 2, { kind: "tray", slot: "large", identity: "serving", capacity: 1, amount: 0 }, { movable: true, capacity: 2, parent: "03-5-table" }),
    entity("03-5-manual-tray", "수동 쟁반", "03-5", 0, { kind: "tray", slot: "large", route: "oven", capacity: 2, struck: false }, { material: "wood", movable: true, weight: 1, capacity: 2 }),
    entity("03-5-service-lane", "좁은 옆길", "03-5", 3, { kind: "channel", outsideClawRange: true, rangeStart: 0, rangeEnd: 4 }, { reach: 3 }),
    entity("03-5-exit-face", "식탁 출구 면", "03-5", 4, { kind: "platform", safe: true, capacity: 3 }),
    entity("03-5-door", "출구 문", "03-5", 5, { kind: "handle", open: true, requiresDryPassage: true }),
    carriedLetter("03-5", previous),
    entity("03-5-wait-a", "오븐·김 관찰 자리", "03-5", 0, { kind: "platform", safe: true, sees: "ovens|steam" }),
    entity("03-5-wait-b", "집게·식탁 관찰 자리", "03-5", 2, { kind: "platform", safe: true, sees: "claw|table" }),
    entity("03-5-wait-c", "출구 관찰 자리", "03-5", 4, { kind: "platform", safe: true, sees: "steam|table" }),
  ]),
  execute: (state, action) => {
    if (isMove(action, "03-5-door") && property(state, "03-5-steam", "active") === true) {
      const wet = clone(state);
      wet.entities.letter.properties.dry = false;
      return result(wet, "failure", "김 배출이 끝나기 전에 출구를 지나려다 젖은 통로에서 되감았어요.");
    }
    if (isMove(action, "03-5-door")) {
      const bread = state.entities["03-5-bread"];
      const plate = state.entities["03-5-plate"];
      if (bread.parent !== plate.id || bread.properties.firmness !== "hard") return fail(state, "단단하게 식힌 빵이 완성 접시에 아직 담기지 않았어요.");
      if (plate.parent !== "hero" || !state.actors.hero.carrying.includes(plate.id)) return fail(state, "식탁 출구 면에서 완성 접시를 실제로 받아 들어야 해요.");
    }
    const centralTrayMove = (action.verb === "push" || action.verb === "pull") && action.target === "03-5-manual-tray" && action.destination === "03-5-exit-face";
    if (centralTrayMove && property(state, "03-5-manual-tray", "route") !== "service" && property(state, "03-5-claw", "phase") !== "away") {
      const struck = clone(state);
      struck.entities["03-5-manual-tray"].properties.struck = true;
      return result(struck, "failure", "집게가 중앙 운반 범위를 지나고 있어 수동 쟁반을 밀어냈어요. 옆길이나 이탈 완료 사건을 이용해야 해요.");
    }
    if ((action.verb === "push" || action.verb === "pull") && action.target === "03-5-plate" && action.destination === "03-5-exit-face" && property(state, "03-5-table", "aligned") !== true) {
      return result(state, "blocked", "완성 접시 쪽 식탁 면이 아직 출구와 맞지 않아 밀어 낼 수 없어요.");
    }
    const next = executePhysicalAction(state, action);
    if (next.outcome !== "done") return next;
    const moved = next.world;
    if (action.verb === "turn" && action.target === "03-5-table-latch") {
      moved.entities["03-5-table-latch"].properties.armed = moved.entities["03-5-table-latch"].properties.on;
      moved.entities["03-5-table-latch"].properties.visibleState = moved.entities["03-5-table-latch"].properties.on ? "lowered" : "raised";
      if (moved.entities["03-5-table-latch"].properties.on === false) moved.entities["03-5-table"].properties.locked = false;
      if (property(moved, "03-5-table", "aligned") === true && moved.entities["03-5-table-latch"].properties.on === true) moved.entities["03-5-table"].properties.locked = true;
    }
    if ((action.verb === "push" || action.verb === "pull") && action.target === "03-5-manual-tray") {
      if (action.destination === "03-5-service-lane") moved.entities["03-5-manual-tray"].properties.route = "service";
      if (action.destination === "03-5-exit-face") moved.entities["03-5-manual-tray"].properties.route = property(state, "03-5-manual-tray", "route") === "service" ? "service-exit" : "central-exit";
    }
    if (action.verb === "place" && action.target === "03-5-bread" && action.destination === "03-5-plate") moved.entities["03-5-plate"].properties.amount = 1;
    if ((action.verb === "push" || action.verb === "pull") && action.target === "03-5-plate" && action.destination === "03-5-exit-face") {
      moved.entities["03-5-plate"].parent = "03-5-exit-face";
    }
    if (action.verb === "take" && action.target === "03-5-plate") moveContents(moved, "03-5-plate", moved.entities["03-5-plate"].location);
    if ((action.verb === "push" || action.verb === "pull") && action.target === "03-5-manual-tray" && action.destination) {
      moveHeroWithInventory(moved, moved.entities[action.destination].location);
    }
    return next;
  },
  advance: (state) => {
    const next = baseAdvance(state);
    const sequence = ["oven-bell", "steam-venting", "steam-stopped", "claw-sweep", "claw-away", "table-aligned"] as const;
    const nextEvent = sequence[elapsedTicks(next) % sequence.length];
    const priorEvent = String(property(state, "03-5-clock", "event"));
    next.entities["03-5-clock"].properties.event = nextEvent;
    next.entities["03-5-ovens"].properties.bell = nextEvent === "oven-bell";
    next.entities["03-5-steam"].properties.active = nextEvent === "steam-venting";
    next.entities["03-5-claw"].properties.phase = nextEvent === "claw-away" ? "away" : nextEvent === "claw-sweep" ? "sweep" : "home";

    const table = next.entities["03-5-table"];
    if (table.properties.locked !== true && nextEvent === "table-aligned") {
      table.properties.orientation = 1;
      table.properties.aligned = true;
      if (next.entities["03-5-plate"].parent === table.id) {
        next.entities["03-5-plate"].location = { ...next.entities["03-5-exit-face"].location };
        moveContents(next, "03-5-plate", next.entities["03-5-plate"].location);
      }
      if (property(next, "03-5-table-latch", "armed") === true) table.properties.locked = true;
    } else if (table.properties.locked !== true && nextEvent === "steam-venting") {
      table.properties.orientation = 0;
      table.properties.aligned = false;
      if (next.entities["03-5-plate"].parent === table.id) {
        next.entities["03-5-plate"].location = { ...table.location };
        moveContents(next, "03-5-plate", next.entities["03-5-plate"].location);
      }
    }

    const bread = next.entities["03-5-bread"];
    if (bread.location.x === 0 && bread.parent === null) bread.parent = "03-5-bread-mold";
    if (bread.parent === "03-5-bread-mold" && bread.properties.firmness !== "hard") {
      bread.properties.size = Number(bread.properties.size) + 1;
      bread.properties.silhouette = Number(bread.properties.size) > 3 ? "burst" : Number(bread.properties.size) === 3 ? "overexpanded" : "platform";
      if (Number(bread.properties.size) > 3) return { world: next, events: [], canChange: false, failure: "빵을 틀에 너무 오래 두어 과팽창해 터졌어요. 발판 크기 사건 뒤 열원에서 빼야 해요." };
    } else if (bread.location.x === 1 && bread.properties.firmness !== "hard") {
      bread.properties.cooling = Number(bread.properties.cooling) + 1;
      if (Number(bread.properties.cooling) >= 2) bread.properties.firmness = "hard";
    }
    return {
      world: next,
      canChange: true,
      events: [event(next, "clock", "03-5-clock", `큰 시계가 ${nextEvent} 사건을 가리켜요.`, [change("03-5-clock", "event", priorEvent, nextEvent)])],
    };
  },
  complete: (state) => state.actors.hero.location.x === 5
    && state.entities["03-5-bread"].parent === "03-5-plate"
    && property(state, "03-5-bread", "firmness") === "hard"
    && state.entities["03-5-plate"].parent === "hero"
    && state.actors.hero.carrying.includes("03-5-plate")
    && state.entities["03-5-plate"].location.x === 5
    && state.entities["03-5-bread"].location.x === 5
    && state.entities.letter.parent === "hero"
    && state.actors.hero.carrying.includes("letter")
    && property(state, "letter", "dry") === true,
};

export const KITCHEN_STAGE: CampaignStageDefinition = {
  id: STAGE_ID,
  title: "태엽 부엌",
  practice,
  segments: [steamDoor, passingClaw, risingDough, plateRhythm, midnightTable],
  story: {
    afterSegment: "03-3",
    object: "03-3-napkin",
    text: "누군가는 내가 천천히 먹을 때까지 늘 기다려 줬다.",
  },
};

/** Finite visible vocabulary for a natural-language interpreter; values still come from WorldState. */
export const KITCHEN_PUBLIC_CATALOG = Object.fromEntries(
  [practice, ...KITCHEN_STAGE.segments].map((segment) => {
    const initial = segment.enter(null);
    return [segment.id, Object.values(initial.entities).map((item) => ({
      id: item.id,
      name: item.name,
      properties: Object.keys(item.properties).sort(),
    }))];
  }),
) as Readonly<Record<string, readonly { id: string; name: string; properties: readonly string[] }[]>>;
