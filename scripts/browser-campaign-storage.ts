import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
await mkdir("artifacts", { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
// tsx preserves function names with a helper referenced by serialized callbacks.
await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
const page = await context.newPage();

try {
  await page.goto(base, { waitUntil: "networkidle" });
  const evidence = await page.evaluate(async () => {
    const load = (path: string): Promise<Record<string, any>> =>
      import(/* @vite-ignore */ path);
    const [repositoryModule, authorityModule, coreModule, contentModule, storageModule, archiveModule] =
      await Promise.all([
        load("/src/campaign/repository.ts"),
        load("/src/campaign/authority.ts"),
        load("/src/game/core.ts"),
        load("/src/game/chapter-layout.ts"),
        load("/src/game/storage.ts"),
        load("/src/game/archive.ts"),
      ]);
    const { CampaignRepository, CAMPAIGN_DATABASE } = repositoryModule;
    const { campaignAuthority } = authorityModule;
    const { newRun } = coreModule;
    const { LEGACY_ROOMS: ROOMS } = contentModule;
    const { makeSave, STORAGE_KEY } = storageModule;
    const { archiveStage, listStageArchives } = archiveModule;

    const deleteDatabase = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`blocked deleting ${name}`));
      });

    localStorage.removeItem(STORAGE_KEY);
    await deleteDatabase(CAMPAIGN_DATABASE);
    await deleteDatabase("one-line-per-death:chronicles");

    const currentState = { ...newRun(false), id: "browser-legacy-replay" };
    const currentSave = makeSave(currentState, {
      writer: "legacy-current",
      savedAt: 30,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSave));

    const finalRoom = ROOMS.length - 1;
    const archivedState = {
      ...newRun(false),
      id: "browser-legacy-clear",
      phase: "cleared",
      room: finalRoom,
      point: ROOMS[finalRoom].points.length,
    };
    const archivedSave = makeSave(archivedState, {
      writer: "legacy-archive",
      savedAt: 20,
    });
    await archiveStage(archivedSave);

    const sourceRawBefore = localStorage.getItem(STORAGE_KEY);
    const archiveRawBefore = JSON.stringify(await listStageArchives());
    const baseAuthority = campaignAuthority(() => null);
    let failSerialization = false;
    const authority = {
      ...baseAuthority,
      serialize(run: unknown) {
        const payload = baseAuthority.serialize(run);
        return failSerialization
          ? { ...payload, __uncloneable: () => undefined }
          : payload;
      },
    };
    const repository = new CampaignRepository(authority, {
      migrateLegacyRun: (save: unknown) => ({ kind: "legacy", save }),
    });

    const migrated = await repository.loadOrCreate("browser-tab-a");
    if (!migrated.ok) throw new Error(`migration failed: ${migrated.error.code}`);
    const migratedState = migrated.value.state;
    if (
      migratedState.stages[0].status !== "completed" ||
      migratedState.stages[0].activeRun?.runId !== "browser-legacy-replay" ||
      migratedState.stages[0].completion?.source !== "legacy" ||
      migratedState.stages[1].status !== "unlocked" ||
      migrated.value.archives.length !== 1
    ) {
      throw new Error("legacy snapshot was not migrated as one complete document");
    }

    const originalStamp = {
      writer: migratedState.writer,
      revision: migratedState.revision,
    };
    failSerialization = true;
    const aborted = await repository.saveActiveRun(
      { kind: "legacy", save: currentSave },
      { writer: "browser-tab-a", expected: originalStamp },
    );
    failSerialization = false;
    if (aborted.ok || aborted.error.code !== "write") {
      throw new Error("uncloneable payload did not abort the real IDB write");
    }
    const afterAbort = await repository.load();
    if (
      !afterAbort.ok ||
      afterAbort.value === null ||
      afterAbort.value.state.revision !== originalStamp.revision ||
      afterAbort.value.archives.length !== 1
    ) {
      throw new Error("aborted IDB write partially changed the root document");
    }

    const saved = await repository.saveActiveRun(
      { kind: "legacy", save: currentSave },
      { writer: "browser-tab-b", expected: originalStamp },
    );
    if (!saved.ok) throw new Error(`active save failed: ${saved.error.code}`);
    const stale = await repository.saveActiveRun(
      { kind: "legacy", save: currentSave },
      { writer: "browser-tab-c", expected: originalStamp },
    );
    if (stale.ok || stale.error.code !== "conflict") {
      throw new Error("stale optimistic write was not rejected");
    }

    const clearedReplayState = {
      ...currentSave.state,
      phase: "cleared",
      room: finalRoom,
      point: ROOMS[finalRoom].points.length,
    };
    const clearedReplaySave = makeSave(clearedReplayState, {
      writer: "legacy-current",
      savedAt: 40,
    });
    const replayed = await repository.completeActiveRun(
      { kind: "legacy", save: clearedReplaySave },
      {
        writer: "browser-tab-b",
        expected: {
          writer: saved.value.state.writer,
          revision: saved.value.state.revision,
        },
        completedAt: 40,
      },
    );
    if (!replayed.ok) throw new Error(`replay archive failed: ${replayed.error.code}`);
    if (
      replayed.value.archives.length !== 2 ||
      replayed.value.state.stages[0].completion?.run.runId !==
        "browser-legacy-clear" ||
      replayed.value.state.stages[0].activeRun !== null ||
      replayed.value.state.stages[1].status !== "unlocked"
    ) {
      throw new Error("replay completion replaced canonical progress or was not archived");
    }

    const rerun = await repository.loadOrCreate("browser-tab-d");
    if (!rerun.ok || rerun.value.state.revision !== replayed.value.state.revision) {
      throw new Error("migration rerun was not idempotent");
    }
    const sourceRawAfter = localStorage.getItem(STORAGE_KEY);
    const archiveRawAfter = JSON.stringify(await listStageArchives());
    return {
      migratedRevision: migratedState.revision,
      abortCode: aborted.error.code,
      conflictCode: stale.error.code,
      finalRevision: replayed.value.state.revision,
      archiveIds: replayed.value.archives.map(
        (item: { reference: { runId: string } }) => item.reference.runId,
      ),
      sourceRawPreserved: sourceRawAfter === sourceRawBefore,
      archiveRawPreserved: archiveRawAfter === archiveRawBefore,
      sourceRawBefore,
      sourceRawAfter,
      archiveRawBefore,
      archiveRawAfter,
    };
  });

  expect(evidence.abortCode).toBe("write");
  expect(evidence.conflictCode).toBe("conflict");
  expect(evidence.archiveIds).toEqual([
    "browser-legacy-clear",
    "browser-legacy-replay",
  ]);
  expect(evidence.sourceRawPreserved).toBe(true);
  expect(evidence.archiveRawPreserved).toBe(true);
  console.log(JSON.stringify({ passed: true, base, evidence }, null, 2));
  await writeFile(
    `artifacts/${label}-browser-campaign-storage.json`,
    JSON.stringify(
      { base, checkedAt: new Date().toISOString(), passed: true, evidence },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
