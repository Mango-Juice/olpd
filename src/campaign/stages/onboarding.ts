import { makeEntity, makeHero, makeWorld, stillWorld, type SegmentDefinition } from "../level";
import { executePhysicalAction } from "../physics";
import type { ActionResult } from "../program";
import type { Actor, Entity, PhysicalAction, Scalar, StageId, WorldState } from "../types";

type LaterStageId = Exclude<StageId, 1>;

function object(
  id: string,
  name: string,
  region: string,
  x: number,
  properties: Record<string, Scalar>,
  patch: Partial<Entity> = {},
): Entity {
  return makeEntity(id, name, region, x, { description: name, reach: 1, properties, ...patch });
}

function scene(stageId: LaterStageId, id: string, entities: Entity[], heroX = 0): WorldState {
  return makeWorld(stageId, id, entities, makeHero(id, heroX));
}

function keeper(region: string, x = 0): Actor {
  return {
    id: "keeper",
    location: { region, x, y: 0 },
    holding: null,
    carrying: [],
    riding: null,
    capabilities: ["rail-only", "no-jump", "no-stairs", "max-weight:0.5", "weight:0.5"],
  };
}

function withKeeper(world: WorldState, x = 0): WorldState {
  world.actors.keeper = keeper(world.segmentId, x);
  return world;
}

function tick(world: WorldState, mutate: (next: WorldState) => void, canChange = true) {
  const next = structuredClone(world);
  next.tick += 1;
  mutate(next);
  return { world: next, events: [], canChange };
}

function result(world: WorldState, outcome: ActionResult["outcome"], reason: string): ActionResult {
  return { world, outcome, reason };
}

function samePlace(first: Entity, second: Entity): boolean {
  return first.location.region === second.location.region
    && first.location.x === second.location.x
    && first.location.y === second.location.y;
}

function handle(
  id: string,
  name: string,
  region: string,
  effectProperty: string,
  releaseValue = false,
): Entity {
  return object(id, name, region, 1, {
    kind: "handle",
    holdable: true,
    held: false,
    heldBy: "",
    [effectProperty]: false,
    holdEffectEntity: id,
    holdEffectProperty: effectProperty,
    holdEffectValue: true,
    releaseEffectValue: releaseValue,
  });
}

function latchedHandleExecute(deviceId: string, world: WorldState, action: PhysicalAction): ActionResult {
  const wasLatched = world.entities[deviceId]?.properties.latched === true;
  const executed = executePhysicalAction(world, action);
  if (executed.outcome === "done" && action.verb === "release" && action.target === deviceId && wasLatched) {
    executed.world.entities[deviceId].properties.open = true;
  }
  return executed;
}

const rainMove: SegmentDefinition = {
  id: "02-learn-1",
  title: "상자가 움직이는 자리",
  goal: "손잡이 달린 코르크 상자를 바닥의 빈 자리에 놓는다.",
  description: "마른 평지의 상자와 바로 옆 윤곽 자리만 보인다.",
  hints: ["상자는 몸 밖의 대상이에요.", "상자와 빈 자리를 함께 가리켜 보세요.", "코르크 상자를 빈 자리까지 밀어 보세요."],
  enter: () => scene(2, "02-learn-1", [
    object("02-learn-box", "손잡이 달린 코르크 상자", "02-learn-1", 0, { kind: "box", slot: "large", buoyant: true }, { material: "cork", movable: true, weight: 0.4 }),
    object("02-learn-box-spot", "바닥의 빈 상자 자리", "02-learn-1", 1, { kind: "platform", accepts: "02-learn-box", safe: true }, { material: "stone" }),
  ]),
  advance: stillWorld,
  complete: (world) => samePlace(world.entities["02-learn-box"], world.entities["02-learn-box-spot"]),
};

const rainFloat: SegmentDefinition = {
  id: "02-learn-2",
  title: "물 위의 상자",
  goal: "빈 코르크 상자를 잔잔한 얕은 물 위에 띄운다.",
  description: "물에는 흐름이 없고 끝에는 상자가 멈추는 안전턱이 있다.",
  hints: ["빈 코르크는 물보다 가벼워요.", "물받이는 상자를 놓을 목표예요.", "빈 상자를 물받이에 놓아 보세요."],
  enter: () => scene(2, "02-learn-2", [
    object("02-learn-floating-box", "빈 코르크 상자", "02-learn-2", 0, { kind: "box", slot: "large", buoyant: true, afloat: false }, { material: "cork", movable: true, weight: 0.4 }),
    object("02-learn-basin", "잔잔한 얕은 물받이", "02-learn-2", 1, { kind: "water", current: 0, shallow: true }, { material: "water", capacity: 3 }),
  ]),
  advance: (world) => tick(world, (next) => {
    const box = next.entities["02-learn-floating-box"];
    const basin = next.entities["02-learn-basin"];
    box.properties.afloat = samePlace(box, basin) && box.properties.buoyant === true;
  }),
  complete: (world) => world.entities["02-learn-floating-box"].properties.afloat === true,
};

const rainBoard: SegmentDefinition = {
  id: "02-learn-3",
  title: "떠 있는 발판",
  goal: "얕은 물에 뜬 코르크 상자 위에 올라선다.",
  description: "상자에는 용사 한 명 용량과 잠기는 선이 표시돼 있다.",
  hints: ["상자는 두 벽 사이에서 움직이지 않아요.", "탈 수 있음 표식을 확인해 보세요.", "떠 있는 상자에 올라 보세요."],
  enter: () => scene(2, "02-learn-3", [
    object("02-learn-raft-box", "떠 있는 코르크 상자", "02-learn-3", 1, { kind: "raft", boardable: true, buoyant: true, afloat: true, stable: true, waterline: "below-rim" }, { material: "cork", movable: true, weight: 0.4, capacity: 1 }),
    object("02-learn-shallow-water", "얕은 물받이", "02-learn-3", 1, { kind: "water", shallow: true, bounded: true }, { material: "water" }),
  ]),
  advance: stillWorld,
  complete: (world) => world.actors.hero.riding === "02-learn-raft-box"
    && world.entities["02-learn-raft-box"].properties.tipped !== true,
};

function timedPassage(
  id: "03-learn-1" | "03-learn-2",
  deviceId: string,
  targetId: string,
  title: string,
  deviceName: string,
  targetName: string,
  property: "open" | "active",
): SegmentDefinition {
  const safeWhen = property === "open";
  return {
    id,
    title,
    goal: safeWhen ? "문이 완전히 열린 뒤 도착선으로 건넌다." : "김이 완전히 멎은 뒤 도착선으로 간다.",
    description: safeWhen ? "문은 천천히 열리고 열린 동안 걸어서 통과할 여유가 있다." : "김 관은 분출과 멎음 두 상태를 반복하고 시작 바닥은 안전하다.",
    hints: safeWhen
      ? ["초 수보다 문의 자세를 보세요.", "완전히 열린 상태가 사건의 끝이에요.", "문이 다 열리면 도착선으로 가세요."]
      : ["분출 범위 밖에서는 안전해요.", "김이 보이지 않는 상태가 사건의 끝이에요.", "김이 완전히 멎으면 도착선으로 가세요."],
    enter: () => scene(3, id, [
      object(deviceId, deviceName, id, 1, safeWhen
        ? { kind: "door", open: false, opening: true, phase: "opening" }
        : { kind: "pipe", active: true, phase: "venting", rangeStart: 1, rangeEnd: 2 }),
      object(targetId, targetName, id, 2, { kind: "platform", safe: true }, { material: "stone", reach: 2 }),
    ]),
    execute: (world, action) => {
      if ((action.verb === "move" || action.verb === "jump" || action.verb === "duck") && action.target === targetId) {
        const safe = safeWhen ? world.entities[deviceId].properties.open === true : world.entities[deviceId].properties.active === false;
        if (!safe) return result(world, safeWhen ? "blocked" : "failure", safeWhen ? "문짝이 아직 길을 막고 있어요." : "나오는 김이 통로를 막아 옆 쿠션이 시작점으로 돌려보냈어요.");
      }
      return executePhysicalAction(world, action);
    },
    advance: (world) => tick(world, (next) => {
      const phase = (next.tick - (next.segmentStartedAt ?? 0)) % 4;
      if (safeWhen) {
        next.entities[deviceId].properties.open = phase >= 2;
        next.entities[deviceId].properties.phase = phase >= 2 ? "open" : "opening";
      } else {
        next.entities[deviceId].properties.active = phase < 2;
        next.entities[deviceId].properties.phase = phase < 2 ? "venting" : "stopped";
      }
    }),
    complete: (world) => world.actors.hero.location.x === world.entities[targetId].location.x,
  };
}

const kitchenDoor = timedPassage("03-learn-1", "03-learn-door", "03-learn-door-line", "천천히 열리는 문", "천천히 열리는 작은 문", "문 너머 도착선", "open");
const kitchenSteam = timedPassage("03-learn-2", "03-learn-steam", "03-learn-steam-line", "김이 쉬는 틈", "통로를 가로막는 김 관", "관 뒤 도착선", "active");

const forgeLatch: SegmentDefinition = {
  id: "04-learn-1",
  title: "손을 뗀 뒤에도",
  goal: "화덕 덮개를 끝까지 열어 걸쇠에 걸고 손을 뗀다.",
  description: "손잡이와 걸쇠는 하나의 작은 덮개에 붙어 있다.",
  hints: ["손잡이를 잡아 끝까지 당겨 보세요.", "걸쇠가 맞물릴 때까지 유지해야 해요.", "용사는 화덕 덮개 손잡이를 잡고, 걸쇠가 잠길 때까지 그대로 유지한 뒤 손을 놓으세요."],
  enter: () => {
    const device = handle("04-learn-lid", "걸쇠 달린 화덕 덮개", "04-learn-1", "open");
    device.properties.extension = 0;
    device.properties.latched = false;
    return scene(4, "04-learn-1", [device]);
  },
  execute: (world, action) => latchedHandleExecute("04-learn-lid", world, action),
  advance: (world) => tick(world, (next) => {
    const lid = next.entities["04-learn-lid"];
    if (lid.properties.held === true) {
      lid.properties.extension = Math.min(2, Number(lid.properties.extension) + 1);
      if (lid.properties.extension === 2) lid.properties.latched = true;
    } else if (lid.properties.latched !== true) {
      lid.properties.extension = 0;
      lid.properties.open = false;
    }
  }),
  complete: (world) => world.entities["04-learn-lid"].properties.latched === true
    && world.entities["04-learn-lid"].properties.open === true
    && world.actors.hero.holding === null,
};

const forgePipe: SegmentDefinition = {
  id: "04-learn-2",
  title: "관 끝의 바람",
  goal: "송풍 덮개를 걸어 둬 투명 관 끝의 바람개비를 돌린다.",
  description: "덮개와 바람개비는 갈림 없는 짧은 투명 관으로 이어져 있다.",
  hints: ["덮개가 열리면 관으로 바람이 들어가요.", "걸쇠가 맞물릴 때까지 잡아 보세요.", "용사는 송풍 덮개 손잡이를 잡고, 걸쇠가 잠길 때까지 유지한 뒤 손을 놓아 관 끝 바람개비가 계속 돌게 하세요."],
  enter: () => {
    const device = handle("04-learn-blower", "걸쇠 달린 송풍 덮개", "04-learn-2", "open");
    device.properties.extension = 0;
    device.properties.latched = false;
    return scene(4, "04-learn-2", [
      device,
      object("04-learn-pinwheel", "관 끝의 바람개비", "04-learn-2", 2, { kind: "fan", spinning: false, connectedTo: "04-learn-blower" }, { reach: 2 }),
    ]);
  },
  execute: (world, action) => latchedHandleExecute("04-learn-blower", world, action),
  advance: (world) => tick(world, (next) => {
    const blower = next.entities["04-learn-blower"];
    if (blower.properties.held === true) {
      blower.properties.extension = Math.min(2, Number(blower.properties.extension) + 1);
      if (blower.properties.extension === 2) blower.properties.latched = true;
    } else if (blower.properties.latched !== true) {
      blower.properties.extension = 0;
      blower.properties.open = false;
    }
    next.entities["04-learn-pinwheel"].properties.spinning = blower.properties.open === true;
  }),
  complete: (world) => world.entities["04-learn-blower"].properties.latched === true
    && world.entities["04-learn-pinwheel"].properties.spinning === true
    && world.actors.hero.holding === null,
};

const gardenGravity: SegmentDefinition = {
  id: "05-learn-1",
  title: "천장으로 난 길",
  goal: "현재 발밑인 천장 보행로를 따라 도착선까지 걷는다.",
  description: "돌 화살표와 흙가루가 이 방의 아래 방향을 위쪽으로 가리킨다.",
  hints: ["화면 아래보다 발이 붙은 길을 보세요.", "돌 화살표가 현재 중력을 보여 줘요.", "천장 보행로 끝 도착선으로 걸어가세요."],
  enter: () => scene(5, "05-learn-1", [
    object("05-learn-arrow", "위를 가리키는 돌 화살표", "05-learn-1", 0, { kind: "sign", gravity: "up", fixed: true }, { material: "stone" }),
    object("05-learn-ceiling-line", "천장 보행로 끝 도착선", "05-learn-1", 2, { kind: "platform", safe: true, gravity: "up" }, { material: "stone", reach: 2 }),
  ]),
  advance: stillWorld,
  complete: (world) => world.actors.hero.location.x === world.entities["05-learn-ceiling-line"].location.x,
};

const gardenRail: SegmentDefinition = {
  id: "05-learn-2",
  title: "매달린 화분",
  goal: "천장 레일 화분을 레일 끝 빈 자리로 민다.",
  description: "화분 고리는 짧고 갈림 없는 레일에서 빠지지 않는다.",
  hints: ["화분은 들어 올리는 물건이 아니에요.", "고정 고리는 레일 방향으로만 움직여요.", "화분을 레일 끝까지 밀어 보세요."],
  enter: () => scene(5, "05-learn-2", [
    object("05-learn-planter", "천장 레일 화분", "05-learn-2", 0, { kind: "planter", fixedToRail: true, rail: "ceiling" }, { material: "stone", movable: true, weight: 1 }),
    object("05-learn-rail-end", "레일 끝 빈 자리", "05-learn-2", 1, { kind: "rail-stop", rail: "ceiling", safe: true }, { material: "metal" }),
  ]),
  execute: (world, action) => {
    if (action.target === "05-learn-planter" && action.verb === "take") {
      return result(world, "clarification", "화분 고리가 천장 레일에 고정되어 들어 올릴 수 없어요. 레일을 따라 밀 수는 있어요.");
    }
    return executePhysicalAction(world, action);
  },
  advance: stillWorld,
  complete: (world) => samePlace(world.entities["05-learn-planter"], world.entities["05-learn-rail-end"]),
};

function storehouseUseWorld(): WorldState {
  return scene(6, "06-learn-1", [
    object("06-learn-key", "놋쇠 열쇠", "06-learn-1", 0, { kind: "key", slot: "small", opens: "06-learn-lock" }, { material: "metal", movable: true, weight: 0.1 }),
    object("06-learn-lock", "낮은 문의 자물쇠", "06-learn-1", 1, { kind: "lock", locked: true, open: false, accepts: "06-learn-key" }, { material: "metal" }),
  ]);
}

const storehouseUse: SegmentDefinition = {
  id: "06-learn-1",
  title: "열쇠가 남는 곳",
  goal: "놋쇠 열쇠를 자물쇠에 넣어 낮은 문을 연다.",
  description: "문이 열려도 사용한 열쇠는 자물쇠에 그대로 남는다.",
  hints: ["열쇠는 손이 닿는 선반에 있어요.", "자물쇠를 열려면 열쇠를 그곳에 놓아야 해요.", "열쇠를 챙겨 자물쇠에 넣으세요."],
  enter: storehouseUseWorld,
  advance: (world) => tick(world, (next) => {
    const inserted = next.entities["06-learn-key"].parent === "06-learn-lock";
    next.entities["06-learn-lock"].properties.locked = !inserted;
    next.entities["06-learn-lock"].properties.open = inserted;
  }),
  complete: (world) => world.entities["06-learn-key"].parent === "06-learn-lock"
    && world.entities["06-learn-lock"].properties.open === true,
};

function successfulStorehouseUse(): WorldState {
  const world = storehouseUseWorld();
  const key = world.entities["06-learn-key"];
  const lock = world.entities["06-learn-lock"];
  key.parent = lock.id;
  key.location = { ...lock.location };
  lock.properties.locked = false;
  lock.properties.open = true;
  return world;
}

const storehouseRecover: SegmentDefinition = {
  id: "06-learn-2",
  title: "다시 손에",
  goal: "열린 문 자물쇠에 남은 놋쇠 열쇠를 다시 챙긴다.",
  description: "앞 장면에서 열린 문과 꽂힌 열쇠의 실제 상태를 그대로 이어받는다.",
  hints: ["열쇠는 사라지지 않았어요.", "열린 문은 열쇠를 빼도 그대로 남아요.", "자물쇠의 열쇠를 다시 챙기세요."],
  enter: (previous) => {
    const next = structuredClone(previous?.segmentId === "06-learn-1" ? previous : successfulStorehouseUse());
    next.segmentId = "06-learn-2";
    next.segmentStartedAt = next.tick;
    next.visible = ["06-learn-key", "letter"];
    return next;
  },
  advance: stillWorld,
  complete: (world) => world.entities["06-learn-key"].parent === "hero"
    && world.actors.hero.carrying.includes("06-learn-key")
    && world.entities["06-learn-lock"].properties.open === true,
};

const theatreCall: SegmentDefinition = {
  id: "07-learn-1",
  title: "등지기를 부르는 자리",
  goal: "등지기를 톱니 레일 끝 도착선으로 보낸다.",
  description: "용사는 시작 자리에 남고 등지기만 짧은 직선 레일을 움직인다.",
  hints: ["두 몸 중 움직일 주체를 정하세요.", "등지기는 톱니 레일만 따라가요.", "등지기를 레일 끝 표시로 보내세요."],
  enter: () => withKeeper(scene(7, "07-learn-1", [
    object("07-learn-keeper-line", "톱니 레일 끝 도착선", "07-learn-1", 2, { kind: "rail-stop", rail: true, safe: true }, { material: "metal", reach: 2 }),
  ])),
  advance: stillWorld,
  complete: (world) => world.actors.keeper.location.x === world.entities["07-learn-keeper-line"].location.x
    && world.actors.hero.location.x === 0,
};

const theatreHold: SegmentDefinition = {
  id: "07-learn-2",
  title: "잡고 있는 손",
  goal: "등지기가 되돌이 손잡이를 당긴 채 한 관찰 박자 머문다.",
  description: "손잡이는 놓으면 원위치로 돌아오며 등지기의 손 범위 안에 있다.",
  hints: ["유지는 그 자리에 남는 행동이에요.", "등지기를 주체로 손잡이를 잡으세요.", "등지기가 손잡이를 당겨 잡고 있게 하세요."],
  enter: () => {
    const grip = handle("07-learn-held-handle", "되돌아오는 손잡이", "07-learn-2", "pulled");
    grip.properties.rail = true;
    grip.properties.heldBeats = 0;
    return withKeeper(scene(7, "07-learn-2", [grip]));
  },
  advance: (world) => tick(world, (next) => {
    const grip = next.entities["07-learn-held-handle"];
    grip.properties.heldBeats = grip.properties.held === true ? Number(grip.properties.heldBeats) + 1 : 0;
  }),
  complete: (world) => world.actors.keeper.holding === "07-learn-held-handle"
    && Number(world.entities["07-learn-held-handle"].properties.heldBeats) >= 1,
};

const theatreRelease: SegmentDefinition = {
  id: "07-learn-3",
  title: "건넌 뒤에 놓기",
  goal: "등지기가 막을 들고 있는 동안 건넌 뒤 손잡이를 놓게 한다.",
  description: "막 아래 길은 짧고 위험물이 없으며 용사 도착선이 보인다.",
  hints: ["등지기와 용사에게 서로 다른 역할이 있어요.", "도착선은 유지 임무의 끝이 될 수 있어요.", "등지기는 용사가 막 뒤 도착선에 닿을 때까지 막 손잡이를 잡고, 용사는 그 도착선으로 건너가세요."],
  enter: () => {
    const grip = handle("07-learn-curtain-handle", "낮은 막의 손잡이", "07-learn-3", "raised");
    grip.properties.rail = true;
    return withKeeper(scene(7, "07-learn-3", [
      grip,
      object("07-learn-hero-line", "막 뒤 용사 도착선", "07-learn-3", 2, { kind: "platform", safe: true, heroArrived: false }, { material: "stone", reach: 2 }),
    ]));
  },
  execute: (world, action) => {
    if ((action.verb === "move" || action.verb === "jump" || action.verb === "duck")
      && action.actor === "hero" && action.target === "07-learn-hero-line"
      && world.entities["07-learn-curtain-handle"].properties.raised !== true) {
      return result(world, "blocked", "낮은 막이 아직 길을 막고 있어요.");
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => tick(world, (next) => {
    next.entities["07-learn-hero-line"].properties.heroArrived = next.actors.hero.location.x === next.entities["07-learn-hero-line"].location.x;
  }),
  complete: (world) => world.actors.hero.location.x === world.entities["07-learn-hero-line"].location.x
    && world.actors.keeper.holding === null,
};

const theatreWedge: SegmentDefinition = {
  id: "07-learn-4",
  title: "손 대신 작은 쐐기",
  goal: "등지기가 잡은 손잡이 틈에 쐐기를 끼우고, 놓은 뒤에도 유지한다.",
  description: "손잡이와 고정틀 사이 홈에는 작은 나무 쐐기가 꼭 맞는다.",
  hints: ["먼저 등지기가 손잡이를 유지해야 해요.", "용사는 쐐기를 홈에 놓을 수 있어요.", "등지기는 작은 나무 쐐기가 손잡이와 고정틀 사이 홈에 끼워질 때까지 되돌이 손잡이를 잡고, 용사는 그 쐐기를 홈에 놓으세요."],
  enter: () => {
    const grip = handle("07-learn-wedge-handle", "되돌이 손잡이와 홈", "07-learn-4", "engaged");
    grip.properties.rail = true;
    grip.properties.wedged = false;
    grip.properties.support = "";
    return withKeeper(scene(7, "07-learn-4", [
      grip,
      object("07-learn-wedge", "작은 나무 쐐기", "07-learn-4", 0, { kind: "wedge", slot: "small" }, { material: "wood", movable: true, weight: 0.1 }),
    ]));
  },
  execute: (world, action) => {
    const supported = world.entities["07-learn-wedge"]?.parent === "07-learn-wedge-handle"
      && world.entities["07-learn-wedge-handle"]?.properties.wedged === true;
    const executed = executePhysicalAction(world, action);
    if (executed.outcome === "done" && action.verb === "release" && action.target === "07-learn-wedge-handle" && supported) {
      executed.world.entities["07-learn-wedge-handle"].properties.engaged = true;
    }
    return executed;
  },
  advance: (world) => tick(world, (next) => {
    const grip = next.entities["07-learn-wedge-handle"];
    const wedge = next.entities["07-learn-wedge"];
    if (wedge.parent === grip.id && grip.properties.held === true) {
      grip.properties.wedged = true;
      grip.properties.support = wedge.id;
      grip.properties.engaged = true;
    } else if (wedge.parent === grip.id && grip.properties.wedged !== true) {
      wedge.parent = null;
      grip.properties.engaged = false;
    }
  }),
  complete: (world) => world.entities["07-learn-wedge"].parent === "07-learn-wedge-handle"
    && world.entities["07-learn-wedge-handle"].properties.wedged === true
    && world.entities["07-learn-wedge-handle"].properties.engaged === true
    && world.actors.keeper.holding === null,
};

const fogObserve: SegmentDefinition = {
  id: "08-learn-1",
  title: "난간 너머 보기",
  goal: "확대경으로 관 끝이 닿는 깃발을 확인한다.",
  description: "관은 갈림이 없지만 끝부분은 난간 뒤에 가려져 있다.",
  hints: ["깃발만 보는 것과 연결을 보는 것은 달라요.", "확대경에서 관 끝을 확인할 수 있어요.", "안전 관측대 확대경으로 관 끝의 깃발에 이어진 관 끝을 살펴보세요."],
  enter: () => scene(8, "08-learn-1", [
    object("08-learn-lens", "안전 관측대 확대경", "08-learn-1", 0, { kind: "lens", aligned: false, reveals: "08-learn-flag" }, { material: "glass" }),
    object("08-learn-flag", "관 끝의 깃발", "08-learn-1", 2, { kind: "flag", connectedTo: "08-learn-lens", connectionConfirmed: false }, { material: "cloth", reach: 2 }),
  ]),
  execute: (world, action) => {
    if (action.verb === "observe" && action.target === "08-learn-flag" && action.instrument === "08-learn-lens") {
      const actor = world.actors[action.actor];
      const lens = world.entities["08-learn-lens"];
      const flag = world.entities["08-learn-flag"];
      const lensInReach = actor && lens && actor.location.region === lens.location.region
        && Math.hypot(actor.location.x - lens.location.x, actor.location.y - lens.location.y) <= lens.reach;
      if (!lensInReach || !flag || !world.visible.includes(lens.id) || !world.visible.includes(flag.id)) {
        return result(world, "clarification", "확대경과 관 끝 깃발이 함께 보이는 관측 자리에서 살펴봐야 해요.");
      }
      const next = structuredClone(world);
      next.entities["08-learn-lens"].properties.aligned = true;
      next.entities["08-learn-flag"].properties.connectionConfirmed = true;
      next.facts.push({ entity: "08-learn-flag", property: "connectionConfirmed", value: true, attempt: next.attempt, tick: next.tick });
      return result(next, "done", "확대경으로 관 끝이 깃발에 실제로 연결된 모습을 확인했어요.");
    }
    const executed = executePhysicalAction(world, action);
    if (executed.outcome === "done" && action.verb === "observe" && action.target === "08-learn-lens") {
      executed.world.entities["08-learn-lens"].properties.aligned = true;
      executed.world.entities["08-learn-flag"].properties.connectionConfirmed = true;
    }
    return executed;
  },
  advance: stillWorld,
  complete: (world) => world.entities["08-learn-lens"].properties.aligned === true
    && world.entities["08-learn-flag"].properties.connectionConfirmed === true,
};

const fogRemember: SegmentDefinition = {
  id: "08-learn-2",
  title: "안개 뒤의 손잡이",
  goal: "확인한 손잡이를 당겨 연결된 문을 연다.",
  description: "관측창에서 문까지 이어진 관은 손잡이 쪽에서만 안개에 가려진다.",
  hints: ["관측창에서 연결을 확인할 수 있어요.", "안개는 관의 중간만 가려요.", "문과 이어진 손잡이를 당겨 보세요."],
  enter: () => scene(8, "08-learn-2", [
    object("08-learn-window", "고정 관측창", "08-learn-2", 0, { kind: "window", showsConnection: "08-learn-door-handle", observed: false }, { material: "glass" }),
    object("08-learn-door-handle", "문과 이어진 손잡이", "08-learn-2", 1, { kind: "handle", pulled: false, doorOpen: false, connectedTo: "door" }, { material: "metal" }),
  ]),
  execute: (world, action) => {
    if (action.verb === "pull" && action.target === "08-learn-door-handle") {
      const actor = world.actors[action.actor];
      const hand = world.entities[action.target];
      if (!actor || !hand || actor.location.region !== hand.location.region || Math.abs(actor.location.x - hand.location.x) > hand.reach) {
        return result(world, "clarification", "문 손잡이는 현재 손이 닿는 범위 밖에 있어요.");
      }
      const next = structuredClone(world);
      next.entities[action.target].properties.pulled = true;
      next.entities[action.target].properties.doorOpen = true;
      return result(next, "done", "손잡이를 당겨 이어진 문을 열었어요.");
    }
    const executed = executePhysicalAction(world, action);
    if (executed.outcome === "done" && action.verb === "observe" && action.target === "08-learn-window") {
      executed.world.entities["08-learn-window"].properties.observed = true;
    }
    return executed;
  },
  advance: stillWorld,
  complete: (world) => world.entities["08-learn-door-handle"].properties.doorOpen === true,
};

const fogJoint: SegmentDefinition = {
  id: "08-learn-3",
  title: "겹친 관의 이음새",
  goal: "볼트로 실제 연결된 밸브를 열어 작은 풍차를 돌린다.",
  description: "두 관은 교차하지만 볼트 이음부가 있는 한 관만 풍차에 연결된다.",
  hints: ["겹쳐 보이는 선이 모두 이어진 것은 아니에요.", "볼트가 있는 이음새를 따라가세요.", "풍차와 이어진 밸브를 돌리세요."],
  enter: () => scene(8, "08-learn-3", [
    object("08-learn-valve", "손으로 돌리는 밸브", "08-learn-3", 0, { kind: "valve", on: false, boltedTo: "08-learn-windmill" }),
    object("08-learn-windmill", "작은 풍차", "08-learn-3", 1, { kind: "fan", spinning: false, connectedFrom: "08-learn-valve", decorativePipeActive: false }),
  ]),
  advance: (world) => tick(world, (next) => {
    next.entities["08-learn-windmill"].properties.spinning = next.entities["08-learn-valve"].properties.on === true;
    next.entities["08-learn-windmill"].properties.decorativePipeActive = false;
  }),
  complete: (world) => world.entities["08-learn-windmill"].properties.spinning === true,
};

function towerSupportWorld(): WorldState {
  return scene(9, "09-learn-1", [
    object("09-learn-support", "나무 받침", "09-learn-1", 0, { kind: "support", slot: "large", loadBearing: true }, { material: "wood", movable: true, weight: 0.6 }),
    object("09-learn-shaft", "처진 종축과 밑 홈", "09-learn-1", 1, { kind: "shaft", level: false, supported: false, support: "", safeLedge: true }, { material: "metal", capacity: 2 }),
  ]);
}

const towerSupport: SegmentDefinition = {
  id: "09-learn-1",
  title: "탑의 아래 받침",
  goal: "나무 받침을 종축 밑 홈에 넣어 축을 수평으로 받친다.",
  description: "처진 종축은 안전턱에 걸쳐 있고 받침이 들어갈 홈이 보인다.",
  hints: ["받침은 축 옆이 아니라 아래에서 하중을 받아요.", "밑 홈과 받침의 폭이 같아요.", "나무 받침을 종축 밑 홈으로 미세요."],
  enter: towerSupportWorld,
  advance: (world) => tick(world, (next) => {
    const support = next.entities["09-learn-support"];
    const shaft = next.entities["09-learn-shaft"];
    const supported = samePlace(support, shaft);
    shaft.properties.supported = supported;
    shaft.properties.level = supported;
    shaft.properties.support = supported ? support.id : "";
  }),
  complete: (world) => world.entities["09-learn-shaft"].properties.level === true
    && world.entities["09-learn-shaft"].properties.support === "09-learn-support",
};

function successfulTowerSupport(): WorldState {
  const world = towerSupportWorld();
  world.entities["09-learn-support"].location = { ...world.entities["09-learn-shaft"].location };
  world.entities["09-learn-shaft"].properties.supported = true;
  world.entities["09-learn-shaft"].properties.level = true;
  world.entities["09-learn-shaft"].properties.support = "09-learn-support";
  return world;
}

const towerDoor: SegmentDefinition = {
  id: "09-learn-2",
  title: "윗방에 이어진 축",
  goal: "아래에서 받친 축이 열어 둔 문을 지나 도착선에 닿는다.",
  description: "앞 장면의 받침과 종축 상태가 윗방 걸쇠에 그대로 이어진다.",
  hints: ["아래의 받침 상태는 그대로 남아 있어요.", "수평 축이 윗방 걸쇠를 풀어요.", "열린 문 너머 도착선으로 가세요."],
  enter: (previous) => {
    const next = structuredClone(previous?.segmentId === "09-learn-1" ? previous : successfulTowerSupport());
    next.segmentId = "09-learn-2";
    next.segmentStartedAt = next.tick;
    const open = next.entities["09-learn-shaft"].properties.level === true
      && next.entities["09-learn-shaft"].properties.support === "09-learn-support";
    next.entities["09-learn-upper-latch"] = object("09-learn-upper-latch", "축 끝과 이어진 문 걸쇠", "09-learn-2", 1, { kind: "door", open, connectedTo: "09-learn-shaft" });
    next.entities["09-learn-upper-line"] = object("09-learn-upper-line", "문 너머 도착선", "09-learn-2", 2, { kind: "platform", safe: true }, { material: "stone", reach: 2 });
    next.actors.hero.location = { region: "09-learn-2", x: 0, y: 0 };
    next.entities.letter.location = { ...next.actors.hero.location };
    next.visible = ["09-learn-upper-latch", "09-learn-upper-line", "letter"];
    return next;
  },
  execute: (world, action) => {
    if ((action.verb === "move" || action.verb === "jump" || action.verb === "duck")
      && action.target === "09-learn-upper-line"
      && world.entities["09-learn-upper-latch"].properties.open !== true) {
      return result(world, "blocked", "아래 종축이 수평으로 받쳐지지 않아 윗방 걸쇠가 길을 막고 있어요.");
    }
    return executePhysicalAction(world, action);
  },
  advance: stillWorld,
  complete: (world) => world.actors.hero.location.x === world.entities["09-learn-upper-line"].location.x,
};

const wardenArm: SegmentDefinition = {
  id: "10-learn-1",
  title: "팔이 비켜난 자리",
  goal: "문지기 팔이 몸 안으로 완전히 들어간 뒤 도착선으로 간다.",
  description: "팔은 짧은 길을 가로막는 자세와 몸 안으로 들어간 자세를 반복한다.",
  hints: ["팔과 부딪칠 필요는 없어요.", "몸 안으로 완전히 들어간 자세를 기다리세요.", "팔이 비키면 길 끝 표시로 가세요."],
  enter: () => scene(10, "10-learn-1", [
    object("10-learn-arm", "길을 가로막는 문지기 팔", "10-learn-1", 1, { kind: "hazard", position: "extended", blocksPath: true, rangeStart: 1, rangeEnd: 2 }),
    object("10-learn-arm-line", "길 끝 도착선", "10-learn-1", 2, { kind: "platform", safe: true }, { material: "stone", reach: 2 }),
  ]),
  execute: (world, action) => {
    if ((action.verb === "move" || action.verb === "jump" || action.verb === "duck")
      && action.target === "10-learn-arm-line"
      && world.entities["10-learn-arm"].properties.blocksPath === true) {
      return result(world, "blocked", "문지기 팔이 실제 길을 가로막아 안전선에서 멈췄어요.");
    }
    return executePhysicalAction(world, action);
  },
  advance: (world) => tick(world, (next) => {
    const phase = (next.tick - (next.segmentStartedAt ?? 0)) % 4;
    const withdrawn = phase >= 2;
    next.entities["10-learn-arm"].properties.position = withdrawn ? "withdrawn" : "extended";
    next.entities["10-learn-arm"].properties.blocksPath = !withdrawn;
  }),
  complete: (world) => world.actors.hero.location.x === world.entities["10-learn-arm-line"].location.x,
};

const wardenWind: SegmentDefinition = {
  id: "10-learn-2",
  title: "바람을 옆으로",
  goal: "바람판을 돌려 출구 천의 바람을 옆 배출구로 보낸다.",
  description: "바람판에는 출구 천과 고정 배출구로 향하는 두 방향만 표시돼 있다.",
  hints: ["용사는 난간 안에서 안전해요.", "바람판의 두 방향을 확인하세요.", "바람판을 옆 배출구 방향으로 돌리세요."],
  enter: () => scene(10, "10-learn-2", [
    object("10-learn-wind-plate", "난간 안 바람판", "10-learn-2", 0, { kind: "valve", orientation: 0, route: "cloth", ventActive: false }),
    object("10-learn-exit-cloth", "바람을 받는 출구 천", "10-learn-2", 1, { kind: "flag", flapping: true, connectedFrom: "10-learn-wind-plate" }, { material: "cloth" }),
  ]),
  advance: (world) => tick(world, (next) => {
    const plate = next.entities["10-learn-wind-plate"];
    const vent = Number(plate.properties.orientation) % 2 === 1;
    plate.properties.route = vent ? "side-vent" : "cloth";
    plate.properties.ventActive = vent;
    next.entities["10-learn-exit-cloth"].properties.flapping = !vent;
  }),
  complete: (world) => world.entities["10-learn-wind-plate"].properties.ventActive === true
    && world.entities["10-learn-exit-cloth"].properties.flapping === false,
};

export const ONBOARDING_STAGES: Partial<Record<StageId, readonly SegmentDefinition[]>> = {
  2: [rainMove, rainFloat, rainBoard],
  3: [kitchenDoor, kitchenSteam],
  4: [forgeLatch, forgePipe],
  5: [gardenGravity, gardenRail],
  6: [storehouseUse, storehouseRecover],
  7: [theatreCall, theatreHold, theatreRelease, theatreWedge],
  8: [fogObserve, fogRemember, fogJoint],
  9: [towerSupport, towerDoor],
  10: [wardenArm, wardenWind],
};
