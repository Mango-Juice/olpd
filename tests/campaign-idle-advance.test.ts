import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld, stageDynamics, stillWorld, type CampaignStageDefinition, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { createCursor } from "../src/campaign/program";
import { advanceStage, createCampaignRun, createStageRun, departStage, type StageDynamics, type StageRun } from "../src/campaign/run";
import { RAIN_STAGE } from "../src/campaign/stages/rain";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const action = (verb: PhysicalAction["verb"], target: string, rest: Partial<PhysicalAction> = {}): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });
const program = (id: string, body: ProgramNode, patch: Partial<InstructionProgram> = {}): InstructionProgram => ({
  version: 2, id, text: id, model: "idle-fixture", scope: {}, guard: false, body, ...patch,
});
function fixtureWorld(segmentId = "02-idle"): WorldState {
  return makeWorld(2, segmentId, [
    makeEntity("switch", "안전 표식", segmentId, 0, { properties: { ready: false } }),
    makeEntity("exit", "열린 길 끝", segmentId, 1, { material: "stone", properties: { safe: true } }),
    makeEntity("hidden-exit", "숨은 길 끝", segmentId, 2, { material: "stone", properties: { safe: true } }),
  ]);
}
function started(world = fixtureWorld()): StageRun {
  return departStage(createStageRun("idle-run", world));
}
function dynamics(patch: Partial<StageDynamics> = {}): StageDynamics {
  return {
    execute: (world, physical) => {
      const next = structuredClone(world);
      next.actors[physical.actor].location = { ...next.entities[physical.target].location };
      return { world: next, outcome: "done", reason: "열린 길을 따라갔어요." };
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

describe("authored idle advance", () => {
  it("moves only after the scheduler yields and records a normal system trace", () => {
    const segment: SegmentDefinition = {
      id: "02-idle", title: "열린 길", goal: "출구로 가기", description: "문이 열려 있다.", hints: ["하나", "둘", "셋"],
      enter: () => fixtureWorld(),
      idleAction: (world) => world.actors.hero.location.x === world.entities.exit.location.x ? null : action("move", "exit"),
      advance: stillWorld,
      complete: (world) => world.actors.hero.location.x === world.entities.exit.location.x,
    };
    const stage: CampaignStageDefinition = { id: 2, title: "fixture", segments: [segment], practice: { ...segment, id: "02-practice" }, story: { afterSegment: "02-idle", object: "exit", text: "" } };
    const result = advanceStage(started(segment.enter(null)), stageDynamics(stage));
    expect(result.phase).toBe("cleared");
    expect(result.notebook.bells).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ instructionId: null, actor: "hero", target: "exit", outcome: "safe" });
    expect(result.events[0].reason).toContain("열린 길 끝");
  });

  it("runs true guards first, ignores dormant false guards, and stops on unknown guards", () => {
    let idleCalls = 0;
    const readyWorld = fixtureWorld();
    readyWorld.entities.switch.properties.ready = true;
    const guardCondition = { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" } as const;
    const guardRun = withProgram(createStageRun("guard", readyWorld), program("guard", action("move", "switch"), { guard: true, condition: guardCondition }));
    const guardResult = advanceStage(guardRun, dynamics({ idleAction: () => { idleCalls++; return action("move", "exit"); } }));
    expect(guardResult.events.find((event) => event.actor === "hero")?.instructionId).toBe("guard");
    expect(guardResult.world.actors.hero.location.x).toBe(0);
    expect(idleCalls).toBe(0);

    const dormantGuard = withProgram(createStageRun("dormant", fixtureWorld()), program("dormant", action("move", "switch"), { guard: true, condition: guardCondition }));
    const advanced = advanceStage(dormantGuard, dynamics({ idleAction: () => { idleCalls++; return action("move", "exit"); } }));
    expect(advanced.world.actors.hero.location.x).toBe(1);
    expect(advanced.events.find((event) => event.actor === "hero")?.instructionId).toBeNull();
    expect(idleCalls).toBe(1);

    const unknownGuardWorld = fixtureWorld();
    unknownGuardWorld.visible = unknownGuardWorld.visible.filter((id) => id !== "switch");
    const unknownGuard = withProgram(createStageRun("unknown-guard", unknownGuardWorld), program("unknown-guard", action("move", "switch"), { guard: true, condition: guardCondition }));
    const guardedStop = advanceStage(unknownGuard, dynamics({ idleAction: () => { idleCalls++; return action("move", "exit"); } }));
    expect(guardedStop.phase).toBe("blocked");
    expect(guardedStop.world.actors.hero.location.x).toBe(0);
    expect(idleCalls).toBe(1);
  });

  it("interrupts an active lower-priority procedure before considering idle movement", () => {
    let idleCalls = 0;
    const world = fixtureWorld();
    world.entities.switch.properties.ready = true;
    const guard = program("guard", action("move", "switch"), {
      guard: true,
      condition: { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" },
    });
    const lower = program("lower", action("move", "exit"));
    let run = started(world);
    run.notebook = { ...run.notebook, instructions: [guard, lower] };
    run.execution.active = { instructionId: "lower", cursor: createCursor() };
    run = advanceStage(run, dynamics({ idleAction: () => { idleCalls++; return action("move", "exit"); } }));
    expect(run.events.find((event) => event.actor === "hero")?.instructionId).toBe("guard");
    expect(run.events.some((event) => event.outcome === "interrupted" && event.instructionId === "lower")).toBe(true);
    expect(run.execution.suspended.map((item) => item.instructionId)).toContain("lower");
    expect(idleCalls).toBe(0);
  });

  it("keeps legacy non-guard false conditions waiting and unknown conditions stopped", () => {
    let idleCalls = 0;
    let environmentCalls = 0;
    const conditional = withProgram(createStageRun("condition", fixtureWorld()), program("condition", action("move", "exit"), {
      condition: { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" },
    }));
    const waiting = advanceStage(conditional, dynamics({
      idleAction: () => { idleCalls++; return action("move", "exit"); },
      advance: (world) => { environmentCalls++; return { world, events: [], canChange: true }; },
    }));
    expect(waiting.phase).toBe("waiting");
    expect(waiting.world.actors.hero.location.x).toBe(0);
    expect(environmentCalls).toBe(1);
    expect(idleCalls).toBe(0);

    const unknownWorld = fixtureWorld();
    unknownWorld.visible = unknownWorld.visible.filter((id) => id !== "switch");
    const unknown = withProgram(createStageRun("unknown", unknownWorld), program("unknown", action("move", "exit"), {
      condition: { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" },
    }));
    const stopped = advanceStage(unknown, dynamics({ idleAction: () => { idleCalls++; return action("move", "exit"); } }));
    expect(stopped.phase).toBe("blocked");
    expect(stopped.world.actors.hero.location.x).toBe(0);
    expect(idleCalls).toBe(0);
  });

  it("keeps active and suspended waits ahead of idle movement", () => {
    for (const mode of ["active", "suspended"] as const) {
      let idleCalls = 0;
      let run = withProgram(createStageRun(mode, fixtureWorld()), program("wait", {
        kind: "wait", until: { kind: "property", entity: "switch", property: "ready", comparison: "eq", value: true, source: "visible" },
      }));
      if (mode === "suspended") run.execution = { ...run.execution, active: null, suspended: [{ instructionId: "wait", cursor: createCursor() }] };
      run = advanceStage(run, dynamics({ idleAction: () => { idleCalls++; return action("move", "exit"); }, advance: (world) => ({ world, events: [], canChange: true }) }));
      expect(run.phase).toBe("waiting");
      expect(run.world.actors.hero.location.x).toBe(0);
      expect(idleCalls).toBe(0);
    }
  });

  it("excludes onboarding even when a learning card accidentally declares an idle action", () => {
    let idleCalls = 0;
    const intro: SegmentDefinition = {
      id: "02-learn-idle", title: "도입", goal: "직접 적기", description: "도입", hints: ["하나", "둘", "셋"],
      enter: () => fixtureWorld("02-learn-idle"),
      idleAction: () => { idleCalls++; return action("move", "exit"); },
      advance: stillWorld,
      complete: () => false,
    };
    const core: SegmentDefinition = { ...intro, id: "02-idle", enter: () => fixtureWorld() };
    const stage: CampaignStageDefinition = { id: 2, title: "fixture", onboarding: [intro], segments: [core], practice: { ...core, id: "02-practice" }, story: { afterSegment: "02-idle", object: "exit", text: "" } };
    const result = advanceStage(departStage(createCampaignRun("intro", stage)), stageDynamics(stage));
    expect(result.phase).toBe("blocked");
    expect(result.world.actors.hero.location.x).toBe(0);
    expect(idleCalls).toBe(0);
  });

  it("rejects non-literal, non-hero, interactive, and hidden idle actions before execution", () => {
    const invalid: PhysicalAction[] = [
      { kind: "action", actor: "keeper", verb: "move", target: "exit" },
      action("open", "exit"),
      action("move", "hidden-exit"),
      { ...action("move", "exit"), references: { target: { entity: "switch", property: "route", source: "visible" } } },
    ];
    for (const candidate of invalid) {
      let executeCalls = 0;
      let environmentCalls = 0;
      const world = fixtureWorld();
      world.visible = world.visible.filter((id) => id !== "hidden-exit");
      const result = advanceStage(started(world), dynamics({
        idleAction: () => candidate,
        execute: (current) => { executeCalls++; return { world: current, outcome: "done", reason: "실행되면 안 됨" }; },
        advance: (current) => { environmentCalls++; return { world: current, events: [], canChange: false }; },
      }));
      expect(result.phase).toBe("blocked");
      expect(result.world).toEqual(world);
      expect(result.notebook.bells).toBe(0);
      expect(executeCalls).toBe(0);
      expect(environmentCalls).toBe(0);
    }
  });

  it("rolls back an unsafe physical or environment result without charging the player", () => {
    for (const source of ["execute", "environment"] as const) {
      let environmentCalls = 0;
      const world = fixtureWorld();
      const result = advanceStage(started(world), dynamics({
        idleAction: () => action("move", "exit"),
        execute: (current, physical) => {
          const changed = structuredClone(current);
          changed.actors.hero.location = { ...changed.entities[physical.target].location };
          return source === "execute"
            ? { world: changed, outcome: "failure", reason: "길이 닫혔어요." }
            : { world: changed, outcome: "done", reason: "이동했어요." };
        },
        advance: (current) => {
          environmentCalls++;
          const changed = structuredClone(current);
          changed.tick++;
          return { world: changed, events: [], canChange: false, failure: "바닥이 위험해졌어요." };
        },
      }));
      expect(result.phase).toBe("blocked");
      expect(result.world).toEqual(world);
      expect(result.notebook.bells).toBe(0);
      expect(result.events.at(-1)).toMatchObject({ instructionId: null, actor: "hero", target: "exit", outcome: "blocked", changes: [] });
      expect(environmentCalls).toBe(source === "execute" ? 0 : 1);
    }
  });

  it("leaves 02-1 waiting for an explicit dismount because it has no idle action", () => {
    const body: ProgramNode = { kind: "sequence", children: [action("push", "rain-cork", { destination: "rain-launch" }), action("board", "rain-cork")] };
    let run = withProgram(createStageRun("rain", RAIN_STAGE.segments[0].enter(null)), program("raft", body));
    for (let step = 0; step < 8 && (run.phase === "running" || run.phase === "waiting"); step++) run = advanceStage(run, stageDynamics(RAIN_STAGE));
    expect(run.phase).toBe("blocked");
    expect(run.world.actors.hero.riding).toBe("rain-cork");
    expect(run.world.entities["rain-cork"].properties.landingReachable).toBe(true);
    expect(RAIN_STAGE.segments[0].complete(run.world)).toBe(false);
    expect(run.notebook.bells).toBe(0);
  });
});
