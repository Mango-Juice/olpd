import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
const legacyKey = "one-line-per-death:save";
const campaignDatabase = "one-line-per-death:campaign";
const archiveDatabase = "one-line-per-death:chronicles";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
const page = await context.newPage();
const errors: string[] = [];
const checks: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

async function deleteDatabase(name: string) {
  await page.evaluate(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(database);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`blocked deleting ${database}`));
      }),
    name,
  );
}

async function campaignDocument() {
  return page.evaluate(
    ({ database, store }) =>
      new Promise<any>((resolve, reject) => {
        const request = indexedDB.open(database, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(store, "readonly");
          const read = transaction.objectStore(store).get("root");
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => db.close();
        };
      }),
    { database: campaignDatabase, store: "campaign" },
  );
}

async function makeClearedLegacy() {
  await page.evaluate(async (key) => {
    const load = (path: string): Promise<Record<string, any>> =>
      import(/* @vite-ignore */ path);
    const [{ newRun }, { ROOMS }, { makeSave }] = await Promise.all([
      load("/src/game/core.ts"),
      load("/src/game/content.ts"),
      load("/src/game/storage.ts"),
    ]);
    const room = ROOMS.length - 1;
    const state = {
      ...newRun(false),
      id: "browser-clarification-legacy",
      phase: "cleared" as const,
      room,
      point: ROOMS[room].points.length,
      revision: 27,
    };
    localStorage.setItem(
      key,
      JSON.stringify(
        makeSave(state, {
          writer: "browser-clarification-writer",
          savedAt: 123456,
          tutorialCompleted: true,
          settings: { muted: false, reducedMotion: true },
        }),
      ),
    );
  }, legacyKey);
}

async function stageCard(title: string) {
  return page.locator(".roadmap-stop").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function injectRunningClarificationFixture(runId: string, text: string) {
  await page.evaluate(
    async ({ database, store, id, badText }) => {
      const load = (path: string): Promise<Record<string, any>> =>
        import(/* @vite-ignore */ path);
      const [{ RAIN_STAGE }, { createStageRun, departStage }, { writeProgram }] =
        await Promise.all([
          load("/tests/fixtures/campaign-worlds/rain.ts"),
          load("/src/campaign/run.ts"),
          load("/src/campaign/notebook.ts"),
        ]);
      const original = {
        version: 2,
        id: `${id}-original`,
        text: "출발 돌턱을 살펴봐",
        model: "browser-fixture-not-jev",
        scope: { stageId: 2, region: "02-1" },
        guard: false,
        body: { kind: "action", actor: "hero", verb: "observe", target: "rain-start" },
      };
      const impossible = {
        ...original,
        id: `${id}-bad`,
        text: badText,
        body: { kind: "action", actor: "hero", verb: "take", target: "rain-start" },
      };
      let run = createStageRun(id, RAIN_STAGE.segments[0].enter(null));
      let notebook = writeProgram(run.notebook, original);
      // A later bookmark grants another write. Replacing the earlier line records
      // one refundable eraser without changing this fixture's attempt number.
      notebook = { ...notebook, canWrite: true, editing: true };
      notebook = writeProgram(notebook, impossible, original.id);
      run = departStage({ ...run, notebook });

      const document = await new Promise<any>((resolve, reject) => {
        const open = indexedDB.open(database, 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction(store, "readwrite");
          const objectStore = transaction.objectStore(store);
          let output: any;
          const read = objectStore.get("root");
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const current = read.result;
            const reference = { stageId: 2, runId: id };
            current.activeRuns = [
              ...current.activeRuns.filter((item: any) => item.reference.stageId !== 2),
              { reference, payload: { kind: "world", run } },
            ];
            current.state.stages[1] = {
              ...current.state.stages[1],
              activeRun: reference,
            };
            objectStore.put(current, "root");
            output = current;
          };
          transaction.oncomplete = () => {
            db.close();
            resolve(output);
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
      return document;
    },
    { database: campaignDatabase, store: "campaign", id: runId, badText: text },
  );
}

function stageTwoRun(document: any) {
  return document.activeRuns.find((item: any) => item.reference.stageId === 2).payload.run;
}

async function resumeStageTwo() {
  await page.reload({ waitUntil: "networkidle" });
  const card = await stageCard("비에 잠긴 회랑");
  await card.getByRole("button", { name: "이어 걷기" }).click();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();
}

try {
  await page.goto(`${base}/favicon.svg`);
  await deleteDatabase(campaignDatabase);
  await deleteDatabase(archiveDatabase);
  await page.evaluate((key) => localStorage.removeItem(key), legacyKey);
  await makeClearedLegacy();
  await page.goto(base, { waitUntil: "networkidle" });
  const second = await stageCard("비에 잠긴 회랑");
  await second.getByRole("button", { name: "들어가기" }).click();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();

  await page.route("**/api/campaign-interpret", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}");
    const repaired = String(request.text).includes("살펴");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        program: {
          version: 2,
          id: repaired ? "browser-repaired-observe" : "browser-fixed-take",
          text: request.text,
          model: "browser-fixture-not-jev",
          scope: { stageId: 2, region: "02-1" },
          guard: false,
          body: {
            kind: "action",
            actor: "hero",
            verb: repaired ? "observe" : "take",
            target: "rain-start",
          },
        },
      }),
    });
  });

  const beforePreflight = await campaignDocument();
  const invalidText = "고정된 출발 돌턱을 집어";
  await page.locator("#campaign-instruction").fill(invalidText);
  await page.getByRole("button", { name: "뜻 확인하기" }).click();
  await expect(page.getByText("이렇게 움직일게요")).toBeVisible();
  await page.getByRole("button", { name: "이 뜻으로 메모하기" }).click();
  await expect(page.getByRole("status")).toContainText("작성 기회와 지우개는 그대로");
  expect(await campaignDocument()).toEqual(beforePreflight);
  const preflightRun = stageTwoRun(await campaignDocument());
  expect(preflightRun.world.attempt).toBe(1);
  expect(preflightRun.notebook).toMatchObject({ canWrite: true, erasers: 2, bells: 0 });
  await page.screenshot({
    path: `artifacts/${label}-campaign-preflight-clarification.png`,
    fullPage: true,
  });
  checks.push("fixed-object take is rejected by preflight without an IndexedDB or economy change");

  const badText = "출발 돌턱을 집어서 가져가";
  await injectRunningClarificationFixture("browser-runtime-clarification", badText);
  await resumeStageTwo();
  await expect(page.getByRole("heading", { name: "메모를 고쳐 쓰기" })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#campaign-instruction")).toHaveValue(badText);
  await expect(page.getByRole("status")).toContainText("무료로 고칠 수 있어요");
  await expect(page.getByRole("button", { name: "이 메모로 출발 →" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "종 1회 · 되감고 한 줄 쓰기" })).toBeDisabled();
  let runtimeRun = stageTwoRun(await campaignDocument());
  expect(runtimeRun.phase).toBe("bookmark");
  expect(runtimeRun.world.attempt).toBe(2);
  expect(runtimeRun.world.actors.hero.location).toEqual(runtimeRun.checkpoint.actors.hero.location);
  expect(runtimeRun.notebook).toMatchObject({
    canWrite: true,
    editing: true,
    erasers: 2,
    bells: 0,
  });
  expect(runtimeRun.notebook.writeCosts["browser-runtime-clarification-bad"]).toBeUndefined();
  await page.screenshot({
    path: `artifacts/${label}-campaign-runtime-clarification.png`,
    fullPage: true,
  });

  await resumeStageTwo();
  await expect(page.locator("#campaign-instruction")).toHaveValue(badText);
  await expect(page.getByRole("button", { name: "수정 · 무료 확인" })).toBeEnabled();
  const repairText = "출발 돌턱을 살펴봐";
  await page.locator("#campaign-instruction").fill(repairText);
  await page.getByRole("button", { name: "뜻 확인하기" }).click();
  await expect(page.getByText("이렇게 움직일게요")).toBeVisible();
  await page.getByRole("button", { name: "이 뜻으로 메모하기" }).click();
  await expect(page.getByRole("heading", { name: "이번 생에 남길 한 줄" })).toBeVisible();
  runtimeRun = stageTwoRun(await campaignDocument());
  expect(runtimeRun.world.attempt).toBe(2);
  expect(runtimeRun.world.actors.hero.location).toEqual(runtimeRun.checkpoint.actors.hero.location);
  expect(runtimeRun.notebook).toMatchObject({ canWrite: false, erasers: 2, bells: 0 });
  expect(runtimeRun.notebook.instructions).toHaveLength(1);
  expect(runtimeRun.notebook.instructions[0].text).toBe(repairText);
  await expect(page.getByRole("button", { name: "이 메모로 출발 →" })).toBeEnabled();
  checks.push("runtime clarification rewinds to attempt 2, refunds its edit, persists, and accepts a free repair at the checkpoint");

  const deleteText = "고정 돌턱을 다시 집어";
  await injectRunningClarificationFixture("browser-delete-clarification", deleteText);
  await resumeStageTwo();
  await expect(page.getByRole("heading", { name: "메모를 고쳐 쓰기" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: "삭제 · 무료 확인" })).toBeEnabled();
  await page.getByRole("button", { name: "삭제 · 무료 확인" }).click();
  await expect(page.getByRole("heading", { name: "이번 생에 남길 한 줄" })).toBeVisible();
  await expect(page.locator("#campaign-instruction")).toHaveValue("");
  await expect(page.locator(".campaign-notes")).toBeEmpty();
  const deletedRun = stageTwoRun(await campaignDocument());
  expect(deletedRun.notebook).toMatchObject({ canWrite: true, erasers: 2, bells: 0 });
  expect(deletedRun.notebook.instructions).toEqual([]);
  await expect(page.getByRole("button", { name: "이 메모로 출발 →" })).toBeEnabled();
  await page.screenshot({
    path: `artifacts/${label}-campaign-clarification-deleted.png`,
    fullPage: true,
  });
  checks.push("deleting the rejected line is free, preserves the write chance, and clears editor identity");

  expect(errors).toEqual([]);
  const report = {
    base,
    checkedAt: new Date().toISOString(),
    passed: true,
    interpretationMode: "explicit browser fixture only; actual Jev was not called",
    checks,
    errors,
  };
  await writeFile(
    `artifacts/${label}-browser-campaign-clarification.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: `artifacts/${label}-campaign-clarification-failure.png`,
    fullPage: true,
  }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close();
}
