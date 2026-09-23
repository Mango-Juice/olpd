import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld, stageDynamics, stillWorld, type CampaignStageDefinition, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { createCursor } from "../src/campaign/program";
import { acknowledgePresentation, advanceStage, createStageRun, departStage, type StageDynamics, type StageRun } from "../src/campaign/run";
import { RAIN_STAGE } from "./fixtures/campaign-worlds/rain";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const action = (verb: PhysicalAction["verb"], target: string, rest: Partial<PhysicalAction> = {}): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });
const program = (id: string, body: ProgramNode, patch: Partial<InstructionProgram> = {}): InstructionProgram => ({
  version: 2, id, text: id, model: "movement-fixture", scope: {}, guard: false, body, ...patch,
});
function fixtureWorld(segmentId = "02-idle"): WorldState {
  return makeWorld(2, segmentId, [
    makeEntity("switch", "안전 표식", segmentId, 0, { properties: { ready: false } }),
    makeEntity("exit", "열린 길 끝", segmentId, 1, { material: "stone", properties: { safe: true } }),
  ]);
}
function started(world = fixtureWorld()): StageRun {
  return departStage(createStageRun("movement-run", world));
}
function dynamics(patch: Partial<StageDynamics> = {}): StageDynamics {
  return {
    execute: (world, physical) => {
      const next = structuredClone(world);
      next.actors[physical.actor].location = { ...next.entities[physical.target].location };
      return { world: next, outcome: "done", reason: "명령대로 이동했어요." };
    },
    advance: stillWorld,
    segmentComplete: () => false,
    nextSegment: () => null,
    sealAfter: () => null,
    ...patch,
  };
}
function withProgram(run: StageRun, instruction: InstructionProgram): StageRun {
  const bookmark = run.phase === "bookmark" ? run : { ...run, phase: "bookmark" as const, notebook: { ...run.notebook, editing: true, canWrite: true } };
  return departStage({ ...bookmark, notebook: writeProgram(bookmark.notebook, instruction) });
}

describe("explicit campaign movement", () => {
  it("does not call authored idle metadata or advance the world without a command", () => {
    let idleCalls = 0;
    let environmentCalls = 0;
    const segment: SegmentDefinition = {
      id: "02-idle", title: "열린 길", goal: "출구로 가기", description: "문이 열려 있다.", hints: ["하나", "둘", "셋"],
      enter: () => fixtureWorld(),
      idleAction: () => { idleCalls++; return action("move", "exit"); },
      advance: (world) => {
        environmentCalls++;
        const next = structuredClone(world);
        next.tick++;
        next.entities.switch.properties.ready = true;
        return { world: next, events: [], canChange: true };
      },
      complete: (world) => world.actors.hero.location.x === world.entities.exit.location.x,
    };
    const stage: CampaignStageDefinition = { id: 2, title: "fixture", segments: [segment], practice: { ...segment, id: "02-practice" }, story: { afterSegment: "02-idle", object: "exit", text: "" } };
    const initial = started(segment.enter(null));
    const result = advanceStage(initial, stageDynamics(stage));
    expect(result.phase).toBe("blocked");
    expect(result.world).toEqual(initial.world);
    expect(result.notebook.deaths).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ instructionId: null, actor: null, outcome: "blocked" });
    expect(idleCalls).toBe(0);
    expect(environmentCalls).toBe(0);
  });

  it("moves only for an explicit instruction and attributes the trace to that instruction", () => {
    let executeCalls = 0;
    const run = withProgram(createStageRun("explicit", fixtureWorld()), program("go-exit", action("move", "exit")));
    const result = advanceStage(run, dynamics({
      execute: (world, physical) => {
        executeCalls++;
        const next = structuredClone(world);
        next.actors.hero.location = { ...next.entities[physical.target].location };
        return { world: next, outcome: "done", reason: "출구로 이동했어요." };
      },
      segmentComplete: (world) => world.actors.hero.location.x === 1,
    }));
    expect(result.phase).toBe("cleared");
    expect(result.world.actors.hero.location.x).toBe(1);
    expect(result.events[0]).toMatchObject({ instructionId: "go-exit", actor: "hero", verb: "move", outcome: "safe" });
    expect(result.notebook.deaths).toBe(0);
    expect(executeCalls).toBe(1);
  });

  it("reselects a matching written rule after its action completes", () => {
    let executeCalls = 0;
    let environmentCalls = 0;
    let run = withProgram(createStageRun("exhausted", fixtureWorld()), program("step-once", action("move", "exit")));
    const engine = dynamics({
      execute: (world, physical) => {
        executeCalls++;
        const next = structuredClone(world);
        next.actors.hero.location = { ...next.entities[physical.target].location };
        return { world: next, outcome: "done", reason: "한 번 이동했어요." };
      },
      advance: (world) => { environmentCalls++; return { world, events: [], canChange: true }; },
    });
    run = advanceStage(run, engine);
    expect(run.phase).toBe("running");
    expect(run.world.actors.hero.location.x).toBe(1);
    expect(executeCalls).toBe(1);
    expect(environmentCalls).toBe(1);
    const repeated = advanceStage(acknowledgePresentation(run), engine);
    expect(repeated.phase).toBe("running");
    expect(repeated.world).toEqual(run.world);
    expect(repeated.notebook.deaths).toBe(0);
    expect(repeated.events.filter((event) => event.actor === "hero")).toHaveLength(2);
    expect(executeCalls).toBe(2);
    expect(environmentCalls).toBe(2);
  });

  it("never invents movement for false or unknown conditions", () => {
    const guardCondition = { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" } as const;
    for (const hidden of [false, true]) {
      let executeCalls = 0;
      let environmentCalls = 0;
      const world = fixtureWorld();
      if (hidden) world.visible = world.visible.filter((id) => id !== "switch");
      const conditional = withProgram(createStageRun(hidden ? "unknown" : "false", world), program("conditional", action("move", "exit"), { condition: guardCondition }));
      const result = advanceStage(conditional, dynamics({
        execute: (current) => { executeCalls++; return { world: current, outcome: "done", reason: "실행되면 안 됨" }; },
        advance: (current) => { environmentCalls++; return { world: current, events: [], canChange: true }; },
      }));
      expect(result.phase).toBe("blocked");
      expect(result.world).toEqual(world);
      expect(result.notebook.deaths).toBe(0);
      expect(executeCalls).toBe(0);
      expect(environmentCalls).toBe(0);
    }
  });

  it("runs a true guard before an active lower-priority procedure", () => {
    const world = fixtureWorld();
    world.entities.switch.properties.ready = true;
    const guard = program("guard", action("move", "switch"), {
      guard: true,
      condition: { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" },
    });
    const lower = program("lower", action("move", "exit"));
    let run = started(world);
    run.notebook = { ...run.notebook, instructions: [lower, guard] };
    run.execution.active = { instructionId: "lower", cursor: createCursor() };
    run = advanceStage(run, dynamics());
    expect(run.events.find((event) => event.actor === "hero")?.instructionId).toBe("guard");
    expect(run.events.some((event) => event.outcome === "interrupted" && event.instructionId === "lower")).toBe(true);
    expect(run.execution.suspended.map((item) => item.instructionId)).toContain("lower");
  });

  it("advances an explicit wait until its condition is met, then executes its move", () => {
    const wait: ProgramNode = { kind: "wait", until: { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" } };
    const body: ProgramNode = { kind: "sequence", children: [wait, action("move", "exit")] };
    let run = withProgram(createStageRun("wait-run", fixtureWorld()), program("wait-then-move", body));
    let environmentCalls = 0;
    const engine = dynamics({
      advance: (world) => {
        environmentCalls++;
        const next = structuredClone(world);
        next.tick++;
        next.entities.switch.properties.ready = true;
        return { world: next, events: [], canChange: true };
      },
      segmentComplete: (world) => world.actors.hero.location.x === 1,
    });
    run = advanceStage(run, engine);
    expect(run.phase).toBe("waiting");
    expect(run.world.actors.hero.location.x).toBe(0);
    expect(environmentCalls).toBe(1);
    for (let step = 0; step < 4 && (run.phase === "waiting" || run.phase === "running"); step++) run = advanceStage(acknowledgePresentation(run), engine);
    expect(run.phase).toBe("cleared");
    expect(run.events.find((event) => event.actor === "hero")).toMatchObject({ instructionId: "wait-then-move", verb: "move" });
  });

  it("keeps an explicitly boarded raft moving until an explicit dismount instruction arrives", () => {
    const body: ProgramNode = { kind: "sequence", children: [action("push", "rain-cork", { destination: "rain-launch" }), action("board", "rain-cork")] };
    let run = withProgram(createStageRun("rain", RAIN_STAGE.segments[0].enter(null)), program("raft", body));
    for (let step = 0; step < 30 && (run.phase === "running" || run.phase === "waiting"); step++) run = advanceStage(acknowledgePresentation(run), stageDynamics(RAIN_STAGE));
    expect(run.phase).toBe("running");
    expect(run.world.actors.hero.riding).toBe("rain-cork");
    expect(run.world.entities["rain-cork"].properties.landingReachable).toBe(true);
    expect(RAIN_STAGE.segments[0].complete(run.world)).toBe(false);
    expect(run.notebook.deaths).toBe(0);
  });
});
