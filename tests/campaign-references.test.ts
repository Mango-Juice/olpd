import { describe, expect, it } from "vitest";
import { readPublicProperty, resolveActionReferences } from "../src/campaign/conditions";
import { makeEntity, makeWorld } from "../src/campaign/level";
import { executePhysicalAction } from "../src/campaign/physics";
import { createCursor, stepProgram } from "../src/campaign/program";
import { acknowledgePresentation, advanceStage, createStageRun, departStage, rewindStage, writeStageProgram, type StageDynamics } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import { parsePhysicalAction, parseProgram } from "../src/campaign/validation";
import type { EntityReference, InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const region = "08-reference";
function fixture(): WorldState {
  return makeWorld(8, region, [
    makeEntity("window", "관측창", region, 0, { properties: { connectedTo: "east", hiddenAnswer: "west" } }),
    makeEntity("east", "동쪽 손잡이", region, 3, { reach: 4, properties: { holdable: true, held: false, open: false, rail: true } }),
    makeEntity("west", "서쪽 손잡이", region, -3, { reach: 4, properties: { holdable: true, held: false, open: false, rail: true } }),
    makeEntity("object", "옮길 추", region, 0, { movable: true, weight: 0.2, properties: { slot: "small", recoverable: true } }),
  ]);
}
const memory: EntityReference = { entity: "window", property: "connectedTo", source: "remembered" };
function action(verb: PhysicalAction["verb"] = "move", patch: Partial<PhysicalAction> = {}): PhysicalAction {
  return { kind: "action", actor: "hero", verb, target: "window", references: { target: memory }, ...patch };
}
function observe(world: WorldState): WorldState {
  return executePhysicalAction(world, { kind: "action", actor: "hero", verb: "observe", target: "window" }).world;
}
function program(body: ProgramNode): InstructionProgram {
  return { version: 2, id: "reference-program", text: "본 연결을 따라간다.", model: "test", scope: { stageId: 8 }, guard: false, body };
}
const walk = (world: WorldState, physical: PhysicalAction) => executePhysicalAction(world, physical, { movementStep: 1 });

describe("runtime entity references", () => {
  it("uses the latest observation in the current attempt and never the fallback ID", () => {
    const current = observe(fixture());
    expect(resolveActionReferences(current, action())).toMatchObject({ outcome: "valid", action: { target: "east" } });
    current.entities.window.properties.connectedTo = "west";
    expect(resolveActionReferences(current, action())).toMatchObject({ outcome: "valid", action: { target: "east" } });
    const refreshed = observe(current);
    expect(resolveActionReferences(refreshed, action())).toMatchObject({ outcome: "valid", action: { target: "west" } });
    refreshed.attempt += 1;
    expect(resolveActionReferences(refreshed, action()).outcome).toBe("clarification");
    expect(executePhysicalAction(refreshed, action()).world.actors.hero.location.x).toBe(0);
    expect(executePhysicalAction(refreshed, { kind: "action", actor: "hero", verb: "move", target: "east" }).outcome).toBe("done");
  });

  it("can observe and then use a relation in the same sequence without a preexisting fact", () => {
    const body: ProgramNode = { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "observe", target: "window" }, action("open"),
    ] };
    expect(parseProgram(program(body))).not.toBeNull();
    const first = stepProgram(fixture(), body, createCursor(), executePhysicalAction);
    first.world.visible = first.world.visible.filter((id) => id !== "window");
    const second = stepProgram(first.world, body, first.cursor, executePhysicalAction);
    expect(second.outcome).toBe("done");
    expect(second.world.entities.east.properties.open).toBe(true);
    expect(second.world.entities.west.properties.open).toBe(false);
  });

  it("does not treat a parallel sibling observation as an earlier observation", () => {
    const state = fixture();
    state.actors.keeper = { ...structuredClone(state.actors.hero), id: "keeper", carrying: [], capabilities: ["rail-only"] };
    const body: ProgramNode = { kind: "parallel", children: [
      { kind: "action", actor: "keeper", verb: "observe", target: "window" }, action("open"),
    ] };
    const result = stepProgram(state, body, createCursor(), executePhysicalAction);
    expect(result.outcome).toBe("clarification");
    expect(result.world.entities.east.properties.open).toBe(false);
  });

  it("keeps the first binding during movement even when the visible relation changes", () => {
    const body = action("move", { references: { target: { ...memory, source: "visible" } } });
    const first = stepProgram(fixture(), body, createCursor(), walk);
    expect(first.world.actors.hero.location.x).toBe(1);
    expect(first.cursor.resolvedAction?.target).toBe("east");
    expect(first.cursor.resolvedAction?.references).toBeUndefined();
    first.world.entities.window.properties.connectedTo = "west";
    const restored = JSON.parse(JSON.stringify(first)) as typeof first;
    const second = stepProgram(restored.world, body, restored.cursor, walk);
    const third = stepProgram(second.world, body, second.cursor, walk);
    expect(third.outcome).toBe("done");
    expect(third.world.actors.hero.location.x).toBe(3);
  });

  it("serializes a bound cursor in a valid saved run and rejects forged literal roles", () => {
    const body = action();
    const initial = observe(fixture());
    const first = stepProgram(initial, body, createCursor(), walk);
    const run = departStage(writeStageProgram(createStageRun("reference-save", initial), program(body)));
    run.world = first.world;
    run.execution.active = { instructionId: "reference-program", cursor: first.cursor };
    const restored = parseStageRun(JSON.parse(JSON.stringify(run)));
    expect(restored).not.toBeNull();
    expect(restored!.execution.active!.cursor.resolvedAction?.target).toBe("east");
    run.execution.active.cursor.resolvedAction!.actor = "keeper";
    expect(parseStageRun(run)).toBeNull();
  });

  it("drops an in-flight binding on rewind and requires a fresh observation", () => {
    const body = action();
    const initial = observe(fixture());
    const dynamics: StageDynamics = {
      execute: walk,
      advance: (world) => ({ world, events: [], canChange: false }),
      segmentComplete: () => false,
      nextSegment: () => null,
      sealAfter: () => null,
    };
    let run = departStage(writeStageProgram(createStageRun("reference-rewind", initial), program(body)));
    run = advanceStage(run, dynamics);
    expect(run.phase).toBe("running");
    expect(run.execution.active?.cursor.resolvedAction?.target).toBe("east");
    const failure: StageDynamics = {
      ...dynamics,
      execute: (world) => ({ world, outcome: "failure", reason: "이동이 막혔어요." }),
    };
    run = advanceStage(acknowledgePresentation(run), failure);
    expect(run.phase).toBe("failed");
    expect(run.notebook.deaths).toBe(1);
    const rewound = rewindStage(acknowledgePresentation(run));
    expect(rewound.execution.active).toBeNull();
    expect(rewound.world.attempt).toBe(2);
    const retried = stepProgram(rewound.world, body, createCursor(), walk);
    expect(retried.outcome).toBe("clarification");
    expect(retried.world.actors.hero.location.x).toBe(0);
    expect(stepProgram(observe(rewound.world), body, createCursor(), walk).outcome).toBe("progress");
  });

  it("releases the originally held object after its relation changes", () => {
    const state = fixture();
    const body: ProgramNode = { kind: "until", body: action("hold", { references: { target: { ...memory, source: "visible" } } }),
      condition: { kind: "property", entity: "object", property: "open", comparison: "eq", value: true, source: "visible" } };
    state.entities.object.properties.open = false;
    const first = stepProgram(state, body, createCursor(), executePhysicalAction);
    expect(first.world.actors.hero.holding).toBe("east");
    first.world.entities.window.properties.connectedTo = "west";
    first.world.entities.object.properties.open = true;
    const second = stepProgram(first.world, body, first.cursor, executePhysicalAction);
    expect(second.outcome).toBe("done");
    expect(second.actions[0]).toMatchObject({ verb: "release", target: "east" });
    expect(second.world.actors.hero.holding).toBeNull();
  });

  it("resolves only referenced roles and leaves literal targets and instruments intact", () => {
    const state = observe(fixture());
    const command = action("place", { target: "object", destination: "west", references: { destination: memory } });
    const resolved = resolveActionReferences(state, command);
    expect(resolved).toMatchObject({ outcome: "valid", action: { target: "object", destination: "east" } });
    const placed = executePhysicalAction(state, command);
    expect(placed.outcome).toBe("done");
    expect(placed.world.entities.object.parent).toBe("east");
  });

  it("refuses hidden, missing, nonentity and ambiguous relation values without mutation", () => {
    const state = fixture();
    const visible = action("open", { references: { target: { ...memory, source: "visible" } } });
    for (const value of [false, 7, "absent", "east|west"]) {
      state.entities.window.properties.connectedTo = value;
      expect(stepProgram(state, visible, createCursor(), executePhysicalAction).outcome).toBe("clarification");
      expect(state.entities.east.properties.open).toBe(false);
    }
    expect(readPublicProperty(state, { ...memory, source: "visible", property: "hiddenAnswer" })).toBeUndefined();
    state.visible = state.visible.filter((id) => id !== "window");
    expect(resolveActionReferences(state, visible).outcome).toBe("clarification");
    const observed = observe(fixture());
    expect(observed.facts.some((fact) => fact.property === "hiddenAnswer")).toBe(false);
  });

  it("validates reference structure without requiring current observed values", () => {
    expect(parsePhysicalAction(action())).not.toBeNull();
    expect(parsePhysicalAction(action("move", { references: {} }))).toBeNull();
    expect(parsePhysicalAction({ ...action(), references: { destination: memory } })).toBeNull();
    expect(parsePhysicalAction({ ...action(), references: { target: { ...memory, answer: "east" } } })).toBeNull();
    expect(parsePhysicalAction({ ...action(), references: { target: { ...memory, source: "hidden" } } })).toBeNull();
  });
});

describe("fixed pull actuators", () => {
  it("requires real contact for a fixed push and records exactly one stroke", () => {
    const state = fixture();
    state.entities.east.reach = 1;
    state.entities.east.properties.actuator = true;
    state.entities.east.properties.strokes = 0;
    const command: PhysicalAction = { kind: "action", actor: "hero", verb: "push", target: "east" };
    expect(executePhysicalAction(state, command).outcome).toBe("clarification");
    state.actors.hero.location.x = 2;
    const pressed = executePhysicalAction(state, command);
    expect(pressed.outcome).toBe("done");
    expect(pressed.world.entities.east.properties.strokes).toBe(1);
    expect(pressed.world.actors.hero.holding).toBeNull();
    expect(executePhysicalAction(state, { ...command, target: "object" }).outcome).toBe("clarification");
  });

  it("makes one finite stroke without moving the mechanism or establishing a hold", () => {
    const state = fixture();
    state.entities.east.properties.actuator = true;
    state.entities.east.properties.strokes = 0;
    const command: PhysicalAction = { kind: "action", actor: "hero", verb: "pull", target: "east" };
    const first = executePhysicalAction(state, command);
    expect(first.outcome).toBe("done");
    expect(first.world.entities.east.properties.strokes).toBe(1);
    expect(first.world.entities.east.location).toEqual(state.entities.east.location);
    expect(first.world.actors.hero.holding).toBeNull();
    expect(executePhysicalAction(first.world, command).world.entities.east.properties.strokes).toBe(2);
    expect(executePhysicalAction(state, { ...command, destination: "west" }).outcome).toBe("clarification");
    expect(executePhysicalAction(state, { ...command, target: "west" }).outcome).toBe("clarification");
  });
});
