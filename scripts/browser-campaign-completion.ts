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
let interpretationRequests = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
await page.route("**/api/campaign-interpret", async (route) => {
  interpretationRequests += 1;
  await route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "completion test does not use AI" } }),
  });
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
        const open = indexedDB.open(database, 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
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
    localStorage.setItem(
      key,
      JSON.stringify(
        makeSave(
          {
            ...newRun(false),
            id: "browser-completion-legacy",
            phase: "cleared" as const,
            room,
            point: ROOMS[room].points.length,
            revision: 31,
          },
          {
            writer: "browser-completion-writer",
            savedAt: 123456,
            tutorialCompleted: true,
            settings: { muted: false, reducedMotion: true },
          },
        ),
      ),
    );
  }, legacyKey);
}

async function stageCard(title: string) {
  return page.locator(".roadmap-stop").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function injectFinalStageRun() {
  return page.evaluate(
    async ({ database, store }) => {
      const load = (path: string): Promise<Record<string, any>> =>
        import(/* @vite-ignore */ path);
      const [{ RAIN_STAGE }, { createStageRun, departStage }, { writeProgram }] =
        await Promise.all([
          load("/src/campaign/stages/rain.ts"),
          load("/src/campaign/run.ts"),
          load("/src/campaign/notebook.ts"),
        ]);
      const id = "browser-stage2-completion";
      let run = createStageRun(id, RAIN_STAGE.segments[4].enter(null));
      const world = structuredClone(run.world);
      world.attempt = 2;
      world.actors.hero.location = { ...world.entities["organ-exit"].location };
      world.actors.hero.riding = null;
      world.entities["organ-stone-bag"].parent = "organ-hook";
      world.entities["organ-gutter"].properties.orientation = 2;
      world.entities["organ-gutter"].properties.route = "small";
      world.entities["organ-door"].properties.open = true;
      world.entities["organ-door"].properties.supported = true;
      world.entities["organ-door"].properties.supportMethod = "counterweight";
      world.entities["organ-lift"].properties.lowerLatch = false;
      world.entities["organ-lift"].properties.level =
        world.entities["organ-lift"].properties.exitLevel;
      world.facts = [
        { entity: "organ-barrel", property: "amount", value: 1, attempt: 1, tick: 0 },
        { entity: "organ-barrel", property: "kind", value: "container", attempt: 1, tick: 0 },
        { entity: "organ-barrel", property: "amount", value: 2, attempt: 2, tick: 0 },
        { entity: "organ-barrel", property: "kind", value: "container", attempt: 2, tick: 0 },
      ];
      const program = {
        version: 2,
        id: "browser-final-observe",
        text: "위층 출구를 마지막으로 살펴봐",
        model: "browser-fixture-not-jev",
        scope: { stageId: 2, region: "02-5" },
        guard: false,
        body: {
          kind: "action",
          actor: "hero",
          verb: "observe",
          target: "organ-exit",
        },
      };
      run = {
        ...run,
        world,
        checkpoint: structuredClone(world),
        clearedSegments: ["02-1", "02-2", "02-3", "02-4"],
        notebook: writeProgram(run.notebook, program),
      };
      run = departStage(run);

      return new Promise<{ runId: string; revision: number }>((resolve, reject) => {
        const open = indexedDB.open(database, 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction(store, "readwrite");
          const objectStore = transaction.objectStore(store);
          const read = objectStore.get("root");
          let revision = 0;
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const current = read.result;
            revision = current.state.revision;
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
          };
          transaction.oncomplete = () => {
            db.close();
            resolve({ runId: id, revision });
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { database: campaignDatabase, store: "campaign" },
  );
}

try {
  await page.goto(`${base}/favicon.svg`);
  await deleteDatabase(campaignDatabase);
  await deleteDatabase(archiveDatabase);
  await page.evaluate((key) => localStorage.removeItem(key), legacyKey);
  await makeClearedLegacy();
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "편지가 닿을 때까지" })).toBeVisible();

  const fixture = await injectFinalStageRun();
  await page.reload({ waitUntil: "networkidle" });
  const second = await stageCard("비에 잠긴 회랑");
  await expect(second.locator(".roadmap-status")).toHaveText("모험 중");
  await second.getByRole("button", { name: "이어 걷기" }).click();
  await expect(page.getByRole("heading", { name: "빗물 오르간" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 문을 보러 가기 →" })).toBeVisible({
    timeout: 8_000,
  });

  const completed = await campaignDocument();
  expect(completed.state.revision).toBeGreaterThan(fixture.revision);
  expect(completed.state.stages[1]).toMatchObject({
    status: "completed",
    activeRun: null,
    completion: { source: "campaign", run: { stageId: 2, runId: fixture.runId } },
  });
  expect(completed.state.stages[2]).toMatchObject({ status: "unlocked" });
  expect(
    completed.activeRuns.some((item: any) => item.reference.stageId === 2),
  ).toBe(false);
  const archive = completed.archives.find(
    (item: any) => item.reference.runId === fixture.runId,
  );
  expect(archive).toBeTruthy();
  expect(archive.payload.kind).toBe("world");
  expect(archive.payload.run.phase).toBe("cleared");
  expect(archive.payload.run.clearedSegments).toEqual([
    "02-1",
    "02-2",
    "02-3",
    "02-4",
    "02-5",
  ]);
  await expect(page.getByRole("heading", { name: "빗물 오르간" })).toBeVisible();
  await expect(page.getByRole("img", { name: /빗물 오르간/ })).toBeVisible();
  checks.push("the completion commit archives the verified snapshot, removes the active run, and keeps the final scene mounted");

  const history = page.locator(".campaign-history");
  await history.locator(":scope > summary").click();
  await expect(history).toContainText("담긴 양: 2");
  await expect(history).not.toContainText("kind");
  await history.getByText("지난 시도의 관찰 · 근거 무효").click();
  await expect(history).toContainText("담긴 양: 1");
  checks.push("public current and expired facts remain readable while hidden metadata stays out of the DOM");

  const storyButton = page.getByRole("button", {
    name: "나란한 우비 걸이 살펴보기 · 선택",
  });
  await expect(storyButton).toBeVisible();
  await storyButton.click();
  await expect(page.getByText("왼쪽 고리는 늘 비워 뒀던 것 같은데.")).toBeVisible();
  await page.screenshot({
    path: `artifacts/${label}-campaign-stage2-completion-story.png`,
    fullPage: true,
  });
  checks.push("the optional stage story remains readable from the finished snapshot");

  await page.getByRole("button", { name: "다음 문을 보러 가기 →" }).click();
  await expect(page.getByRole("heading", { name: "편지가 닿을 때까지" })).toBeVisible();
  const completedSecond = await stageCard("비에 잠긴 회랑");
  const third = await stageCard("태엽 부엌");
  await expect(completedSecond.locator(".roadmap-status")).toHaveText("완료");
  await expect(third.locator(".roadmap-status")).toHaveText("열린 문");
  await expect(third.getByRole("button", { name: "들어가기" })).toBeEnabled();

  await page.reload({ waitUntil: "networkidle" });
  const reloadedSecond = await stageCard("비에 잠긴 회랑");
  const reloadedThird = await stageCard("태엽 부엌");
  await expect(reloadedSecond.locator(".roadmap-status")).toHaveText("완료");
  await expect(reloadedThird.locator(".roadmap-status")).toHaveText("열린 문");
  const reloaded = await campaignDocument();
  expect(reloaded.archives.some((item: any) => item.reference.runId === fixture.runId)).toBe(true);
  expect(reloaded.state.stages[2].status).toBe("unlocked");
  checks.push("the roadmap transition and stage 3 unlock survive a full reload");

  await reloadedSecond.getByRole("button", { name: "지난 메모 보기" }).click();
  await expect(page.getByRole("heading", { name: "지난 모험의 메모" })).toBeVisible();
  await page.getByRole("button", { name: /비에 잠긴 회랑/ }).click();
  await expect(page.getByRole("heading", { name: "비에 잠긴 회랑의 발자국" })).toBeVisible();
  await expect(page.getByRole("img", { name: /마지막 장면/ })).toBeVisible();
  await expect(page.getByText("위층 출구를 마지막으로 살펴봐", { exact: true })).toBeVisible();
  checks.push("the persisted archive reopens with its final scene and saved note");

  expect(interpretationRequests).toBe(0);
  expect(errors).toEqual([]);
  const report = {
    base,
    checkedAt: new Date().toISOString(),
    passed: true,
    fixture: "deterministic near-complete stage 2 run; actual Jev was not called",
    checks,
    errors,
  };
  await writeFile(
    `artifacts/${label}-browser-campaign-completion.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: `artifacts/${label}-campaign-completion-failure.png`,
    fullPage: true,
  }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close();
}
