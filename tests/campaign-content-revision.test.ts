import { describe, expect, it } from "vitest";
import { campaignAuthority, type CampaignStoredRun } from "../src/campaign/authority";
import { createCampaignState } from "../src/campaign/progress";
import {
  CampaignRepository,
  type CampaignDocumentMutation,
  type CampaignDocumentStore,
  type CampaignRepositoryResult,
} from "../src/campaign/repository";

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

const oldRun = (id: string, phase: "bookmark" | "cleared") => ({
  version: 2,
  contentRevision: "quiet-v1",
  id,
  stageId: 2,
  phase,
});

function unlocked(writer: string) {
  const state = createCampaignState(writer);
  state.stages[0] = {
    stageId: 1,
    status: "completed",
    activeRun: null,
    completion: { run: { stageId: 1, runId: "chapter-one" }, completedAt: 1, source: "legacy" },
  };
  state.stages[1] = { ...state.stages[1], status: "unlocked" };
  return state;
}

describe("shared-v1 content migration", () => {
  const authority = campaignAuthority(() => null);

  it("preserves a quiet-v1 active run as raw recovery and starts the chapter fresh", async () => {
    const store = new MemoryDocumentStore();
    const state = unlocked("old-tab");
    state.stages[1].activeRun = { stageId: 2, runId: "old-active" };
    const payload = { kind: "world", run: oldRun("old-active", "bookmark") };
    store.current = {
      version: 2,
      state,
      activeRuns: [{ reference: state.stages[1].activeRun, payload }],
      archives: [],
      recoveries: [],
    };
    const repository = new CampaignRepository<CampaignStoredRun>(authority, {
      documentStore: store,
      legacyStorage: null,
      legacyArchiveReader: null,
    });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.activeRuns).toEqual([]);
    expect(migrated.value.state.stages[1].activeRun).toBeNull();
    expect(migrated.value.recoveries).toContainEqual(expect.objectContaining({
      kind: "active",
      reference: { stageId: 2, runId: "old-active" },
      payload,
    }));
    expect(store.current).toMatchObject({ version: 3 });
  });

  it("keeps completed unlock evidence while moving the old archive bytes to recovery", async () => {
    const store = new MemoryDocumentStore();
    const state = unlocked("old-tab");
    state.stages[1] = {
      stageId: 2,
      status: "completed",
      activeRun: null,
      completion: { run: { stageId: 2, runId: "old-clear" }, completedAt: 88, source: "campaign" },
    };
    state.stages[2] = { ...state.stages[2], status: "unlocked" };
    const payload = { kind: "world", run: oldRun("old-clear", "cleared") };
    store.current = {
      version: 2,
      state,
      activeRuns: [],
      archives: [{ reference: { stageId: 2, runId: "old-clear" }, completedAt: 88, payload }],
      recoveries: [],
    };
    const repository = new CampaignRepository<CampaignStoredRun>(authority, {
      documentStore: store,
      legacyStorage: null,
      legacyArchiveReader: null,
    });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.state.stages[1]).toMatchObject({
      status: "completed",
      completion: { completedAt: 88, source: "content-recovery" },
    });
    expect(migrated.value.state.stages[2].status).toBe("unlocked");
    expect(migrated.value.archives).toEqual([]);
    expect(migrated.value.recoveries[0]).toMatchObject({ kind: "archive", payload });
  });
});
