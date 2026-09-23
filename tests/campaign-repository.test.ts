import { describe, expect, it } from "vitest";
import { isStageId } from "../src/campaign/catalog";
import {
  campaignAuthority,
  type CampaignStoredRun,
} from "../src/campaign/authority";
import {
  CampaignRepository,
  type CampaignDocumentMutation,
  type CampaignDocumentStore,
  type CampaignRepositoryResult,
} from "../src/campaign/repository";
import type { RunCompletionAuthority } from "../src/campaign/progress";
import type { StageId } from "../src/campaign/types";
import { LEGACY_ROOMS as ROOMS } from "../src/game/chapter-layout";
import { addInstruction, newRun } from "../src/game/core";
import {
  STORAGE_KEY,
  makeSave,
  type StorageLike,
  writeSave,
} from "../src/game/storage";
import type { Interpretation, SaveData } from "../src/game/types";

interface TestRun {
  id: string;
  stageId: StageId;
  phase: "active" | "cleared";
  steps: number;
}

const authority: RunCompletionAuthority<TestRun> = {
  serialize: (run) => ({ ...run }),
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      !("stageId" in value) ||
      !("phase" in value) ||
      !("steps" in value) ||
      typeof value.id !== "string" ||
      !isStageId(value.stageId) ||
      (value.phase !== "active" && value.phase !== "cleared") ||
      !Number.isInteger(value.steps) ||
      Number(value.steps) < 0
    ) {
      return null;
    }
    return {
      id: value.id,
      stageId: value.stageId,
      phase: value.phase,
      steps: Number(value.steps),
    };
  },
  describe: (run) => ({ runId: run.id, stageId: run.stageId }),
  isCleared: (run) => run.phase === "cleared",
};

const migrateLegacyRun = (save: SaveData): TestRun => ({
  id: save.state.id,
  stageId: 1,
  phase: save.state.phase === "cleared" ? "cleared" : "active",
  steps: save.state.revision,
});

const forwardInterpretation: Interpretation = {
  action: "advance",
  appliesTo: ["clear"],
  uncertainty: 0,
  model: "fixture",
  rulesVersion: "1",
};

function storeFailure(
  code: "read" | "write",
  message: string,
): CampaignRepositoryResult<never> {
  return { ok: false, error: { code, message } };
}

class MemoryDocumentStore implements CampaignDocumentStore {
  current: unknown | null = null;
  failNextWrite = false;

  async read(): Promise<CampaignRepositoryResult<unknown | null>> {
    return {
      ok: true,
      value: this.current === null ? null : structuredClone(this.current),
    };
  }

  async mutate<Result>(
    transform: (
      current: unknown | null,
    ) => CampaignRepositoryResult<CampaignDocumentMutation<Result>>,
  ): Promise<CampaignRepositoryResult<Result>> {
    const before = this.current === null ? null : structuredClone(this.current);
    const mutation = transform(before);
    if (!mutation.ok) return mutation;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return storeFailure("write", "injected write failure");
    }
    this.current = structuredClone(mutation.value.document);
    return { ok: true, value: mutation.value.result };
  }
}

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function stamp(state: { writer: string; revision: number }) {
  return { writer: state.writer, revision: state.revision };
}

function makeLegacyFixture(
  id: string,
  cleared: boolean,
  savedAt: number,
): SaveData {
  const base = { ...newRun(false), id };
  const lastRoom = ROOMS.length - 1;
  const state = cleared
    ? {
        ...base,
        phase: "cleared" as const,
        room: lastRoom,
        point: ROOMS[lastRoom].points.length,
      }
    : base;
  return makeSave(state, { writer: "legacy-tab", savedAt });
}

describe("campaign repository transactions", () => {
  it("creates an independent campaign document with stage 1 unlocked", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const result = await repository.loadOrCreate("tab-a");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.stages[0].status).toBe("unlocked");
    expect(result.value.state.stages.slice(1).every((stage) => stage.status === "locked")).toBe(true);
    expect(result.value.activeRuns).toEqual([]);
    expect(result.value.archives).toEqual([]);
  });

  it("atomically archives a verified completion, clears active, and unlocks next", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const activeRun: TestRun = {
      id: "run-1",
      stageId: 1,
      phase: "active",
      steps: 3,
    };
    const active = await repository.saveActiveRun(activeRun, {
      writer: "tab-a",
      expected: stamp(initial.value.state),
    });
    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const completed = await repository.completeActiveRun(
      { ...activeRun, phase: "cleared", steps: 4 },
      {
        writer: "tab-a",
        expected: stamp(active.value.state),
        completedAt: 50,
      },
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.state.stages[0].status).toBe("completed");
    expect(completed.value.state.stages[0].activeRun).toBeNull();
    expect(completed.value.state.stages[1].status).toBe("unlocked");
    expect(completed.value.activeRuns).toEqual([]);
    expect(completed.value.archives).toEqual([
      {
        reference: { runId: "run-1", stageId: 1 },
        completedAt: 50,
        run: { ...activeRun, phase: "cleared", steps: 4 },
      },
    ]);
    expect((await repository.load())).toEqual(completed);
  });

  it("archives completed-stage replays while preserving the first completion", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    if (!initial.ok) return;
    const firstRun: TestRun = {
      id: "first",
      stageId: 1,
      phase: "active",
      steps: 1,
    };
    const firstActive = await repository.saveActiveRun(firstRun, {
      writer: "tab-a",
      expected: stamp(initial.value.state),
    });
    if (!firstActive.ok) return;
    const first = await repository.completeActiveRun(
      { ...firstRun, phase: "cleared" },
      {
        writer: "tab-a",
        expected: stamp(firstActive.value.state),
        completedAt: 1,
      },
    );
    if (!first.ok) return;

    const replayRun: TestRun = {
      id: "replay",
      stageId: 1,
      phase: "active",
      steps: 2,
    };
    const replayActive = await repository.saveActiveRun(replayRun, {
      writer: "tab-b",
      expected: stamp(first.value.state),
    });
    expect(replayActive.ok).toBe(true);
    if (!replayActive.ok) return;
    const replayed = await repository.completeActiveRun(
      { ...replayRun, phase: "cleared" },
      {
        writer: "tab-b",
        expected: stamp(replayActive.value.state),
        completedAt: 2,
      },
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value.state.stages[0].completion?.run.runId).toBe("first");
    expect(replayed.value.state.stages[1].status).toBe("unlocked");
    expect(replayed.value.archives.map((item) => item.reference.runId)).toEqual([
      "first",
      "replay",
    ]);
  });

  it("rejects stale stamps and leaves the current bytes unchanged", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    if (!initial.ok) return;
    const first = await repository.saveActiveRun(
      { id: "latest", stageId: 1, phase: "active", steps: 1 },
      { writer: "tab-b", expected: stamp(initial.value.state) },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const bytes = structuredClone(documentStore.current);

    const stale = await repository.saveActiveRun(
      { id: "stale", stageId: 1, phase: "active", steps: 1 },
      { writer: "tab-a", expected: stamp(initial.value.state) },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("conflict");
    expect(documentStore.current).toEqual(bytes);
  });

  it("persists shared settings with the same optimistic transaction contract", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const updated = await repository.updateSettings(
      { muted: true, reducedMotion: true },
      { writer: "tab-b", expected: stamp(initial.value.state) },
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.state.settings).toEqual({
      muted: true,
      reducedMotion: true,
    });
    expect(updated.value.state.revision).toBe(1);
    expect((await repository.load())).toEqual(updated);

    const beforeConflict = structuredClone(documentStore.current);
    const stale = await repository.updateSettings(
      { muted: false, reducedMotion: false },
      { writer: "tab-c", expected: stamp(initial.value.state) },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("conflict");
    expect(documentStore.current).toEqual(beforeConflict);

    const activeRun: TestRun = {
      id: "settings-run",
      stageId: 1,
      phase: "active",
      steps: 1,
    };
    const active = await repository.saveActiveRun(activeRun, {
      writer: "tab-b",
      expected: stamp(updated.value.state),
    });
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    const completed = await repository.completeActiveRun(
      { ...activeRun, phase: "cleared" },
      {
        writer: "tab-b",
        expected: stamp(active.value.state),
        completedAt: 5,
      },
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.state.stages[1].status).toBe("unlocked");
    expect(completed.value.state.settings).toEqual({
      muted: true,
      reducedMotion: true,
    });
    expect(completed.value.archives).toHaveLength(1);
  });

  it("commits an active run and accompanying settings in one revision", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const saved = await repository.saveActiveRun(
      { id: "run-with-settings", stageId: 1, phase: "active", steps: 1 },
      {
        writer: "tab-b",
        expected: stamp(initial.value.state),
        settings: { muted: true, reducedMotion: false },
      },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.state.revision).toBe(initial.value.state.revision + 1);
    expect(saved.value.state.settings).toEqual({
      muted: true,
      reducedMotion: false,
    });
    expect(saved.value.activeRuns).toHaveLength(1);
    expect((await repository.load())).toEqual(saved);
  });

  it("rolls back the run when accompanying settings are invalid", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const before = structuredClone(documentStore.current);
    const result = await repository.saveActiveRun(
      { id: "invalid-settings-run", stageId: 1, phase: "active", steps: 1 },
      {
        writer: "tab-b",
        expected: stamp(initial.value.state),
        settings: { muted: "yes", reducedMotion: false } as never,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-state");
    expect(documentStore.current).toEqual(before);
    expect(await repository.load()).toEqual(initial);
  });

  it("does not partially unlock or archive when the atomic write fails", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    if (!initial.ok) return;
    const activeRun: TestRun = {
      id: "run-1",
      stageId: 1,
      phase: "active",
      steps: 1,
    };
    const active = await repository.saveActiveRun(activeRun, {
      writer: "tab-a",
      expected: stamp(initial.value.state),
    });
    if (!active.ok) return;
    const before = structuredClone(documentStore.current);
    documentStore.failNextWrite = true;
    const failed = await repository.completeActiveRun(
      { ...activeRun, phase: "cleared" },
      {
        writer: "tab-a",
        expected: stamp(active.value.state),
        completedAt: 2,
      },
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("write");
    expect(documentStore.current).toEqual(before);
    const loaded = await repository.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value) {
      expect(loaded.value.state.stages[0].status).toBe("unlocked");
      expect(loaded.value.archives).toEqual([]);
    }
  });

  it("reports corrupt documents and unavailable IndexedDB as results", async () => {
    const documentStore = new MemoryDocumentStore();
    documentStore.current = {
      state: { version: 1, writer: "tab-a", revision: 0, stages: [] },
      activeRuns: [],
      archives: [],
    };
    const corruptRepository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const corrupt = await corruptRepository.load();
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe("corrupt");

    const unavailableRepository = new CampaignRepository(authority, {
      indexedDB: null,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const unavailable = await unavailableRepository.load();
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.code).toBe("unavailable");
  });

  it("maps a throwing payload parser to corruption instead of rejecting", async () => {
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const initial = await repository.loadOrCreate("tab-a");
    if (!initial.ok) return;
    const active = await repository.saveActiveRun(
      { id: "run-1", stageId: 1, phase: "active", steps: 1 },
      { writer: "tab-a", expected: stamp(initial.value.state) },
    );
    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const throwingAuthority: RunCompletionAuthority<TestRun> = {
      ...authority,
      parse: () => {
        throw new Error("parser failed");
      },
    };
    const throwingRepository = new CampaignRepository(throwingAuthority, {
      documentStore,
      legacyStorage: null,
      legacyArchiveReader: null,
    });
    const result = await throwingRepository.load();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("corrupt");
  });

  it("migrates only an authoritative valid cleared legacy stage 1 save", async () => {
    const legacyStorage = new MemoryStorage();
    const legacySave = makeLegacyFixture("legacy-clear", true, 77);
    expect(
      writeSave(legacySave, { storage: legacyStorage, expected: null }).ok,
    ).toBe(true);
    const originalBytes = legacyStorage.getItem(STORAGE_KEY);

    const repository = new CampaignRepository(authority, {
      documentStore: new MemoryDocumentStore(),
      legacyStorage,
      migrateLegacyRun,
      legacyArchiveReader: null,
    });
    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.state.stages[0]).toMatchObject({
      status: "completed",
      completion: {
        run: { runId: legacySave.state.id, stageId: 1 },
        completedAt: 77,
        source: "legacy",
      },
    });
    expect(migrated.value.state.stages[1].status).toBe("unlocked");
    expect(migrated.value.archives).toEqual([
      {
        reference: { runId: legacySave.state.id, stageId: 1 },
        completedAt: 77,
        run: migrateLegacyRun(legacySave),
      },
    ]);
    expect(legacyStorage.getItem(STORAGE_KEY)).toBe(originalBytes);
  });

  it("imports an ongoing replay and all completed archives idempotently", async () => {
    const legacyStorage = new MemoryStorage();
    const current = makeLegacyFixture("legacy-replay", false, 30);
    expect(
      writeSave(current, { storage: legacyStorage, expected: null }).ok,
    ).toBe(true);
    const archived = [
      makeLegacyFixture("legacy-clear-1", true, 10),
      makeLegacyFixture("legacy-clear-2", true, 20),
    ];
    const originalRaw = legacyStorage.getItem(STORAGE_KEY);
    const originalArchives = structuredClone(archived);
    let archiveReads = 0;
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage,
      migrateLegacyRun,
      legacyArchiveReader: async () => {
        archiveReads += 1;
        return archived;
      },
    });

    const migrated = await repository.loadOrCreate("new-tab");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.state.stages[0]).toMatchObject({
      status: "completed",
      activeRun: { runId: "legacy-replay", stageId: 1 },
      completion: { source: "legacy" },
    });
    expect(migrated.value.state.stages[1].status).toBe("unlocked");
    expect(migrated.value.activeRuns[0]?.reference.runId).toBe("legacy-replay");
    expect(migrated.value.archives.map((item) => item.reference.runId)).toEqual([
      "legacy-clear-1",
      "legacy-clear-2",
    ]);

    const rerun = await repository.loadOrCreate("other-tab");
    expect(rerun).toEqual(migrated);
    expect(archiveReads).toBe(1);
    expect(legacyStorage.getItem(STORAGE_KEY)).toBe(originalRaw);
    expect(archived).toEqual(originalArchives);
  });

  it("preserves an ongoing tutorial as stage 1 active without unlocking stage 2", async () => {
    const legacyStorage = new MemoryStorage();
    const tutorialState = addInstruction(
      { ...newRun(true), id: "legacy-tutorial" },
      "앞으로 전진해",
      forwardInterpretation,
    );
    const tutorialSave = makeSave(tutorialState, {
      writer: "legacy-tutorial-tab",
      settings: { muted: true, reducedMotion: true },
      savedAt: 12,
    });
    expect(
      writeSave(tutorialSave, { storage: legacyStorage, expected: null }).ok,
    ).toBe(true);
    const originalRaw = legacyStorage.getItem(STORAGE_KEY);
    const repository = new CampaignRepository<CampaignStoredRun>(
      campaignAuthority(() => null),
      {
        documentStore: new MemoryDocumentStore(),
        legacyStorage,
        legacyArchiveReader: null,
        migrateLegacyRun: (save) => ({ kind: "legacy", save }),
      },
    );
    const result = await repository.loadOrCreate("new-tab");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.stages[0]).toMatchObject({
      status: "unlocked",
      activeRun: { runId: "legacy-tutorial", stageId: 1 },
      completion: null,
    });
    expect(result.value.state.stages[1].status).toBe("locked");
    expect(result.value.state.settings).toEqual({
      muted: true,
      reducedMotion: true,
    });
    expect(result.value.archives).toEqual([]);
    expect(result.value.activeRuns[0]?.run).toMatchObject({
      kind: "legacy",
      save: {
        state: {
          tutorial: true,
          tutorialStep: 1,
          instructions: tutorialState.instructions,
        },
      },
    });
    expect(legacyStorage.getItem(STORAGE_KEY)).toBe(originalRaw);
  });

  it("uses the latest archive settings when no current save exists", async () => {
    const legacyStorage = new MemoryStorage();
    const older = {
      ...makeLegacyFixture("older", true, 10),
      settings: { muted: true, reducedMotion: false },
    };
    const newer = {
      ...makeLegacyFixture("newer", true, 20),
      settings: { muted: false, reducedMotion: true },
    };
    const repository = new CampaignRepository(authority, {
      documentStore: new MemoryDocumentStore(),
      legacyStorage,
      legacyArchiveReader: async () => [older, newer],
      migrateLegacyRun,
    });
    const result = await repository.loadOrCreate("new-tab");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state.settings).toEqual({
        muted: false,
        reducedMotion: true,
      });
    }
  });

  it("deduplicates an identical current completion and archive", async () => {
    const legacyStorage = new MemoryStorage();
    const completed = makeLegacyFixture("same-clear", true, 10);
    expect(
      writeSave(completed, { storage: legacyStorage, expected: null }).ok,
    ).toBe(true);
    const repository = new CampaignRepository(authority, {
      documentStore: new MemoryDocumentStore(),
      legacyStorage,
      migrateLegacyRun,
      legacyArchiveReader: async () => [structuredClone(completed)],
    });
    const result = await repository.loadOrCreate("new-tab");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.archives).toHaveLength(1);
  });

  it("rejects conflicting duplicate legacy IDs before creating the new root", async () => {
    const legacyStorage = new MemoryStorage();
    const current = makeLegacyFixture("same-clear", true, 10);
    const conflict = makeLegacyFixture("same-clear", true, 11);
    expect(
      writeSave(current, { storage: legacyStorage, expected: null }).ok,
    ).toBe(true);
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage,
      migrateLegacyRun,
      legacyArchiveReader: async () => [conflict],
    });
    const result = await repository.loadOrCreate("new-tab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("conflict");
    expect(documentStore.current).toBeNull();
  });

  it("keeps legacy data and the new DB empty when archive reading fails", async () => {
    const legacyStorage = new MemoryStorage();
    const current = makeLegacyFixture("legacy-active", false, 10);
    expect(
      writeSave(current, { storage: legacyStorage, expected: null }).ok,
    ).toBe(true);
    const originalRaw = legacyStorage.getItem(STORAGE_KEY);
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage,
      migrateLegacyRun,
      legacyArchiveReader: async () => {
        throw new Error("archive read failed");
      },
    });
    const result = await repository.loadOrCreate("new-tab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("read");
    expect(documentStore.current).toBeNull();
    expect(legacyStorage.getItem(STORAGE_KEY)).toBe(originalRaw);
  });

  it("leaves malformed legacy bytes untouched and does not create a campaign", async () => {
    const legacyStorage = new MemoryStorage();
    legacyStorage.setItem(STORAGE_KEY, "{broken");
    const documentStore = new MemoryDocumentStore();
    const repository = new CampaignRepository(authority, {
      documentStore,
      legacyStorage,
      migrateLegacyRun,
      legacyArchiveReader: null,
    });
    const result = await repository.loadOrCreate("new-tab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("corrupt");
    expect(documentStore.current).toBeNull();
    expect(legacyStorage.getItem(STORAGE_KEY)).toBe("{broken");
  });
});
