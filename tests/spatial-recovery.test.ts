import { expect, it } from "vitest";
import { campaignAuthority } from "../src/campaign/authority";
import type { CampaignStageDefinition } from "../src/campaign/level";
import { createCampaignState } from "../src/campaign/progress";
import { CampaignRepository, type CampaignDocumentStore, type CampaignDocumentMutation, type CampaignRepositoryResult, type CampaignRecoveryRecord } from "../src/campaign/repository";
import { createStageRun } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import type { WorldEvent } from "../src/campaign/types";
import { RAIN_INTRO, RAIN_PRACTICE } from "./fixtures/campaign-worlds/rain";

class MemoryDocumentStore implements CampaignDocumentStore {
  current: unknown = null;
  async read(): Promise<CampaignRepositoryResult<unknown | null>> {
    return { ok: true, value: structuredClone(this.current) };
  }
  async mutate<Result>(transform: (current: unknown | null) => CampaignRepositoryResult<CampaignDocumentMutation<Result>>): Promise<CampaignRepositoryResult<Result>> {
    const result = transform(structuredClone(this.current));
    if (result.ok) this.current = structuredClone(result.value.document);
    return result.ok ? { ok: true, value: result.value.result } : result;
  }
}

const stage: CampaignStageDefinition = {
  id: 2,
  title: "spatial fixture",
  contentRevision: "spatial-v1",
  practice: RAIN_PRACTICE,
  segments: Array.from({ length: 5 }, (_, index) => ({ ...RAIN_INTRO, id: `02-${index + 1}` })),
  story: { afterSegment: "02-1", object: "fixture", text: "" },
};
const authority = campaignAuthority((id) => id === 2 ? stage : null);
const reference = { stageId: 2 as const, runId: "old-two" };
function oldActivePayload() {
  return { kind: "world" as const, run: createStageRun(reference.runId, RAIN_INTRO.enter(null)) };
}
function v3Root(payload = oldActivePayload()) {
  const state = createCampaignState("old-writer");
  state.stages[0] = { stageId: 1, status: "completed", activeRun: null, completion: { run: { stageId: 1, runId: "old-one" }, completedAt: 17, source: "legacy" } };
  state.stages[1] = { stageId: 2, status: "unlocked", activeRun: reference, completion: null };
  return { version: 3, state, activeRuns: [{ reference, payload }], archives: [] as { reference: typeof reference; payload: unknown; completedAt: number }[], recoveries: [] as CampaignRecoveryRecord[] };
}

it("moves a v3 shared-v1 active run into exact raw recovery, then loads a new v4 spatial run", async () => {
  const payload = oldActivePayload();
  const root = v3Root(payload);
  const store = new MemoryDocumentStore();
  store.current = structuredClone(root);
  const repository = new CampaignRepository(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null });
  const migrated = await repository.loadOrCreate("new-writer");
  expect(migrated.ok).toBe(true);
  if (!migrated.ok) return;
  expect((store.current as { version: number }).version).toBe(4);
  expect(migrated.value.state.stages[0].completion).toEqual(root.state.stages[0].completion);
  expect(migrated.value.state.stages[1].activeRun).toBeNull();
  expect(migrated.value.state.stages[1].status).toBe("unlocked");
  expect(migrated.value.activeRuns).toEqual([]);
  expect(migrated.value.recoveries).toMatchObject([{ kind: "active", reference, payload }]);
  expect(migrated.value.recoveries[0].payload).toEqual(root.activeRuns[0].payload);
  expect(payload).toEqual(root.activeRuns[0].payload);

  const fresh = createStageRun("new-two", RAIN_INTRO.enter(null), stage.contentRevision);
  const saved = await repository.saveActiveRun({ kind: "world", run: fresh }, {
    writer: "new-writer", expected: { writer: migrated.value.state.writer, revision: migrated.value.state.revision },
  });
  expect(saved.ok).toBe(true);
  const reloaded = await repository.loadOrCreate("another-writer");
  expect(reloaded.ok).toBe(true);
  if (!reloaded.ok) return;
  expect(reloaded.value.activeRuns[0]?.run).toMatchObject({ kind: "world", run: { id: "new-two", contentRevision: "spatial-v1" } });
  expect(reloaded.value.recoveries[0].payload).toEqual(payload);
});

it("continues migrating a v2 quiet-v1 root directly to v4", async () => {
  const root = v3Root();
  const payload = { kind: "world", run: { version: 2, contentRevision: "quiet-v1", id: reference.runId, stageId: 2, phase: "bookmark" } };
  const store = new MemoryDocumentStore();
  store.current = { ...root, version: 2, activeRuns: [{ reference, payload }], recoveries: undefined };
  const migrated = await new CampaignRepository(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null }).loadOrCreate("new-writer");
  expect(migrated.ok).toBe(true);
  if (!migrated.ok) return;
  expect((store.current as { version: number }).version).toBe(4);
  expect(migrated.value.recoveries[0].payload).toEqual(payload);
  expect(migrated.value.state.stages[1].activeRun).toBeNull();
});

it("preserves a v3 shared-v1 completion and previous v2 recovery without granting a new clear", async () => {
  const payload = oldActivePayload();
  payload.run.phase = "cleared";
  payload.run.notebook.canWrite = false;
  payload.run.notebook.departed = true;
  payload.run.notebook.editing = false;
  payload.run.clearedSegments = stage.segments.map((segment) => segment.id);
  expect(parseStageRun(payload.run)).not.toBeNull();
  const root = v3Root(payload);
  root.activeRuns = [];
  root.archives = [{ reference, payload, completedAt: 29 }];
  root.state.stages[1] = { stageId: 2, status: "completed", activeRun: null, completion: { run: reference, completedAt: 29, source: "campaign" } };
  root.state.stages[2] = { ...root.state.stages[2], status: "unlocked" };
  const olderPayload = { kind: "world", run: { version: 2, contentRevision: "quiet-v1", id: "older-three", stageId: 3, phase: "bookmark" } };
  root.recoveries = [{ kind: "active", reference: { stageId: 3, runId: "older-three" }, payload: olderPayload, recoveredAt: 11 }];
  const store = new MemoryDocumentStore();
  store.current = structuredClone(root);
  const migrated = await new CampaignRepository(authority, { documentStore: store, legacyStorage: null, legacyArchiveReader: null }).loadOrCreate("new-writer");
  expect(migrated.ok).toBe(true);
  if (!migrated.ok) return;
  expect(migrated.value.archives).toEqual([]);
  expect(migrated.value.state.stages[1].completion).toEqual({ run: reference, completedAt: 29, source: "content-recovery" });
  expect(migrated.value.state.stages[2].status).toBe("unlocked");
  expect(migrated.value.recoveries).toMatchObject([
    { kind: "archive", reference, payload, completedAt: 29 },
    { kind: "active", reference: { stageId: 3, runId: "older-three" }, payload: olderPayload, recoveredAt: 11 },
  ]);
});

it("rejects old geometry at current authority while parsing history, and rejects damaged motion", () => {
  const old = oldActivePayload();
  expect(parseStageRun(old.run)).not.toBeNull();
  expect(authority.parse(old)).toBeNull();
  const fresh = { ...old.run, contentRevision: "spatial-v1" as const };
  expect(authority.parse({ kind: "world", run: fresh })).not.toBeNull();

  const event: WorldEvent = { id: "event", tick: 0, attempt: 1, instructionId: null, actor: "hero", target: null,
    outcome: "safe", reason: "", changes: [], motion: { actor: "hero", kind: "walk", points: [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 1 }] } };
  const withMotion = structuredClone(fresh);
  withMotion.events = [event] as typeof withMotion.events;
  withMotion.history.entries = [{ kind: "action", revision: 1, life: 1, eventIds: [event.id] }];
  withMotion.revision = 1;
  withMotion.presentationHistory = [{ id: "presentation", before: withMotion.world, after: withMotion.world, events: [event], outcome: "safe", repeated: false, life: 1, attempt: 1 }];
  withMotion.presentation = withMotion.presentationHistory[0];
  expect(parseStageRun(withMotion)).not.toBeNull();
  for (const points of [
    [{ x: 0, y: 0, t: 0.7 }, { x: 1, y: 0, t: 0.4 }],
    [{ x: Infinity, y: 0, t: 0 }],
    [{ x: 1_000_001, y: 0, t: 0 }],
    Array.from({ length: 513 }, (_, index) => ({ x: index, y: 0, t: index / 512 })),
  ]) {
    const damaged = structuredClone(withMotion);
    damaged.events[0].motion!.points = points;
    expect(parseStageRun(damaged)).toBeNull();
  }
  const badLocation = structuredClone(fresh);
  badLocation.world.actors.hero.location.z = Infinity;
  expect(parseStageRun(badLocation)).toBeNull();
});
