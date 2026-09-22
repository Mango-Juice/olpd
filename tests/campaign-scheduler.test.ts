import { expect, it } from "vitest";
import { createExecution, enterEncounter, scheduleStep } from "../src/campaign/scheduler";
import type { ActionExecutor } from "../src/campaign/program";
import type { InstructionProgram, WorldState } from "../src/campaign/types";
const world: WorldState = { stageId: 5, segmentId: "05-2", tick: 0, attempt: 1, entities: Object.fromEntries(["box", "shelter"].map((id) => [id, { id, name: id, description: id, material: "wood" as const, movable: true, weight: 1, capacity: 1, reach: 1, parent: null, location: { region: "fixture", x: 0, y: 0 }, properties: {} }])), actors: {}, visible: [], facts: [] };
const execute: ActionExecutor = (state) => ({ world: state, outcome: "done", reason: "ok" });
const ordinary: InstructionProgram = { version: 2, id: "ordinary", text: "밀고 올라가", model: "fixture", scope: {}, guard: false, body: { kind: "sequence", children: [ { kind: "action", actor: "hero", verb: "push", target: "box" }, { kind: "action", actor: "hero", verb: "climb", target: "box" } ] } };
const guard: InstructionProgram = { ...ordinary, id: "guard", guard: true, condition: { kind: "property", entity: "alarm", property: "active", value: true, comparison: "eq", source: "remembered" }, body: { kind: "action", actor: "hero", verb: "duck", target: "shelter" } };
it("interrupts at a boundary and resumes the stored cursor without refiring the guard", () => {
  const programs = [guard, ordinary];
  const first = scheduleStep(world, programs, createExecution(), execute);
  expect(first.step?.actions[0].verb).toBe("push");
  const changed = { ...world, facts: [{ entity: "alarm", property: "active", value: true, attempt: 1, tick: 1 }] };
  const second = scheduleStep(changed, programs, first.execution, execute);
  expect(second.interrupted).toBe("ordinary");
  expect(second.step?.actions[0].verb).toBe("duck");
  const third = scheduleStep(changed, programs, second.execution, execute);
  expect(third.step?.actions[0].verb).toBe("climb");
  expect(scheduleStep(changed, programs, third.execution, execute).step).toBeNull();
});
it("does not rerun a completed procedure until a new encounter", () => {
  const single = { ...ordinary, body: guard.body };
  const first = scheduleStep(world, [single], createExecution(), execute);
  expect(scheduleStep(world, [single], first.execution, execute).step).toBeNull();
  expect(scheduleStep(world, [single], enterEncounter(first.execution), execute).step?.actions).toHaveLength(1);
});

it("rearms a conditional guard only when a new matching event occurs", () => {
  const active = { ...world, facts: [{ entity: "alarm", property: "active", value: true, attempt: 1, tick: 1 }] };
  const first = scheduleStep(active, [guard], createExecution(), execute);
  expect(scheduleStep(active, [guard], first.execution, execute).step).toBeNull();
  const quiet = { ...world, facts: [{ entity: "alarm", property: "active", value: false, attempt: 1, tick: 2 }] };
  const second = scheduleStep(quiet, [guard], first.execution, execute);
  const third = scheduleStep(active, [guard], second.execution, execute);
  expect(third.step?.actions[0].verb).toBe("duck");
});

it("skips a prior room's literal object without substituting another object", () => {
  const previous = { ...ordinary, id: "earlier", body: { kind: "action" as const, actor: "hero" as const, verb: "push" as const, target: "old-box" } };
  const result = scheduleStep(world, [previous, ordinary], createExecution(), execute);
  expect(result.instructionId).toBe("ordinary");
  expect(result.step?.actions[0].target).toBe("box");
});
