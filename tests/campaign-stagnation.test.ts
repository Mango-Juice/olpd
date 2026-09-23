import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld, stillWorld, stageDynamics } from "../src/campaign/level";
import { parseStageRun } from "../src/campaign/run-validation";
import { acknowledgePresentation, advanceStage, createCampaignRun, createStageRun, departStage, retryStage, writeStageProgram, type StageDynamics, type StageRun } from "../src/campaign/run";
import { SPATIAL_EARLY_STAGES } from "../src/campaign/spatial/early";
import type { InstructionProgram, PhysicalAction, ProgramNode } from "../src/campaign/types";

const boxId = "02-v2-1-box";
const boxAction: PhysicalAction = { kind: "action", actor: "hero", verb: "push", target: boxId };
const boxProgram: InstructionProgram = {
  version: 2, id: "push-box", text: "상자를 밀어", model: "fixture", scope: { stageId: 2 }, guard: false, body: boxAction,
};

function step(run: StageRun, dynamics: StageDynamics): StageRun {
  return advanceStage(acknowledgePresentation(run), dynamics);
}

describe("repeated commands without physical progress", () => {
  it("ends a push-only 2-1 run as a normal death after reaching the box's final position", () => {
    const stage = SPATIAL_EARLY_STAGES[0];
    const dynamics = stageDynamics(stage);
    let run = departStage(writeStageProgram(createCampaignRun("push-only", stage), boxProgram));

    // Approaching the box and moving it are real progress despite repeating the same command.
    for (let index = 0; index < 4; index++) {
      const before = run.world;
      run = step(run, dynamics);
      expect(run.phase, `progress step ${index + 1}: ${run.statusReason}`).toBe("running");
      expect(run.notebook.deaths).toBe(0);
      expect(run.world.actors.hero.location).not.toEqual(before.actors.hero.location);
    }
    expect(run.world.entities[boxId].location.z).toBe(1.4);

    const parked = structuredClone(run.world);
    for (let index = 0; index < 2; index++) {
      run = step(run, dynamics);
      expect(run.phase).toBe("running");
    }
    const inProgress = parseStageRun(JSON.parse(JSON.stringify(run)));
    expect(inProgress).not.toBeNull();
    run = step(inProgress!, dynamics);
    expect(run.phase).toBe("failed");
    expect(run.notebook).toMatchObject({ deaths: 1, canWrite: true, canDelete: true });
    expect(run.presentation).toMatchObject({ outcome: "death", life: 1 });
    expect(run.events.at(-1)?.outcome).toBe("failure");
    expect(run.world.entities[boxId].location).toEqual(parked.entities[boxId].location);
    expect(run.world.actors.hero.location).toEqual(parked.actors.hero.location);

    // Death uses the ordinary notebook and entrance retry path, including save parsing.
    const persisted = parseStageRun(JSON.parse(JSON.stringify(run)));
    expect(persisted).not.toBeNull();
    const retried = retryStage(acknowledgePresentation(run));
    expect(retried).toMatchObject({ phase: "bookmark", world: { segmentId: "02-v2-1", attempt: 2 }, notebook: { deaths: 1, canWrite: false } });
    expect(retried.notebook.instructions).toEqual([boxProgram]);
    expect(retried.world.entities[boxId].location).toEqual(stage.segments[0].enter(null).entities[boxId].location);
    expect(parseStageRun(JSON.parse(JSON.stringify(retried)))).not.toBeNull();

    let nextLife = departStage(acknowledgePresentation(retried));
    for (let index = 0; index < 6; index++) {
      nextLife = step(nextLife, dynamics);
      expect(nextLife.phase, `next life step ${index + 1}: ${nextLife.statusReason}`).toBe("running");
    }
    expect(nextLife.notebook.deaths).toBe(1);
  });

  it("keeps repeating the same command while the commanded object actually moves", () => {
    const initial = makeWorld(2, "02-moving-box", [makeEntity(boxId, "움직이는 상자", "02-moving-box", 2, { movable: true })]);
    const dynamics: StageDynamics = {
      execute: (world) => {
        const next = structuredClone(world);
        next.entities[boxId].location.x += 0.25;
        return { world: next, outcome: "done", reason: "상자가 앞으로 움직였어요." };
      },
      advance: stillWorld,
      segmentComplete: () => false,
      nextSegment: () => null,
      sealAfter: () => null,
    };
    let run = departStage(writeStageProgram(createStageRun("moving-box", initial), boxProgram));
    for (let index = 0; index < 8; index++) {
      run = step(run, dynamics);
      expect(run.phase, `move ${index + 1}: ${run.statusReason}`).toBe("running");
    }
    expect(run.world.entities[boxId].location.x).toBe(4);
    expect(run.notebook.deaths).toBe(0);
  });

  it("does not count a changing procedure cursor as the same decision", () => {
    const initial = makeWorld(2, "02-procedure", [
      makeEntity("first", "첫 손잡이", "02-procedure", 2),
      makeEntity("second", "다음 손잡이", "02-procedure", 3),
    ]);
    const body: ProgramNode = { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "turn", target: "first" },
      { kind: "action", actor: "hero", verb: "turn", target: "second" },
    ] };
    const program: InstructionProgram = { ...boxProgram, id: "two-step", body };
    const dynamics: StageDynamics = {
      execute: (world) => ({ world, outcome: "done", reason: "절차의 다음 명령을 실행했어요." }),
      advance: stillWorld,
      segmentComplete: () => false,
      nextSegment: () => null,
      sealAfter: () => null,
    };
    let run = departStage(writeStageProgram(createStageRun("procedure", initial), program));
    for (let index = 0; index < 8; index++) {
      run = step(run, dynamics);
      expect(run.phase, `procedure step ${index + 1}: ${run.statusReason}`).toBe("running");
    }
    expect(run.events.filter((event) => event.actor === "hero").map((event) => event.target)).toEqual([
      "first", "second", "first", "second", "first", "second", "first", "second",
    ]);
    expect(run.notebook.deaths).toBe(0);
  });

  it("does not treat changing mechanism phases as a stationary repeat", () => {
    const initial = makeWorld(2, "02-clock", [makeEntity(boxId, "상자", "02-clock", 2, { movable: true })]);
    const dynamics: StageDynamics = {
      execute: (world) => ({ world, outcome: "done", reason: "장치의 다음 박자를 기다렸어요." }),
      advance: (world) => ({ world: { ...world, tick: world.tick + 1 }, events: [], canChange: true, waitKey: String(world.tick % 2) }),
      segmentComplete: () => false,
      nextSegment: () => null,
      sealAfter: () => null,
    };
    let run = departStage(writeStageProgram(createStageRun("clock", initial), boxProgram));
    for (let index = 0; index < 8; index++) {
      run = step(run, dynamics);
      expect(run.phase, `clock phase ${index + 1}: ${run.statusReason}`).toBe("running");
    }
    expect(run.notebook.deaths).toBe(0);
  });
});
