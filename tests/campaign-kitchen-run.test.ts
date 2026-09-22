import { describe, expect, it } from "vitest";
import { KITCHEN_STAGE } from "../src/campaign/stages/kitchen";
import { stageDynamics } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { advanceStage, createStageRun, departStage, type StageRun } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import type { InstructionProgram, PhysicalAction, ProgramNode } from "../src/campaign/types";

const dynamics = stageDynamics(KITCHEN_STAGE);

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function wait(entity: string, property: string, value: string | number | boolean, comparison: "eq" | "gte" = "eq"): ProgramNode {
  return { kind: "wait", until: { kind: "property", entity, property, comparison, value, source: "visible" } };
}

function instruction(id: string, region: string, children: ProgramNode[]): InstructionProgram {
  return {
    version: 2,
    id,
    text: `${region}에서 보이는 사건을 기다려 물리적으로 이동한다.`,
    model: "typed-regression",
    scope: { stageId: 3, region },
    guard: false,
    body: { kind: "sequence", children },
  };
}

function saved(run: StageRun): StageRun {
  const parsed = parseStageRun(JSON.parse(JSON.stringify(run)));
  expect(parsed).not.toBeNull();
  return parsed!;
}

function expectLetterStable(run: StageRun): void {
  expect(run.world.entities.letter.parent).toBe("hero");
  expect(run.world.entities.letter.properties.dry).toBe(true);
  expect(run.world.actors.hero.carrying).toContain("letter");
  expect(run.world.entities.letter.location).toEqual(run.world.actors.hero.location);
}

function playBookmark(run: StageRun, program: InstructionProgram, expectedNext: string | "cleared"): StageRun {
  expect(run.phase).toBe("bookmark");
  expect(run.world.segmentId).toBe(program.scope.region);
  expect(run.notebook.canWrite).toBe(true);
  let next: StageRun = { ...run, notebook: writeProgram(run.notebook, program) };
  next = departStage(next);
  let roundTrippedMidWait = false;
  for (let step = 0; step < 80 && next.world.segmentId === program.scope.region && next.phase !== "cleared"; step += 1) {
    next = advanceStage(next, dynamics);
    expect(next.phase, next.statusReason ?? "stage run stopped").not.toBe("blocked");
    if (next.phase === "waiting" && !roundTrippedMidWait) {
      next = saved(next);
      roundTrippedMidWait = true;
    }
  }
  expect(roundTrippedMidWait).toBe(true);
  if (expectedNext === "cleared") expect(next.phase).toBe("cleared");
  else {
    expect(next.phase).toBe("bookmark");
    expect(next.world.segmentId).toBe(expectedNext);
  }
  expectLetterStable(next);
  return saved(next);
}

describe("continuous clockwork-kitchen StageRun", () => {
  it("runs 03-1 through 03-5 with scoped notebook programs and serialized waits/bookmarks", () => {
    let run = createStageRun("kitchen-continuous", KITCHEN_STAGE.segments[0].enter(null));
    expectLetterStable(run);

    run = playBookmark(run, instruction("kitchen-03-1", "03-1", [
      wait("03-1-steam-pipe", "active", false),
      action("move", "03-1-passage"),
    ]), "03-2");

    run = playBookmark(run, instruction("kitchen-03-2", "03-2", [
      wait("03-2-claw", "phase", "away"),
      action("push", "03-2-tray", { destination: "03-2-exit-stand" }),
    ]), "03-3");

    run = playBookmark(run, instruction("kitchen-03-3", "03-3", [
      wait("03-3-dough", "size", 2, "gte"),
      action("turn", "03-3-lamp"),
      wait("03-3-dough", "firmness", "hard"),
      action("move", "03-3-exit-ledge"),
    ]), "03-4");

    run = playBookmark(run, instruction("kitchen-03-4", "03-4", [
      wait("03-4-star-plate", "amount", 1),
      action("push", "03-4-star-plate", { destination: "03-4-scale" }),
    ]), "03-5");

    run = playBookmark(run, instruction("kitchen-03-5", "03-5", [
      action("pull", "03-5-bread", { destination: "03-5-cooling-rack" }),
      wait("03-5-bread", "firmness", "hard"),
      action("take", "03-5-bread"),
      action("move", "03-5-wait-b"),
      action("place", "03-5-bread", { destination: "03-5-plate" }),
      wait("03-5-table", "aligned", true),
      action("move", "03-5-wait-c"),
      action("take", "03-5-plate"),
      wait("03-5-steam", "active", false),
      action("move", "03-5-door"),
    ]), "cleared");

    expect(run.clearedSegments).toEqual(["03-1", "03-2", "03-3", "03-4", "03-5"]);
    expect(run.notebook.instructions).toHaveLength(5);
    expect(run.notebook.instructions.map((item) => item.scope.region)).toEqual(["03-5", "03-4", "03-3", "03-2", "03-1"]);
    expect(run.notebook.bells).toBe(0);
    expect(run.world.entities["03-5-plate"].parent).toBe("hero");
    expect(run.world.actors.hero.carrying).toEqual(expect.arrayContaining(["letter", "03-5-plate"]));
    expect(run.world.entities["03-5-plate"].location).toEqual(run.world.actors.hero.location);
    expect(run.world.entities["03-5-bread"].location).toEqual(run.world.actors.hero.location);
    expect(run.events.filter((event) => event.instructionId?.startsWith("kitchen-") && event.actor === "hero")
      .every((event) => event.instructionId === `kitchen-${event.segmentId}`)).toBe(true);
  });

  it("rewinds one physical timing failure, then skips retained missing-target programs in later rooms", () => {
    let run = createStageRun("kitchen-failure", KITCHEN_STAGE.segments[0].enter(null));
    run.notebook = writeProgram(run.notebook, instruction("kitchen-bad-timing", "03-1", [
      action("move", "03-1-passage"),
    ]));
    run = departStage(run);
    run = advanceStage(run, dynamics);
    expect(run.phase).toBe("bookmark");
    expect(run.world.segmentId).toBe("03-1");
    expect(run.world.attempt).toBe(2);
    expect(run.notebook.bells).toBe(1);
    expect(run.notebook.instructions.map((item) => item.id)).toEqual(["kitchen-bad-timing"]);
    expectLetterStable(run);
    run = saved(run);

    run = playBookmark(run, instruction("kitchen-recovery-03-1", "03-1", [
      wait("03-1-steam-pipe", "active", false),
      action("move", "03-1-exit"),
    ]), "03-2");
    run = playBookmark(run, instruction("kitchen-recovery-03-2", "03-2", [
      wait("03-2-claw", "phase", "away"),
      action("push", "03-2-tray", { destination: "03-2-exit-stand" }),
    ]), "03-3");

    expect(run.notebook.bells).toBe(1);
    expect(run.notebook.instructions.map((item) => item.id)).toEqual([
      "kitchen-recovery-03-2",
      "kitchen-recovery-03-1",
      "kitchen-bad-timing",
    ]);
    const secondRoomActions = run.events.filter((event) => event.segmentId === "03-2" && event.actor === "hero");
    expect(secondRoomActions.length).toBeGreaterThan(0);
    expect(secondRoomActions.every((event) => event.instructionId === "kitchen-recovery-03-2")).toBe(true);
  });
});
