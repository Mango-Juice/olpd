import { expect, it } from "vitest";
import { createCursor, type ActionExecutor } from "../src/campaign/program";
import { createExecution, enterEncounter, scheduleStep } from "../src/campaign/scheduler";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const world: WorldState = {
  stageId: 5, segmentId: "05-2", tick: 0, attempt: 1,
  entities: Object.fromEntries(["box", "shelter"].map((id) => [id, {
    id, name: id, description: id, material: "wood" as const, movable: true, weight: 1,
    capacity: 1, reach: 1, parent: null, location: { region: "fixture", x: 0, y: 0 }, properties: {},
  }])),
  actors: {}, visible: [], facts: [],
};
const execute: ActionExecutor = (state) => ({ world: state, outcome: "done", reason: "ok" });
const action = (verb: PhysicalAction["verb"], target = "box"): PhysicalAction => ({ kind: "action", actor: "hero", verb, target });
const program = (id: string, body: ProgramNode, patch: Partial<InstructionProgram> = {}): InstructionProgram => ({
  version: 2, id, text: id, model: "fixture", scope: {}, guard: false, body, ...patch,
});
const alarm = { kind: "property", entity: "alarm", property: "active", value: true, comparison: "eq", source: "remembered" } as const;
const withAlarm = (active: boolean): WorldState => ({
  ...world, facts: [{ entity: "alarm", property: "active", value: active, attempt: 1, tick: 1 }],
});

it("reselects a completed action at every decision, including after an encounter change", () => {
  const rule = program("advance", action("move"));
  const first = scheduleStep(world, [rule], createExecution(), execute);
  const second = scheduleStep(world, [rule], first.execution, execute);
  const third = scheduleStep(world, [rule], enterEncounter(second.execution), execute);
  for (const result of [first, second, third]) {
    expect(result.instructionId).toBe("advance");
    expect(result.step?.actions[0].verb).toBe("move");
    expect(result.execution.completed).toEqual([]);
  }
});

it("falls through a false root if without else, then selects it when true", () => {
  const upper = program("conditional", { kind: "if", condition: alarm, then: action("duck", "shelter") });
  const lower = program("lower", action("push"));
  expect(scheduleStep(withAlarm(false), [upper, lower], createExecution(), execute).instructionId).toBe("lower");
  expect(scheduleStep(withAlarm(true), [upper, lower], createExecution(), execute).step?.actions[0].verb).toBe("duck");
});

it("discards a root if's old branch cursor after its condition becomes false", () => {
  const upper = program("conditional", {
    kind: "if", condition: alarm,
    then: { kind: "sequence", children: [action("push"), action("climb")] },
  });
  const lower = program("lower", action("duck", "shelter"));
  const first = scheduleStep(withAlarm(true), [upper, lower], createExecution(), execute);
  expect(first.step?.actions[0].verb).toBe("push");
  const second = scheduleStep(withAlarm(false), [upper, lower], first.execution, execute);
  expect(second.step?.actions[0].verb).toBe("duck");
  const third = scheduleStep(withAlarm(true), [upper, lower], second.execution, execute);
  expect(third.step?.actions[0].verb).toBe("push");
});

it("does not fall through an unknown higher condition", () => {
  const upper = program("unknown", { kind: "if", condition: alarm, then: action("duck", "shelter") });
  const lower = program("lower", action("push"));
  const result = scheduleStep(world, [upper, lower], createExecution(), () => { throw new Error("must not execute"); });
  expect(result.instructionId).toBe("unknown");
  expect(result.step).toMatchObject({ outcome: "clarification", actions: [] });
  const topCondition = program("top-condition", action("duck", "shelter"), { condition: alarm });
  expect(scheduleStep(world, [topCondition, lower], createExecution(), execute).instructionId).toBe("top-condition");
});

it("lets any higher matching rule interrupt, and resumes a lower procedure only after re-selection", () => {
  const upper = program("upper", action("duck", "shelter"), { condition: alarm });
  const lower = program("lower", { kind: "sequence", children: [action("push"), action("climb")] });
  const first = scheduleStep(withAlarm(false), [upper, lower], createExecution(), execute);
  expect(first.step?.actions[0].verb).toBe("push");
  const second = scheduleStep(withAlarm(true), [upper, lower], first.execution, execute);
  expect(second.interrupted).toBe("lower");
  expect(second.step?.actions[0].verb).toBe("duck");
  expect(second.execution.suspended.map((item) => item.instructionId)).toEqual(["lower"]);
  const third = scheduleStep(withAlarm(true), [upper, lower], second.execution, execute);
  expect(third.step?.actions[0].verb).toBe("duck");
  const fourth = scheduleStep(withAlarm(false), [upper, lower], third.execution, execute);
  expect(fourth.step?.actions[0].verb).toBe("climb");
  expect(fourth.execution.suspended).toEqual([]);
});

it("keeps an unconditional higher rule ahead of an older suspended procedure", () => {
  const upper = program("upper", action("move"));
  const lower = program("lower", { kind: "sequence", children: [action("push"), action("climb")] });
  const execution = createExecution();
  execution.active = { instructionId: "lower", cursor: createCursor() };
  const first = scheduleStep(world, [upper, lower], execution, execute);
  const second = scheduleStep(world, [upper, lower], first.execution, execute);
  expect(first.interrupted).toBe("lower");
  expect(first.step?.actions[0].verb).toBe("move");
  expect(second.step?.actions[0].verb).toBe("move");
  expect(second.execution.suspended.map((item) => item.instructionId)).toEqual(["lower"]);
});

it("ignores completed and match flags retained in an old save", () => {
  const rule = program("old", action("push"));
  const execution = { ...createExecution(), completed: ["0:old"], matches: { old: false } };
  const result = scheduleStep(world, [rule], execution, execute);
  expect(result.step?.actions[0].verb).toBe("push");
  expect(result.execution.completed).toEqual([]);
  expect(result.execution.matches).toEqual({});
});

it("invalidates a root if cursor when its selected branch changes", () => {
  const rule = program("branch", {
    kind: "if", condition: alarm,
    then: { kind: "sequence", children: [action("push"), action("climb")] },
    otherwise: { kind: "sequence", children: [action("duck", "shelter"), action("move")] },
  });
  const first = scheduleStep(withAlarm(true), [rule], createExecution(), execute);
  expect(first.step?.actions[0].verb).toBe("push");
  const second = scheduleStep(withAlarm(false), [rule], first.execution, execute);
  expect(second.step?.actions[0].verb).toBe("duck");
  const third = scheduleStep(withAlarm(true), [rule], second.execution, execute);
  expect(third.step?.actions[0].verb).toBe("push");
});

it("preserves progress for a physical action and returns its blocked outcome", () => {
  const rule = program("move", action("move"));
  let calls = 0;
  const moving: ActionExecutor = (state) => ({ world: state, outcome: ++calls === 1 ? "progress" : "blocked", reason: "wall" });
  const first = scheduleStep(world, [rule], createExecution(), moving);
  expect(first.step?.outcome).toBe("progress");
  expect(first.execution.active?.cursor.status).toBe("running");
  const second = scheduleStep(world, [rule], first.execution, moving);
  expect(second.step?.outcome).toBe("blocked");
  expect(second.step?.actions[0].verb).toBe("move");
  expect(calls).toBe(2);
});

it("rechecks higher rules after a progress movement step", () => {
  const upper = program("upper", action("duck", "shelter"), { condition: alarm });
  const lower = program("lower", action("move"));
  const moving: ActionExecutor = (state, physical) => ({
    world: state, outcome: physical.verb === "move" ? "progress" : "done", reason: "ok",
  });
  const first = scheduleStep(withAlarm(false), [upper, lower], createExecution(), moving);
  expect(first.step?.outcome).toBe("progress");
  const second = scheduleStep(withAlarm(true), [upper, lower], first.execution, moving);
  expect(second.interrupted).toBe("lower");
  expect(second.step?.actions[0].verb).toBe("duck");
  expect(second.execution.active).toBeNull();
  const third = scheduleStep(withAlarm(false), [upper, lower], second.execution, moving);
  expect(third.step?.actions[0].verb).toBe("move");
  expect(third.step?.outcome).toBe("progress");
});

it("falls through a root if that becomes false during physical progress", () => {
  const upper = program("upper", {
    kind: "if", condition: alarm,
    then: { kind: "sequence", children: [action("move"), action("climb")] },
  });
  const lower = program("lower", action("duck", "shelter"));
  const moving: ActionExecutor = (state, physical) => ({
    world: state, outcome: physical.verb === "move" ? "progress" : "done", reason: "ok",
  });
  const first = scheduleStep(withAlarm(true), [upper, lower], createExecution(), moving);
  expect(first.step?.outcome).toBe("progress");
  const second = scheduleStep(withAlarm(false), [upper, lower], first.execution, moving);
  expect(second.interrupted).toBe("upper");
  expect(second.step?.actions[0].verb).toBe("duck");
  expect(second.execution.suspended[0].cursor.status).toBe("pending");
  const third = scheduleStep(withAlarm(true), [upper, lower], second.execution, moving);
  expect(third.step?.actions[0].verb).toBe("move");
});

it("skips a prior room's literal object without substituting another object", () => {
  const previous = program("earlier", action("push", "old-box"));
  const ordinary = program("ordinary", action("push"));
  const result = scheduleStep(world, [previous, ordinary], createExecution(), execute);
  expect(result.instructionId).toBe("ordinary");
  expect(result.step?.actions[0].target).toBe("box");
});
