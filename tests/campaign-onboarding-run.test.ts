import { describe, expect, it } from "vitest";
import { campaignAuthority } from "../src/campaign/authority";
import { STAGES } from "../src/campaign/catalog";
import { allStageSegments, makeEntity, makeWorld, stageDynamics, stillWorld, type CampaignStageDefinition, type SegmentDefinition } from "../src/campaign/level";
import { copyArchivedProgram, deleteProgram, rewindNotebook, writeProgram } from "../src/campaign/notebook";
import { advanceStage, createCampaignRun, createPracticeRun, createStageRun, departStage, type StageRun } from "../src/campaign/run";
import type { InstructionProgram, WorldState } from "../src/campaign/types";

const program = (id: string, text: string, verb: "observe" | "push" = "observe"): InstructionProgram => ({
  version: 2, id, text, model: "onboarding-fixture", scope: {}, guard: false,
  body: { kind: "action", actor: "hero", verb, target: "goal" },
});

function world(id: string, extras: ReturnType<typeof makeEntity>[] = []): WorldState {
  return makeWorld(2, id, [makeEntity("goal", "도착점", id, 1, { properties: { done: false } }), ...extras]);
}

function definition(id: string, enter: (previous: WorldState | null) => WorldState): SegmentDefinition {
  return {
    id, title: id, goal: "도착점을 확인해", description: id, hints: ["하나", "둘", "셋"], enter,
    execute: (current, action) => {
      if (action.verb === "push") return { world: current, outcome: "failure", reason: "안전 받침으로 돌아왔어요." };
      const next = structuredClone(current);
      next.entities.goal.properties.done = true;
      return { world: next, outcome: "done", reason: "목표를 확인했어요." };
    },
    advance: stillWorld,
    complete: (current) => current.entities.goal.properties.done === true,
  };
}

const introOne = definition("02-intro-1", () => world("02-intro-1", [makeEntity("intro-token", "연습 도구", "02-intro-1", 0, { properties: { learned: true } })]));
const introTwo = definition("02-intro-2", (previous) => world("02-intro-2", previous?.entities["intro-token"]?.properties.learned === true
  ? [makeEntity("carried-result", "이어진 결과", "02-intro-2", 0, { properties: { carried: true } })] : []));
const introThree = definition("02-intro-3", () => world("02-intro-3"));
const core = Array.from({ length: 5 }, (_, index) => definition(`02-${index + 1}`, () => world(`02-${index + 1}`)));
const fixtureStage: CampaignStageDefinition = {
  id: 2,
  title: "onboarding fixture",
  onboarding: [introOne, introTwo, introThree],
  segments: core,
  practice: definition("02-practice", () => world("02-practice")),
  story: { afterSegment: "02-1", object: "fixture", text: "" },
};

function finish(run: StageRun, id: string, text: string): StageRun {
  const written = { ...run, notebook: writeProgram(run.notebook, program(id, text)) };
  return advanceStage(departStage(written), stageDynamics(fixtureStage));
}

describe("campaign onboarding runtime", () => {
  it("publishes total, onboarding, and stable core counts without renumbering core definitions", () => {
    expect(STAGES.map((stage) => stage.segments)).toEqual([12, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    expect(STAGES.map((stage) => stage.coreSegments)).toEqual([8, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    expect(STAGES.map((stage) => stage.onboardingSegments)).toEqual([4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(fixtureStage.segments.map((segment) => segment.id)).toEqual(["02-1", "02-2", "02-3", "02-4", "02-5"]);
    expect(allStageSegments(fixtureStage).map((segment) => segment.id)).toEqual(["02-intro-1", "02-intro-2", "02-intro-3", "02-1", "02-2", "02-3", "02-4", "02-5"]);
  });

  it("keeps the one-line scratch notebook freely replaceable, deletable, and rewindable", () => {
    let book = createCampaignRun("scratch", fixtureStage).notebook;
    book = writeProgram(book, program("first", "첫 문장"));
    expect(book.canWrite).toBe(true);
    book = writeProgram(book, program("replacement", "고친 문장"), "first");
    book = rewindNotebook(book);
    book = deleteProgram(book, "replacement");
    book = writeProgram(book, program("last", "다시 쓴 문장"));
    expect(book.instructions.map((item) => item.text)).toEqual(["다시 쓴 문장"]);
    expect(book).toMatchObject({ scratch: true, erasers: 2, bells: 0, canWrite: true });
    expect(() => writeProgram(book, program("extra", "둘째 줄"))).toThrow("임시 한 줄");
    expect(() => copyArchivedProgram(book, program("archive", "본편 메모"))).toThrow("도입의 임시 한 줄");
  });

  it("starts optional practice with the same free scratch economy and no learning history", () => {
    const run = createPracticeRun("practice", fixtureStage.practice.enter(null));
    expect(run.notebook).toMatchObject({ scratch: true, canWrite: true, erasers: 2, bells: 0 });
    expect(run.learning).toBeUndefined();
    expect(rewindNotebook(run.notebook)).toMatchObject({ scratch: true, canWrite: true, erasers: 2, bells: 0 });
  });

  it("restores a failed intro for free and records each confirmed original sentence", () => {
    let run = createCampaignRun("failure", fixtureStage);
    run = { ...run, notebook: writeProgram(run.notebook, program("bad", "도착점을 밀어", "push")) };
    run.world.facts.push({ entity: "goal", property: "seen", value: true, attempt: 1, tick: 0 });
    run = advanceStage(departStage(run), stageDynamics(fixtureStage));
    expect(run).toMatchObject({ phase: "bookmark", world: { segmentId: "02-intro-1", attempt: 2 }, notebook: { bells: 0, erasers: 2, canWrite: true, scratch: true } });
    expect(run.world.facts).toEqual([]);
    expect(run.learning?.attemptedSentences).toEqual([{ segmentId: "02-intro-1", text: "도착점을 밀어" }]);
    run.notebook = writeProgram(run.notebook, program("fixed", "도착점을 확인해"), "bad");
    expect(run.notebook).toMatchObject({ bells: 0, erasers: 2 });
  });

  it("uses fresh scratch snapshots, carries only explicit intro state, then hard-resets into core", () => {
    let run = createCampaignRun("flow", fixtureStage);
    expect(run).toMatchObject({ world: { segmentId: "02-intro-1" }, checkpoint: { segmentId: "02-intro-1" }, notebook: { scratch: true } });

    run = finish(run, "one", "첫 도착점을 확인해");
    expect(run.world.segmentId).toBe("02-intro-2");
    expect(run.world.entities["carried-result"]?.properties.carried).toBe(true);
    expect(run.notebook.instructions).toEqual([]);
    expect(run.checkpoint).toEqual(run.world);
    expect(run.learning).toEqual({ completedSegmentIds: ["02-intro-1"], attemptedSentences: [{ segmentId: "02-intro-1", text: "첫 도착점을 확인해" }] });

    run = finish(run, "two", "둘째 도착점을 확인해");
    expect(run.world.segmentId).toBe("02-intro-3");
    expect(run.world.entities["carried-result"]).toBeUndefined();

    run.world.facts.push({ entity: "goal", property: "seen", value: true, attempt: 1, tick: 0 });
    run = finish(run, "three", "셋째 도착점을 확인해");
    expect(run.world.segmentId).toBe("02-1");
    expect(run.world.facts).toEqual([]);
    expect(run.checkpoint).toEqual(run.world);
    expect(run.notebook).toMatchObject({ instructions: [], visitedBookmarks: ["02-1"], erasers: 2, bells: 0, canWrite: true });
    expect(run.notebook.scratch).toBeUndefined();
    expect(run.execution.active).toBeNull();
    expect(run.clearedSegments).toEqual([]);
    expect(run.events).toEqual([]);
    expect(run.learning?.completedSegmentIds).toEqual(["02-intro-1", "02-intro-2", "02-intro-3"]);
  });

  it("accepts untouched version-2 core saves as exemptions but verifies new intro order", () => {
    const authority = campaignAuthority((id) => id === 2 ? fixtureStage : null);
    const initial = createCampaignRun("new", fixtureStage);
    expect(authority.parse({ kind: "world", run: initial })).not.toBeNull();

    const forgedOrder = structuredClone(initial);
    forgedOrder.learning!.completedSegmentIds = ["02-intro-2"];
    expect(authority.parse({ kind: "world", run: forgedOrder })).toBeNull();

    const skipped = createStageRun("skipped", core[0].enter(null));
    skipped.learning = { completedSegmentIds: [], attemptedSentences: [] };
    expect(authority.parse({ kind: "world", run: skipped })).toBeNull();

    const legacyIntro = createStageRun("legacy-intro", introOne.enter(null));
    expect(authority.parse({ kind: "world", run: legacyIntro })).toBeNull();

    const legacyClear = createStageRun("legacy-clear", core[0].enter(null));
    legacyClear.world = core[4].enter(null);
    legacyClear.world.entities.goal.properties.done = true;
    legacyClear.phase = "cleared";
    legacyClear.clearedSegments = core.map((segment) => segment.id);
    legacyClear.notebook.visitedBookmarks = [...legacyClear.clearedSegments];
    expect(authority.parse({ kind: "world", run: legacyClear })).not.toBeNull();
    expect(legacyClear.learning).toBeUndefined();
  });
});
