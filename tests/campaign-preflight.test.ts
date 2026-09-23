import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld } from "../src/campaign/level";
import { executePhysicalAction } from "../src/campaign/physics";
import { preflightProgram } from "../src/campaign/preflight";
import { advanceStage, createStageRun, departStage, type StageDynamics, type StageRun } from "../src/campaign/run";
import type { Notebook } from "../src/campaign/notebook";
import type { InstructionProgram, ProgramNode, WorldState } from "../src/campaign/types";

function instruction(id: string, body: ProgramNode): InstructionProgram {
  return { version: 2, id, text: id, model: "fixture", scope: { stageId: 2 }, guard: false, body };
}

function notebook(run: StageRun, instructions: InstructionProgram[]): Notebook {
  return { ...structuredClone(run.notebook), instructions, canWrite: false };
}

const dynamics: StageDynamics = {
  execute: executePhysicalAction,
  advance: (world) => ({ world, events: [], canChange: false }),
  segmentComplete: () => false,
  nextSegment: () => null,
  sealAfter: () => null,
};

function runWith(world: WorldState): StageRun {
  return createStageRun("preflight-run", world);
}

describe("campaign program preflight", () => {
  it("returns an immovable take as a free clarification without changing the run or notebook", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("statue", "고정 석상", "fixture", 0, { movable: false, properties: { slot: "large" } }),
    ]));
    const proposed = notebook(run, [instruction("fixed-take", {
      kind: "action", actor: "hero", verb: "take", target: "statue",
    })]);
    const originalRun = structuredClone(run);
    const originalNotebook = structuredClone(proposed);

    const result = preflightProgram(run, proposed, dynamics);

    expect(result).toMatchObject({ kind: "clarification", instructionId: "fixed-take" });
    expect(result.kind === "clarification" ? result.reason : "").toContain("움직이지 않음");
    expect(run).toEqual(originalRun);
    expect(proposed).toEqual(originalNotebook);
    expect(run.notebook.deaths).toBe(0);
  });

  it("validates later actions against the world produced by earlier actions", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("parcel", "소포", "fixture", 4, { movable: true, properties: { slot: "small" } }),
      makeEntity("parcel-stop", "소포 앞", "fixture", 4),
    ]));
    const proposed = notebook(run, [instruction("move-then-take", {
      kind: "sequence",
      children: [
        { kind: "action", actor: "hero", verb: "move", target: "parcel-stop" },
        { kind: "action", actor: "hero", verb: "take", target: "parcel" },
      ],
    })]);

    expect(preflightProgram(run, proposed, dynamics)).toEqual({ kind: "admissible", limited: false });
    expect(run.world.actors.hero.location.x).toBe(0);
    expect(run.world.entities.parcel.parent).toBeNull();
  });

  it("allows a valid overload to execute as a physical failure", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("load", "짐", "fixture", 0, { movable: true, weight: 2, properties: { slot: "large" } }),
      makeEntity("tray", "받침", "fixture", 0, { capacity: 1 }),
    ]));
    const proposed = notebook(run, [instruction("overload", {
      kind: "action", actor: "hero", verb: "place", target: "load", destination: "tray",
    })]);

    expect(preflightProgram(run, proposed, dynamics)).toEqual({ kind: "admissible", limited: false });

    const actual = advanceStage(departStage({ ...run, notebook: proposed }), dynamics);
    expect(actual.events.some((event) => event.outcome === "failure")).toBe(true);
    expect(actual.notebook).toMatchObject({ deaths: 1, canWrite: true });
    expect(actual.phase).toBe("failed");
  });

  it("marks a stable unresolved wait as admissible but limited", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("signal", "신호", "fixture", 0, { properties: { ready: false } }),
    ]));
    const proposed = notebook(run, [instruction("wait", {
      kind: "wait",
      until: { kind: "property", entity: "signal", property: "ready", comparison: "eq", value: true, source: "visible" },
    })]);

    expect(preflightProgram(run, proposed, dynamics)).toEqual({ kind: "admissible", limited: true });
  });

  it("honors notebook priority before checking a currently unreachable lower instruction", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("parcel", "소포", "fixture", 4, { movable: true, properties: { slot: "small" } }),
      makeEntity("parcel-stop", "소포 앞", "fixture", 4),
    ]));
    // Stored low-to-high, so the move is the visible top-priority instruction.
    const proposed = notebook(run, [
      instruction("take-second", { kind: "action", actor: "hero", verb: "take", target: "parcel" }),
      instruction("move-first", { kind: "action", actor: "hero", verb: "move", target: "parcel-stop" }),
    ]);

    expect(preflightProgram(run, proposed, dynamics)).toEqual({ kind: "admissible", limited: false });
  });

  it("reports a scheduler clarification that occurs before any physical executor call", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("left", "왼쪽 물체", "fixture", 0, { movable: true }),
      makeEntity("right", "오른쪽 물체", "fixture", 0, { movable: true }),
    ]));
    const proposed = notebook(run, [instruction("conflicting-roles", {
      kind: "parallel",
      children: [
        { kind: "action", actor: "hero", verb: "push", target: "left", destination: "right" },
        { kind: "action", actor: "hero", verb: "pull", target: "right", destination: "left" },
      ],
    })]);

    expect(preflightProgram(run, proposed, dynamics)).toMatchObject({
      kind: "clarification",
      instructionId: "conflicting-roles",
      reason: expect.stringContaining("동시에"),
    });
  });

  it("lets a stage-specific executor override common immovable-object behavior", () => {
    const run = runWith(makeWorld(2, "fixture", [
      makeEntity("tow", "수로 견인줄", "fixture", 0, { movable: false }),
      makeEntity("channel", "다음 수로", "fixture", 1),
    ]));
    const proposed = notebook(run, [instruction("use-stage-device", {
      kind: "action", actor: "hero", verb: "pull", target: "tow", destination: "channel",
    })]);
    let calls = 0;
    const stageSpecific: StageDynamics = {
      ...dynamics,
      execute: (world, action) => {
        calls++;
        const next = structuredClone(world);
        next.entities[action.target].properties.activated = true;
        return { world: next, outcome: "done", reason: "스테이지 장치를 작동했어요." };
      },
    };

    expect(preflightProgram(run, proposed, stageSpecific)).toEqual({ kind: "admissible", limited: false });
    expect(calls).toBe(1);
    expect(run.world.entities.tow.properties.activated).toBeUndefined();
  });
});
