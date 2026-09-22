import { describe, expect, it } from "vitest";
import { campaignAuthority, type CampaignStoredRun } from "../src/campaign/authority";
import { newRun } from "../src/game/core";
import { makeSave } from "../src/game/storage";
import { makeEntity, makeWorld, stageDynamics, stillWorld, type CampaignStageDefinition, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { createCampaignState } from "../src/campaign/progress";
import { CampaignRepository, type CampaignDocumentMutation, type CampaignDocumentStore, type CampaignRepositoryResult } from "../src/campaign/repository";
import { advanceStage, createCampaignRun, createStageRun, departStage } from "../src/campaign/run";
import type { InstructionProgram } from "../src/campaign/types";

class MemoryDocumentStore implements CampaignDocumentStore {
  current: unknown | null = null;
  async read(): Promise<CampaignRepositoryResult<unknown | null>> {
    return { ok: true, value: structuredClone(this.current) };
  }
  async mutate<Result>(transform: (current: unknown | null) => CampaignRepositoryResult<CampaignDocumentMutation<Result>>): Promise<CampaignRepositoryResult<Result>> {
    const result = transform(structuredClone(this.current));
    if (!result.ok) return result;
    this.current = structuredClone(result.value.document);
    return { ok: true, value: structuredClone(result.value.result) };
  }
}

function scene(id: string, failure = false): SegmentDefinition {
  return {
    id, title: id, goal: "도착점을 살펴보기", description: id, hints: ["하나", "둘", "셋"],
    enter: () => makeWorld(10, id, [makeEntity("goal", "도착점", id, 1, { properties: { done: false } })]),
    execute: (world, action) => {
      if (failure || action.verb !== "observe") return { world, outcome: "failure", reason: "안전한 시작점으로 돌아왔어요." };
      const next = structuredClone(world); next.entities.goal.properties.done = true;
      return { world: next, outcome: "done", reason: "도착점을 확인했어요." };
    },
    advance: stillWorld,
    complete: (world) => world.entities.goal.properties.done === true,
  };
}

const quietScenes = Array.from({ length: 6 }, (_, index) => scene(`10-v2-${index + 1}`, index === 1));
const quietStage: CampaignStageDefinition = {
  id: 10, title: "quiet fixture", contentRevision: "quiet-v1", segments: quietScenes,
  practice: scene("10-practice"), story: { afterSegment: "10-v2-1", object: "goal", text: "" },
};
const observe = (id: string): InstructionProgram => ({
  version: 2, id, text: "도착점을 살펴봐", model: "fixture", scope: {}, guard: false,
  body: { kind: "action", actor: "hero", verb: "observe", target: "goal" },
});

function oldWorldRun(id: string, cleared = false) {
  const segmentId = cleared ? "02-5" : "02-2";
  const run = createStageRun(id, makeWorld(2, segmentId, [makeEntity("old-goal", "옛 목표", segmentId, 1)]));
  if (cleared) {
    run.phase = "cleared";
    run.clearedSegments = ["02-1", "02-2", "02-3", "02-4", "02-5"];
  }
  return run;
}

function legacyUnlockedState(writer: string) {
  const state = createCampaignState(writer);
  state.stages[0] = {
    stageId: 1, status: "completed", activeRun: null,
    completion: { run: { stageId: 1, runId: "legacy-stage-1" }, completedAt: 1, source: "legacy" },
  };
  state.stages[1] = { ...state.stages[1], status: "unlocked" };
  return state;
}

describe("quiet content revision", () => {
  it("starts every scene with a fresh scratch notebook and a local checkpoint", () => {
    const authority = campaignAuthority((id) => id === 10 ? quietStage : null);
    let run = createCampaignRun("quiet-run", quietStage);
    expect(run).toMatchObject({ contentRevision: "quiet-v1", notebook: { scratch: true, bells: 0 }, sceneNotes: [] });
    expect(run.learning).toBeUndefined();
    expect(authority.parse({ kind: "world", run })).not.toBeNull();

    run.notebook = writeProgram(run.notebook, observe("first"));
    run = advanceStage(departStage(run), stageDynamics(quietStage));
    expect(run).toMatchObject({ phase: "bookmark", world: { segmentId: "10-v2-2" }, checkpoint: { segmentId: "10-v2-2" }, notebook: { scratch: true, instructions: [], bells: 0 }, clearedSegments: ["10-v2-1"], sceneNotes: [{ segmentId: "10-v2-1", text: "도착점을 살펴봐" }] });

    run.notebook = writeProgram(run.notebook, observe("retry"));
    run = advanceStage(departStage(run), stageDynamics(quietStage));
    expect(run).toMatchObject({ phase: "bookmark", world: { segmentId: "10-v2-2", attempt: 2 }, checkpoint: { segmentId: "10-v2-2", attempt: 1 }, notebook: { scratch: true, bells: 0, canWrite: true } });
    expect(run.sceneNotes).toEqual([
      { segmentId: "10-v2-1", text: "도착점을 살펴봐" },
      { segmentId: "10-v2-2", text: "도착점을 살펴봐" },
    ]);
    expect(authority.parse({ kind: "world", run })).not.toBeNull();

    const oldRevision = structuredClone(run);
    delete oldRevision.contentRevision;
    expect(authority.parse({ kind: "world", run: oldRevision })).toBeNull();
  });

  it("accumulates three authored seals without reusing an earlier scene checkpoint", () => {
    const segments = Array.from({ length: 6 }, (_, index) => scene(`10-v2-${index + 1}`));
    const stage: CampaignStageDefinition = { ...quietStage, segments };
    const base = stageDynamics(stage);
    const dynamics = {
      ...base,
      sealAfter: (id: string) => id === "10-v2-2" ? 1 : id === "10-v2-4" ? 2 : id === "10-v2-5" ? 3 : null,
    };
    let run = createCampaignRun("three-seals", stage);
    const seals = [0, 1, 1, 2, 3, 3];
    for (let index = 0; index < segments.length; index += 1) {
      run.notebook = writeProgram(run.notebook, observe(`seal-${index + 1}`));
      run = advanceStage(departStage(run), dynamics);
      expect(run.seal).toBe(seals[index]);
      if (index < segments.length - 1) {
        expect(run).toMatchObject({ phase: "bookmark", world: { segmentId: segments[index + 1].id }, checkpoint: { segmentId: segments[index + 1].id, attempt: 1 } });
        expect(run.notebook).toMatchObject({ scratch: true, instructions: [], bells: 0 });
      }
    }
    expect(run).toMatchObject({ phase: "cleared", world: { segmentId: "10-v2-6" }, checkpoint: { segmentId: "10-v2-6" }, clearedSegments: segments.map((item) => item.id), seal: 3 });
  });
});

describe("pre-revision campaign recovery", () => {
  const authority = campaignAuthority(() => null);

  it("atomically preserves an active run and makes the chapter start fresh", async () => {
    const store = new MemoryDocumentStore();
    const state = legacyUnlockedState("old-tab");
    const run = oldWorldRun("old-active");
    state.stages[1].activeRun = { stageId: 2, runId: run.id };
    const oldPayload = { kind: "world", run };
    store.current = { state, activeRuns: [{ reference: state.stages[1].activeRun, payload: oldPayload }], archives: [] };
    const repository = new CampaignRepository<CampaignStoredRun>(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.state.stages[1].activeRun).toBeNull();
    expect(migrated.value.activeRuns).toEqual([]);
    expect(migrated.value.recoveries).toHaveLength(1);
    expect(migrated.value.recoveries[0]).toMatchObject({ kind: "active", reference: { stageId: 2, runId: "old-active" }, payload: oldPayload });

    const revision = migrated.value.state.revision;
    const rerun = await repository.loadOrCreate("another-tab");
    expect(rerun).toEqual(migrated);
    if (rerun.ok) expect(rerun.value.state.revision).toBe(revision);
  });

  it("leaves a stage 1 active run playable while upgrading the document envelope", async () => {
    const store = new MemoryDocumentStore();
    const state = createCampaignState("old-tab");
    const save = makeSave(newRun(true), { writer: "old-tab", savedAt: 9 });
    state.stages[0].activeRun = { stageId: 1, runId: save.state.id };
    store.current = { state, activeRuns: [{ reference: state.stages[0].activeRun, payload: { kind: "legacy", save } }], archives: [] };
    const repository = new CampaignRepository<CampaignStoredRun>(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.state.stages[0].activeRun).toEqual({ stageId: 1, runId: save.state.id });
    expect(migrated.value.activeRuns[0]?.run).toEqual({ kind: "legacy", save });
    expect(migrated.value.recoveries).toEqual([]);
  });

  it("keeps completion, unlocks, timestamp, and raw archive as historical evidence", async () => {
    const store = new MemoryDocumentStore();
    const state = legacyUnlockedState("old-tab");
    const run = oldWorldRun("old-clear", true);
    state.stages[1] = { stageId: 2, status: "completed", activeRun: null, completion: { run: { stageId: 2, runId: run.id }, completedAt: 88, source: "campaign" } };
    state.stages[2] = { ...state.stages[2], status: "unlocked" };
    store.current = { state, activeRuns: [], archives: [{ reference: { stageId: 2, runId: run.id }, completedAt: 88, payload: { kind: "world", run } }] };
    const repository = new CampaignRepository<CampaignStoredRun>(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.state.stages[1]).toMatchObject({ status: "completed", completion: { completedAt: 88, source: "content-recovery", run: { runId: "old-clear" } } });
    expect(migrated.value.state.stages[2].status).toBe("unlocked");
    expect(migrated.value.archives).toEqual([]);
    expect(migrated.value.recoveries[0]).toMatchObject({ kind: "archive", completedAt: 88, reference: { stageId: 2, runId: "old-clear" } });
  });

  it("leaves the original document untouched when completion evidence is invalid", async () => {
    const store = new MemoryDocumentStore();
    const state = legacyUnlockedState("old-tab");
    const run = oldWorldRun("not-cleared");
    state.stages[1] = { stageId: 2, status: "completed", activeRun: null, completion: { run: { stageId: 2, runId: run.id }, completedAt: 88, source: "campaign" } };
    state.stages[2] = { ...state.stages[2], status: "unlocked" };
    store.current = { state, activeRuns: [], archives: [{ reference: { stageId: 2, runId: run.id }, completedAt: 88, payload: { kind: "world", run } }] };
    const original = structuredClone(store.current);
    const repository = new CampaignRepository<CampaignStoredRun>(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(false);
    expect(store.current).toEqual(original);
  });
});
