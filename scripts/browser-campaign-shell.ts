import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
const legacyKey = "one-line-per-death:save";
const campaignDatabase = "one-line-per-death:campaign";
const archiveDatabase = "one-line-per-death:chronicles";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
// tsx preserves function names with a helper referenced by serialized callbacks.
await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
const errors: string[] = [];
const checks: string[] = [];
const pages = new Set<Page>();

function watch(page: Page, name: string) {
  pages.add(page);
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${name} console: ${message.text()}`);
  });
}

async function resetStorage(
  page: Page,
  prepareLegacy?: () => Promise<string>,
) {
  await page.goto(`${base}/favicon.svg`);
  await page.evaluate(
    async ({ campaign, archive, key }) => {
      const remove = (name: string) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error(`blocked deleting ${name}`));
        });
      await remove(campaign);
      await remove(archive);
      localStorage.removeItem(key);
    },
    { campaign: campaignDatabase, archive: archiveDatabase, key: legacyKey },
  );
  return prepareLegacy?.();
}

async function campaignDocument(page: Page) {
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

async function legacyBytes(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), legacyKey);
}

async function stageCard(page: Page, title: string) {
  return page.locator(".roadmap-stop").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function makeClearedLegacy(page: Page) {
  return page.evaluate(async (key) => {
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
      id: "browser-shell-legacy-clear",
      phase: "cleared" as const,
      room,
      point: ROOMS[room].points.length,
      revision: 41,
    };
    const save = makeSave(state, {
      writer: "browser-shell-legacy-writer",
      savedAt: 123456,
      tutorialCompleted: true,
      settings: { muted: false, reducedMotion: false },
    });
    const raw = JSON.stringify(save);
    localStorage.setItem(key, raw);
    return raw;
  }, legacyKey);
}

try {
  const fresh = await context.newPage();
  watch(fresh, "fresh");
  await resetStorage(fresh);
  await fresh.goto(base, { waitUntil: "networkidle" });
  await expect(
    fresh.getByRole("button", { name: "프롤로그 건너뛰기" }),
  ).toBeVisible();
  await fresh.evaluate((key) => localStorage.setItem(key, "legacy-sentinel"), legacyKey);
  await fresh
    .getByRole("button", { name: "프롤로그 건너뛰기" })
    .click();
  await expect(fresh.locator("#instruction")).toBeVisible();
  await expect(
    fresh.getByRole("button", { name: "프롤로그 건너뛰기" }),
  ).toHaveCount(0);
  const skipped = await campaignDocument(fresh);
  expect(skipped.activeRuns).toHaveLength(1);
  expect(skipped.activeRuns[0].payload.kind).toBe("legacy");
  expect(skipped.activeRuns[0].payload.save.state.tutorial).toBe(false);
  expect(skipped.activeRuns[0].payload.save.state.canWrite).toBe(true);
  expect(skipped.activeRuns[0].payload.save.state.instructions).toEqual([]);
  expect(skipped.activeRuns[0].payload.save.state.deaths).toBe(0);
  expect(await legacyBytes(fresh)).toBe("legacy-sentinel");
  const skippedId = skipped.activeRuns[0].reference.runId;
  await fresh.reload({ waitUntil: "networkidle" });
  await expect(
    fresh.getByRole("button", { name: "모험 이어하기" }),
  ).toBeVisible();
  const reloadedSkip = await campaignDocument(fresh);
  expect(reloadedSkip.activeRuns[0].reference.runId).toBe(skippedId);
  expect(await legacyBytes(fresh)).toBe("legacy-sentinel");
  checks.push("fresh SKIP persists to IndexedDB and never overwrites the legacy key");
  await fresh.close();

  const page = await context.newPage();
  watch(page, "campaign");
  await resetStorage(page);
  const originalLegacy = await makeClearedLegacy(page);
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "편지가 닿을 때까지" }),
  ).toBeVisible();
  const first = await stageCard(page, "기억의 던전");
  const second = await stageCard(page, "비에 잠긴 회랑");
  const third = await stageCard(page, "태엽 부엌");
  await expect(first.locator(".roadmap-status")).toHaveText("완료");
  await expect(second.locator(".roadmap-status")).toHaveText("열린 문");
  await expect(third.locator(".roadmap-status")).toHaveText("잠김");
  await expect(second.getByRole("button", { name: "들어가기" })).toBeEnabled();
  await expect(third.getByRole("button", { name: "아직 닫힌 문" })).toBeDisabled();
  expect(await legacyBytes(page)).toBe(originalLegacy);
  const migrated = await campaignDocument(page);
  expect(migrated.state.stages[0].completion.source).toBe("legacy");
  expect(migrated.state.stages[1].status).toBe("unlocked");
  expect(migrated.state.stages[2].status).toBe("locked");
  checks.push("a valid cleared legacy save migrates to stage 1 complete, stage 2 open, stage 3 locked");
  await page.screenshot({
    path: `artifacts/${label}-campaign-roadmap-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `artifacts/${label}-campaign-roadmap-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await second.getByRole("button", { name: "들어가기" }).click();
  await expect(page.getByText("CHAPTER 2 · 비에 잠긴 회랑")).toBeVisible();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();
  const created = await campaignDocument(page);
  const stageTwo = created.activeRuns.find(
    (item: any) => item.reference.stageId === 2,
  );
  expect(stageTwo).toBeTruthy();
  const stageTwoId = stageTwo.reference.runId;
  await page.reload({ waitUntil: "networkidle" });
  const resumedCard = await stageCard(page, "비에 잠긴 회랑");
  await expect(resumedCard.locator(".roadmap-status")).toHaveText("모험 중");
  await resumedCard.getByRole("button", { name: "이어 걷기" }).click();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();
  const resumed = await campaignDocument(page);
  expect(
    resumed.activeRuns.find((item: any) => item.reference.stageId === 2)
      .reference.runId,
  ).toBe(stageTwoId);
  checks.push("stage 2 new run resumes with the same run id after reload");

  const corkButton = page.getByRole("button", { name: /빈 코르크 상자/ });
  await corkButton.click();
  const corkDetails = page.getByRole("region", {
    name: "빈 코르크 상자 관찰 정보",
  });
  await expect(corkDetails).toContainText("재료 · 코르크");
  await expect(corkDetails).toContainText("수용 한계 · 1칸");
  await expect(corkDetails).toContainText("닿는 거리 · 2칸");
  await expect(corkDetails).not.toContainText(/cork|driftAge|kind/);
  expect((await corkButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: `artifacts/${label}-campaign-stage2-desktop.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `artifacts/${label}-campaign-selected-entity.png`,
    fullPage: true,
  });
  checks.push("selected stage object uses Korean public facts and a 44px selection target");

  const beforePractice = JSON.stringify(await campaignDocument(page));
  await page.route("**/api/campaign-interpret", async (route) => {
    const request = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        program: {
          version: 2,
          id: "browser-practice-fixture",
          text: request.text,
          model: "browser-fixture-not-jev",
          scope: { stageId: 2, region: "02-practice" },
          guard: false,
          body: {
            kind: "action",
            actor: "hero",
            verb: "push",
            target: "practice-cork",
            destination: "practice-circle",
          },
        },
      }),
    });
  });
  await page.getByRole("button", { name: "비용 없는 연습" }).click();
  await expect(page.getByRole("heading", { name: "얕은 빗물 홈" })).toBeVisible();
  const practiceText = "작은 코르크 블록을 바닥 원으로 밀어";
  await page.locator("#campaign-instruction").fill(practiceText);
  await page.getByRole("button", { name: "뜻 확인하기" }).click();
  await expect(page.getByText("이렇게 움직일게요")).toBeVisible();
  await page.getByRole("button", { name: "이 뜻으로 메모하기" }).click();
  await expect(page.locator(".campaign-notes")).toContainText(practiceText);
  expect(JSON.stringify(await campaignDocument(page))).toBe(beforePractice);
  await page.getByRole("button", { name: "연습 마치기" }).click();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();
  await expect(page.locator(".campaign-notes")).not.toContainText(practiceText);
  expect(JSON.stringify(await campaignDocument(page))).toBe(beforePractice);
  checks.push("fixture-interpreted practice edits stay outside the main run and IndexedDB");

  await page.getByRole("button", { name: "비용 없는 연습" }).click();
  const unconfirmedText = "작은 코르크 블록을 원 옆으로 옮겨";
  await page.locator("#campaign-instruction").fill(unconfirmedText);
  await page.getByRole("button", { name: "뜻 확인하기" }).click();
  await expect(page.getByText("이렇게 움직일게요")).toBeVisible();
  await page.getByRole("button", { name: "연습 마치기" }).click();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();
  await expect(page.getByText("이렇게 움직일게요")).toHaveCount(0);
  await expect(page.locator("#campaign-instruction")).toHaveValue("");
  await expect(page.locator(".campaign-notes")).not.toContainText(unconfirmedText);
  expect(JSON.stringify(await campaignDocument(page))).toBe(beforePractice);
  checks.push("an unconfirmed practice candidate does not leak back into the main run");
  await page.unroute("**/api/campaign-interpret");

  await page.getByRole("button", { name: "소리 끄기", exact: true }).click();
  await expect(page.getByRole("button", { name: "소리 켜기", exact: true })).toBeVisible();
  // The repository commit replaces the controlled input node; assert the new node.
  await page.getByLabel("움직임 줄이기").click();
  await expect(page.getByLabel("움직임 줄이기")).toBeChecked();
  const settingsSaved = await campaignDocument(page);
  expect(settingsSaved.state.settings).toEqual({
    muted: true,
    reducedMotion: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "소리 켜기", exact: true })).toBeVisible();
  await expect(page.getByLabel("움직임 줄이기")).toBeChecked();
  expect((await campaignDocument(page)).state.settings).toEqual({
    muted: true,
    reducedMotion: true,
  });
  expect(await legacyBytes(page)).toBe(originalLegacy);
  checks.push("shared sound and reduced-motion settings persist across reload");

  const secondTab = await context.newPage();
  watch(secondTab, "second-tab");
  await secondTab.goto(base, { waitUntil: "networkidle" });
  await expect(
    secondTab.getByRole("heading", { name: "편지가 닿을 때까지" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "소리 켜기", exact: true }).click();
  await expect(
    secondTab.getByRole("heading", { name: "다른 창에서 이어진 모험" }),
  ).toBeVisible();
  await expect(secondTab.getByRole("alert")).toContainText("다른 창");
  await secondTab.screenshot({
    path: `artifacts/${label}-campaign-cross-tab-conflict.png`,
    fullPage: true,
  });
  checks.push("BroadcastChannel moves a stale second tab to the conflict recovery screen");
  await secondTab.close();
  await page.close();

  expect(errors).toEqual([]);
  const report = {
    base,
    checkedAt: new Date().toISOString(),
    passed: true,
    interpretationMode: "fixture only for practice UI; actual Jev was not called",
    checks,
    errors,
  };
  await writeFile(
    `artifacts/${label}-browser-campaign-shell.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const active = [...pages].find((page) => !page.isClosed());
  await active
    ?.screenshot({
      path: `artifacts/${label}-campaign-shell-failure.png`,
      fullPage: true,
    })
    .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...pages].map((page) => page.close().catch(() => {})));
  await browser.close();
}
