import { describe, expect, it } from "vitest";
import { writeProgram } from "../src/campaign/notebook";
import { createCursor, stepProgram, type ActionExecutor } from "../src/campaign/program";
import { advanceStage, createStageRun, departStage, type StageDynamics } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";
const world = (): WorldState => ({ stageId: 7, segmentId: "07-1", tick: 0, attempt: 1, entities: {}, actors: {}, visible: [], facts: [] });
const action = (actor: "hero" | "keeper", verb: PhysicalAction["verb"], target = "handle"): PhysicalAction => ({ kind: "action", actor, verb, target });
const execute: ActionExecutor = (state) => ({ world: { ...state, tick: state.tick + 1 }, outcome: "done", reason: "executed" });
describe("persistent procedure cursor", () => {
  it("resumes a serialized sequential cursor without repeating its first action", () => {
    const node: ProgramNode = { kind: "sequence", children: [action("hero", "push"), action("hero", "climb")] };
    const first = stepProgram(world(), node, createCursor(), execute);
    expect(first.actions[0].verb).toBe("push");
    const restored = JSON.parse(JSON.stringify(first));
    const second = stepProgram(restored.world, node, restored.cursor, execute);
    expect(second.actions[0].verb).toBe("climb");
    expect(second.outcome).toBe("done");
    expect(stepProgram(second.world, node, second.cursor, execute).actions).toEqual([]);
  });
  it("keeps the selected branch when the original condition changes", () => {
    const state = world();
    state.facts.push({ entity: "handle", property: "open", value: false, attempt: 1, tick: 0 });
    const node: ProgramNode = { kind: "if", condition: { kind: "property", entity: "handle", property: "open", value: false, comparison: "eq", source: "remembered" }, then: { kind: "sequence", children: [action("hero", "open"), action("hero", "move")] } };
    const first = stepProgram(state, node, createCursor(), execute);
    first.world.facts.push({ entity: "handle", property: "open", value: true, attempt: 1, tick: 1 });
    const second = stepProgram(first.world, node, first.cursor, execute);
    expect(second.actions[0].verb).toBe("move");
  });
  it("maintains an until action once and does not invent an unknown endpoint", () => {
    const node: ProgramNode = { kind: "until", body: action("keeper", "hold"), condition: { kind: "property", entity: "handle", property: "open", value: true, comparison: "eq", source: "remembered" } };
    const first = stepProgram(world(), node, createCursor(), execute);
    const second = stepProgram(first.world, node, first.cursor, execute);
    expect(first.actions).toHaveLength(1);
    expect(second.actions).toHaveLength(0);
    expect(second.outcome).toBe("waiting");
    second.world.facts.push({ entity: "handle", property: "open", value: true, attempt: 1, tick: 2 });
    const third = stepProgram(second.world, node, second.cursor, execute);
    expect(third.outcome).toBe("done");
    expect(third.actions[0].verb).toBe("release");
  });
  it("advances independent roles together and rejects a duplicated actor before mutation", () => {
    const valid: ProgramNode = { kind: "parallel", children: [action("keeper", "hold"), action("hero", "move")] };
    expect(stepProgram(world(), valid, createCursor(), execute).actions).toHaveLength(2);
    const invalid: ProgramNode = { kind: "parallel", children: [action("hero", "hold"), action("hero", "move")] };
    const result = stepProgram(world(), invalid, createCursor(), execute);
    expect(result.outcome).toBe("clarification");
    expect(result.world.tick).toBe(0);
    expect(result.actions).toHaveLength(0);
  });
});

function cooperationWorld(open = false): WorldState {
  return {
    stageId: 7,
    segmentId: "07-order",
    tick: 0,
    attempt: 1,
    entities: {
      gate: { id: "gate", name: "막", description: "유지형 막", material: "metal", movable: false, weight: 1, capacity: 0, reach: 1, location: { region: "07-order", x: 1, y: 0 }, parent: null, properties: { open } },
      handle: { id: "handle", name: "손잡이", description: "막 손잡이", material: "metal", movable: false, weight: 1, capacity: 0, reach: 1, location: { region: "07-order", x: 0, y: 0 }, parent: null, properties: { held: false } },
      exit: { id: "exit", name: "안전 원", description: "막 건너편", material: "stone", movable: false, weight: 1, capacity: 0, reach: 1, location: { region: "07-order", x: 2, y: 0 }, parent: null, properties: { arrived: false } },
    },
    actors: {
      hero: { id: "hero", location: { region: "07-order", x: 0, y: 0 }, holding: null, carrying: [], riding: null, capabilities: ["weight:1"] },
      keeper: { id: "keeper", location: { region: "07-order", x: 0, y: 0 }, holding: null, carrying: [], riding: null, capabilities: ["rail-only", "max-weight:1"] },
    },
    visible: ["gate", "handle", "exit"],
    facts: [],
  };
}

const cooperationExecute: ActionExecutor = (state, physicalAction) => {
  const next = structuredClone(state);
  next.tick += 1;
  if (physicalAction.verb === "hold") {
    next.entities.handle.properties.held = true;
    next.entities.gate.properties.open = true;
    return { world: next, outcome: "done", reason: "held" };
  }
  if (physicalAction.verb === "release") {
    next.entities.handle.properties.held = false;
    next.entities.gate.properties.open = false;
    return { world: next, outcome: "done", reason: "released" };
  }
  if (physicalAction.verb === "move") {
    if (next.entities.gate.properties.open !== true) return { world: state, outcome: "failure", reason: "closed" };
    next.entities.exit.properties.arrived = true;
    return { world: next, outcome: "done", reason: "crossed" };
  }
  if (physicalAction.verb === "open") {
    next.entities.exit.properties.arrived = true;
    return { world: next, outcome: "done", reason: "endpoint changed" };
  }
  return { world: next, outcome: "done", reason: "executed" };
};

const arrived = { kind: "property", entity: "exit", property: "arrived", value: true, comparison: "eq", source: "visible" } as const;

it("restores an atomic move in transit and advances its sequence only on arrival", () => {
  const program: InstructionProgram = {
    version: 2, id: "walking", text: "안전 원까지 간 뒤 살펴본다.", model: "test",
    scope: { stageId: 7, region: "07-order" }, guard: false,
    body: { kind: "sequence", children: [action("hero", "move", "exit"), action("hero", "observe", "exit")] },
  };
  const executed: string[] = [];
  const dynamics: StageDynamics = {
    execute: (current, command) => {
      executed.push(command.verb);
      const next = structuredClone(current);
      if (command.verb === "move") {
        next.actors.hero.location.x += 1;
        return { world: next, outcome: next.actors.hero.location.x === 2 ? "done" : "progress", reason: "한 칸 이동" };
      }
      return { world: next, outcome: "done", reason: "살펴봄" };
    },
    advance: (current) => ({ world: { ...current, tick: current.tick + 1 }, events: [], canChange: false }),
    segmentComplete: () => false, nextSegment: () => null, sealAfter: () => null,
  };
  let run = createStageRun("walking-save", cooperationWorld());
  run.notebook = writeProgram(run.notebook, program);
  run = advanceStage(departStage(run), dynamics);
  expect(run.world.actors.hero.location.x).toBe(1);
  expect(run.world.tick).toBe(1);
  expect(run.execution.active?.cursor.index).toBe(0);
  expect(run.events.at(-1)?.outcome).toBe("safe");
  const restored = parseStageRun(JSON.parse(JSON.stringify(run)));
  expect(restored).not.toBeNull();
  run = advanceStage(restored!, dynamics);
  expect(run.world.actors.hero.location.x).toBe(2);
  expect(run.world.tick).toBe(2);
  expect(run.execution.active?.cursor.index).toBe(1);
  run = advanceStage(run, dynamics);
  expect(executed).toEqual(["move", "move", "observe"]);
  expect(run.world.tick).toBe(3);
});

function crossingParallel(reverse: boolean): ProgramNode {
  const maintain: ProgramNode = { kind: "until", body: action("keeper", "hold"), condition: arrived };
  const move = action("hero", "move", "exit");
  return { kind: "parallel", children: reverse ? [move, maintain] : [maintain, move] };
}

describe("parallel physical overlap ordering", () => {
  it("establishes a hold before locomotion in either clause order", () => {
    const forward = stepProgram(cooperationWorld(), crossingParallel(false), createCursor(), cooperationExecute);
    const reversed = stepProgram(cooperationWorld(), crossingParallel(true), createCursor(), cooperationExecute);
    for (const result of [forward, reversed]) {
      expect(result.outcome).toBe("progress");
      expect(result.actions.map((item) => item.verb)).toEqual(["hold", "move"]);
      expect(result.world.entities.gate.properties.open).toBe(true);
      expect(result.world.entities.exit.properties.arrived).toBe(true);
      expect(result.world.tick).toBe(2);
    }
    expect(forward.world).toEqual(reversed.world);
  });

  it("resumes a serialized maintained hold and releases at its endpoint", () => {
    const node = crossingParallel(true);
    const first = stepProgram(cooperationWorld(), node, createCursor(), cooperationExecute);
    const restored = JSON.parse(JSON.stringify(first)) as typeof first;
    const second = stepProgram(restored.world, node, restored.cursor, cooperationExecute);
    expect(second.outcome).toBe("done");
    expect(second.actions.map((item) => item.verb)).toEqual(["release"]);
    expect(second.world.entities.gate.properties.open).toBe(false);
    expect(second.world.entities.exit.properties.arrived).toBe(true);
  });

  it("runs an explicit release after locomotion in the same boundary", () => {
    const node: ProgramNode = { kind: "parallel", children: [action("keeper", "release"), action("hero", "move", "exit")] };
    const result = stepProgram(cooperationWorld(true), node, createCursor(), cooperationExecute);
    expect(result.outcome).toBe("done");
    expect(result.actions.map((item) => item.verb)).toEqual(["move", "release"]);
    expect(result.world.entities.exit.properties.arrived).toBe(true);
    expect(result.world.entities.gate.properties.open).toBe(false);
  });

  it("freezes a peeked if branch through a sequence before an earlier hold changes its predicate", () => {
    const conditional: ProgramNode = {
      kind: "sequence",
      children: [{
        kind: "if",
        condition: { kind: "property", entity: "gate", property: "open", value: false, comparison: "eq", source: "visible" },
        then: action("keeper", "hold"),
        otherwise: action("keeper", "release"),
      }],
    };
    const node: ProgramNode = { kind: "parallel", children: [action("hero", "hold"), conditional] };
    const result = stepProgram(cooperationWorld(), node, createCursor(), cooperationExecute);
    expect(result.outcome).toBe("done");
    expect(result.actions.map((item) => item.verb)).toEqual(["hold", "hold"]);
    expect(result.cursor.children[1].children[0].branch).toBe("then");
    expect(result.world.entities.gate.properties.open).toBe(true);
  });

  it("peeks a release through if and sequence and still runs locomotion first", () => {
    const conditional: ProgramNode = {
      kind: "sequence",
      children: [{
        kind: "if",
        condition: { kind: "property", entity: "gate", property: "open", value: true, comparison: "eq", source: "visible" },
        then: action("keeper", "release"),
        otherwise: action("keeper", "hold"),
      }],
    };
    const node: ProgramNode = { kind: "parallel", children: [conditional, action("hero", "move", "exit")] };
    const result = stepProgram(cooperationWorld(true), node, createCursor(), cooperationExecute);
    expect(result.outcome).toBe("done");
    expect(result.actions.map((item) => item.verb)).toEqual(["move", "release"]);
    expect(result.cursor.children[0].children[0].branch).toBe("then");
    expect(result.world.entities.exit.properties.arrived).toBe(true);
    expect(result.world.entities.gate.properties.open).toBe(false);
  });

  it("keeps an initially unknown branch unresolved for the current boundary", () => {
    const state = cooperationWorld();
    delete state.entities.handle.properties.held;
    const conditional: ProgramNode = {
      kind: "sequence",
      children: [{
        kind: "if",
        condition: { kind: "property", entity: "handle", property: "held", value: true, comparison: "eq", source: "visible" },
        then: action("keeper", "open"),
        otherwise: action("keeper", "close"),
      }],
    };
    const node: ProgramNode = { kind: "parallel", children: [action("hero", "hold"), conditional] };
    const first = stepProgram(state, node, createCursor(), cooperationExecute);
    expect(first.actions.map((item) => item.verb)).toEqual(["hold"]);
    expect(first.cursor.children[1].children[0].branch).toBeNull();
    const second = stepProgram(first.world, node, first.cursor, cooperationExecute);
    expect(second.actions.map((item) => item.verb)).toEqual(["open"]);
    expect(second.cursor.children[1].children[0].branch).toBe("then");
  });

  it("applies an until endpoint changed by a sibling only on the next boundary", () => {
    const node: ProgramNode = { kind: "parallel", children: [
      action("hero", "open", "exit"),
      { kind: "until", body: action("keeper", "hold"), condition: arrived },
    ] };
    const cursor = {
      ...createCursor(),
      status: "running" as const,
      children: [
        createCursor([0]),
        { ...createCursor([1]), status: "running" as const, index: 1 },
      ],
    };
    const state = cooperationWorld(true);
    state.entities.handle.properties.held = true;
    const first = stepProgram(state, node, cursor, cooperationExecute);
    expect(first.actions.map((item) => item.verb)).toEqual(["open"]);
    expect(first.world.entities.handle.properties.held).toBe(true);
    expect(first.cursor.children[1].status).toBe("running");
    const second = stepProgram(first.world, node, first.cursor, cooperationExecute);
    expect(second.actions.map((item) => item.verb)).toEqual(["release"]);
    expect(second.world.entities.handle.properties.held).toBe(false);
  });

  it("applies a wait condition changed by a sibling only on the next boundary", () => {
    const node: ProgramNode = { kind: "parallel", children: [
      action("hero", "open", "exit"),
      { kind: "wait", until: arrived },
    ] };
    const first = stepProgram(cooperationWorld(), node, createCursor(), cooperationExecute);
    expect(first.actions.map((item) => item.verb)).toEqual(["open"]);
    expect(first.cursor.children[1].status).toBe("running");
    const second = stepProgram(first.world, node, first.cursor, cooperationExecute);
    expect(second.outcome).toBe("done");
    expect(second.actions).toEqual([]);
  });

  it("orders and resumes a serialized nested parallel without losing child indices", () => {
    const maintained: ProgramNode = { kind: "until", body: action("keeper", "hold"), condition: arrived };
    const nested: ProgramNode = { kind: "parallel", children: [
      { kind: "wait", until: arrived },
      maintained,
    ] };
    const node: ProgramNode = { kind: "parallel", children: [action("hero", "move", "exit"), nested] };
    const first = stepProgram(cooperationWorld(), node, createCursor(), cooperationExecute);
    expect(first.actions.map((item) => item.verb)).toEqual(["hold", "move"]);
    expect(first.cursor.children[1].children).toHaveLength(2);
    const restored = JSON.parse(JSON.stringify(first)) as typeof first;
    const second = stepProgram(restored.world, node, restored.cursor, cooperationExecute);
    expect(second.outcome).toBe("done");
    expect(second.actions.map((item) => item.verb)).toEqual(["release"]);
    expect(second.cursor.children[0].path).toEqual([0]);
    expect(second.cursor.children[1].path).toEqual([1]);
  });

  it("still rejects one actor in two parallel roles before executing anything", () => {
    let calls = 0;
    const counting: ActionExecutor = (state, physicalAction) => {
      calls += 1;
      return cooperationExecute(state, physicalAction);
    };
    const node: ProgramNode = { kind: "parallel", children: [action("hero", "hold"), action("hero", "move", "exit")] };
    const state = cooperationWorld();
    const result = stepProgram(state, node, createCursor(), counting);
    expect(result.outcome).toBe("clarification");
    expect(result.world).toBe(state);
    expect(result.actions).toEqual([]);
    expect(calls).toBe(0);
  });
});

it("keeps an unexecuted sequence cursor pristine when an earlier parallel branch blocks", () => {
  const state = cooperationWorld();
  const body: ProgramNode = { kind: "parallel", children: [
    action("hero", "move", "exit"),
    { kind: "sequence", children: [action("keeper", "open", "handle")] },
  ] };
  const program: InstructionProgram = {
    version: 2,
    id: "blocked-parallel",
    text: "용사는 닫힌 길로 가고 등지기는 장치를 연다.",
    model: "test",
    scope: { stageId: 7, region: "07-order" },
    guard: false,
    body,
  };
  let run = createStageRun("blocked-cursor", state);
  run.notebook = writeProgram(run.notebook, program);
  run = departStage(run);
  const dynamics: StageDynamics = {
    execute: (current, physicalAction) => physicalAction.verb === "move"
      ? { world: current, outcome: "blocked", reason: "닫힌 길" }
      : cooperationExecute(current, physicalAction),
    advance: (current) => ({ world: current, events: [], canChange: false }),
    segmentComplete: () => false,
    nextSegment: () => null,
    sealAfter: () => null,
  };
  run = advanceStage(run, dynamics);
  expect(run.phase).toBe("blocked");
  expect(run.execution.active?.cursor.children).toHaveLength(2);
  expect(run.execution.active?.cursor.children[1]).toEqual(createCursor([1]));
  const restored = parseStageRun(JSON.parse(JSON.stringify(run)));
  expect(restored).not.toBeNull();
  expect(restored?.execution.active?.cursor.children).toHaveLength(2);
  expect(restored?.execution.active?.cursor.children[1]).toEqual(createCursor([1]));
});
