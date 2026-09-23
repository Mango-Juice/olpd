import { describe, expect, it } from "vitest";
import { resolveProgramBindings } from "../src/campaign/bindings";
import { makeEntity, makeWorld } from "../src/campaign/level";
import { scheduleStep, createExecution } from "../src/campaign/scheduler";
import type { InstructionProgram, PhysicalAction } from "../src/campaign/types";

function portable(target = "old-box"): InstructionProgram {
  return {
    version: 2,
    id: "portable-box-rule",
    text: "상자가 있으면 옆으로 밀어",
    model: "fixture",
    scope: { stageId: 2 },
    bindings: { [target]: { kind: "public-kind", value: "box" } },
    guard: false,
    body: { kind: "action", actor: "hero", verb: "push", target },
  };
}

describe("portable public entity bindings", () => {
  it("rebinds a stage rule to one visible semantic match without another interpretation", () => {
    const box = { ...makeEntity("new-box", "다음 방 상자", "02-next", 2), publicKind: "box" };
    const world = makeWorld(2, "02-next", [box]);
    const resolution = resolveProgramBindings(world, portable());
    expect(resolution).toMatchObject({ kind: "resolved", condition: true, program: { body: { target: "new-box" } } });

    const seen: PhysicalAction[] = [];
    const scheduled = scheduleStep(world, [portable()], createExecution(), (state, action) => {
      seen.push(action);
      return { world: state, outcome: "done", reason: "done" };
    });
    expect(scheduled.step?.outcome).toBe("done");
    expect(seen).toEqual([{ kind: "action", actor: "hero", verb: "push", target: "new-box" }]);
  });

  it("keeps a missing kind dormant and makes multiple matches a clarification", () => {
    const empty = makeWorld(2, "02-empty", [makeEntity("exit", "출구", "02-empty", 9)]);
    expect(resolveProgramBindings(empty, portable())).toEqual({ kind: "dormant", reason: "missing" });

    const left = { ...makeEntity("left", "왼쪽 상자", "02-many", 2), publicKind: "box" };
    const right = { ...makeEntity("right", "오른쪽 상자", "02-many", 4), publicKind: "box" };
    const many = makeWorld(2, "02-many", [left, right]);
    expect(resolveProgramBindings(many, portable())).toMatchObject({ kind: "clarification" });
    expect(scheduleStep(many, [portable()], createExecution(), () => { throw new Error("must not execute"); }).step)
      .toMatchObject({ outcome: "clarification", actions: [] });
  });

  it("rebinds top-level and nested predicate owners together with action roles", () => {
    const old = portable();
    old.condition = { kind: "property", entity: "old-box", property: "blocksPath", comparison: "eq", value: true, source: "visible" };
    old.body = { kind: "if", condition: old.condition, then: old.body };
    const box = { ...makeEntity("new-box", "상자", "02-next", 2, { properties: { blocksPath: true } }), publicKind: "box" };
    const resolution = resolveProgramBindings(makeWorld(2, "02-next", [box]), old);
    expect(resolution).toMatchObject({
      kind: "resolved",
      condition: true,
      program: {
        condition: { entity: "new-box" },
        body: { kind: "if", condition: { entity: "new-box" }, then: { target: "new-box" } },
      },
    });
  });
});
