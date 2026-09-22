import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
const legacyKey = "one-line-per-death:save";
const campaignDatabase = "one-line-per-death:campaign";
const archiveDatabase = "one-line-per-death:chronicles";
const endpoint = "/api/campaign-interpret";
const cancelOnly = process.env.CANCEL_ONLY === "true";

type HttpTrace = { status: number; latencyMs: number; model: string | null; error: string | null };

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
const checks: string[] = [];
const liveCalls: HttpTrace[] = [];

function watch(page: Page, name: string, traces?: HttpTrace[]) {
  const starts = new WeakMap<object, number>();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    // The deliberate 422 unknown-object probe is surfaced by Chromium as a
    // resource error even though the UI handles it as a clarification.
    if (message.type() === "error" && !/^Failed to load resource: the server responded with a status of 422/.test(message.text())) {
      errors.push(`${name} console: ${message.text()}`);
    }
  });
  if (!traces) return;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === endpoint) starts.set(request, performance.now());
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== endpoint) return;
    const started = starts.get(response.request()) ?? performance.now();
    let model: string | null = null;
    let error: string | null = null;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object") {
        const value = body as { program?: { model?: unknown }; error?: { code?: unknown } };
        model = typeof value.program?.model === "string" ? value.program.model : null;
        error = typeof value.error?.code === "string" ? value.error.code : null;
      }
    } catch {
      error = "unreadable_response";
    }
    traces.push({ status: response.status(), latencyMs: Math.round(performance.now() - started), model, error });
  });
}

async function resetStorage(page: Page) {
  await page.goto(`${base}/favicon.svg`);
  await page.evaluate(
    async ({ campaign, archive, key }) => {
      const remove = (name: string) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`blocked deleting ${name}`));
      });
      await remove(campaign); await remove(archive); localStorage.removeItem(key);
    },
    { campaign: campaignDatabase, archive: archiveDatabase, key: legacyKey },
  );
}

async function campaignDocument(page: Page) {
  return page.evaluate(
    ({ database, store }) => new Promise<any>((resolve, reject) => {
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

async function makeCompletedStageOne(page: Page) {
  await page.evaluate(async (key) => {
    const load = (path: string): Promise<Record<string, any>> => import(/* @vite-ignore */ path);
    const [{ newRun }, { ROOMS }, { makeSave }] = await Promise.all([
      load("/src/game/core.ts"), load("/src/game/content.ts"), load("/src/game/storage.ts"),
    ]);
    const room = ROOMS.length - 1;
    const state = {
      ...newRun(false), id: "browser-deepseek-stage-one-complete", phase: "cleared" as const,
      room, point: ROOMS[room].points.length, revision: 61,
    };
    localStorage.setItem(key, JSON.stringify(makeSave(state, {
      writer: "browser-deepseek-fixture", savedAt: 123456,
      tutorialCompleted: true, settings: { muted: true, reducedMotion: true },
    })));
  }, legacyKey);
}

async function stageTwo(page: Page) {
  const card = page.locator(".roadmap-stop").filter({
    has: page.getByRole("heading", { name: "비에 잠긴 회랑", exact: true }),
  });
  await expect(card.locator(".roadmap-status")).toHaveText("열린 문");
  await card.getByRole("button", { name: "들어가기" }).click();
  await expect(page.getByRole("heading", { name: "떠오르는 짐" })).toBeVisible();
}

async function enterFreshStageTwo(page: Page) {
  await resetStorage(page);
  await makeCompletedStageOne(page);
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "편지가 닿을 때까지" })).toBeVisible();
  await stageTwo(page);
}

try {
  if (!cancelOnly) {
    // This is a dedicated context: its IndexedDB and legacy seed cannot affect an existing browser profile.
    const liveContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await liveContext.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
    const page = await liveContext.newPage();
    watch(page, "live", liveCalls);
    await enterFreshStageTwo(page);

    const beforeUnknown = await campaignDocument(page);
    await page.locator("#campaign-instruction").fill("보이지 않는 유리 상자를 옮겨");
    await page.getByRole("button", { name: "뜻 확인하기" }).click();
    await expect(page.getByRole("button", { name: "뜻 확인하기" })).toBeEnabled({ timeout: 12_000 });
    await expect(page.getByText("이렇게 움직일게요")).toHaveCount(0);
    expect(await campaignDocument(page)).toEqual(beforeUnknown);
    checks.push("unknown-object DeepSeek clarification/rejection leaves the stage-2 IndexedDB document and writing economy unchanged");

    const instruction = "빈 코르크 상자를 물가 탑승 윤곽에 놓고 그 위에 올라 맞은편 민트 발판에서 내려.";
    await page.locator("#campaign-instruction").fill(instruction);
    await page.getByRole("button", { name: "뜻 확인하기" }).click();
    await expect(page.getByRole("heading", { name: "이렇게 움직일게요" })).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(".campaign-intent")).toContainText("빈 코르크 상자");
    await expect(page.locator(".campaign-intent")).toContainText("맞은편 민트 발판");
    await page.screenshot({ path: `artifacts/${label}-campaign-deepseek-preview.png`, fullPage: true });
    await page.getByRole("button", { name: "이 뜻으로 메모하기" }).click();
    await expect(page.locator(".campaign-notes")).toContainText(instruction);
    const afterConfirm = await campaignDocument(page);
    const confirmed = afterConfirm.activeRuns.find((item: any) => item.reference.stageId === 2)?.payload.run;
    expect(confirmed.notebook.instructions).toHaveLength(1);
    expect(confirmed.notebook.instructions[0].model).toBe("deepseek-flash");
    expect(confirmed.phase).toBe("bookmark");
    checks.push("the DeepSeek preview was explicitly confirmed and persisted as a deepseek-flash stage-2 note");

    await page.getByRole("button", { name: "이 메모로 출발 →" }).click();
    await expect(page.getByRole("heading", { name: "두 물길" })).toBeVisible({ timeout: 12_000 });
    const advanced = await campaignDocument(page);
    const advancedRun = advanced.activeRuns.find((item: any) => item.reference.stageId === 2)?.payload.run;
    expect(advancedRun.world.segmentId).toBe("02-2");
    expect(advancedRun.phase).toBe("bookmark");
    expect(advancedRun.clearedSegments).toContain("02-1");
    await page.screenshot({ path: `artifacts/${label}-campaign-deepseek-stage2-bookmark.png`, fullPage: true });
    checks.push("the confirmed note departed through real scheduler/physics and reached the actual stage-2 first-segment completion bookmark");
    expect(liveCalls).toHaveLength(2);
    expect(liveCalls[0].status).toBeGreaterThanOrEqual(400);
    expect(liveCalls[1]).toMatchObject({ status: 200, model: "deepseek-flash" });
    await page.close(); await liveContext.close();
  }

  // A separate no-network context proves that an obsolete delayed response cannot create a note or retry.
  const cancelContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await cancelContext.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  const cancelPage = await cancelContext.newPage();
  watch(cancelPage, "cancel");
  await enterFreshStageTwo(cancelPage);
  let delayedCalls = 0;
  await cancelPage.route(`**${endpoint}`, async (route) => {
    delayedCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ program: {
      version: 2, id: "delayed-browser-fixture", text: "빈 코르크 상자를 물가 탑승 윤곽에 놓아",
      model: "browser-delayed-fixture", scope: { stageId: 2, region: "02-1" }, guard: false,
      body: { kind: "action", actor: "hero", verb: "place", target: "rain-cork", destination: "rain-launch" },
    } }) });
  });
  const beforeCancel = await campaignDocument(cancelPage);
  await cancelPage.locator("#campaign-instruction").fill("빈 코르크 상자를 물가 탑승 윤곽에 놓아");
  await cancelPage.getByRole("button", { name: "뜻 확인하기" }).click();
  await expect(cancelPage.getByRole("button", { name: "뜻을 읽고 있어요…" })).toBeVisible();
  await expect(cancelPage.getByRole("button", { name: "확인 취소" })).toBeVisible();
  await cancelPage.getByRole("button", { name: "확인 취소" }).click();
  await expect(cancelPage.getByRole("status")).toContainText("뜻 확인을 취소했어요");
  await cancelPage.locator("#campaign-instruction").fill("취소한 문장");
  await cancelPage.waitForTimeout(500);
  await expect(cancelPage.getByText("이렇게 움직일게요")).toHaveCount(0);
  expect(delayedCalls).toBe(1);
  expect(await campaignDocument(cancelPage)).toEqual(beforeCancel);
  await cancelPage.screenshot({ path: `artifacts/${label}-campaign-deepseek-cancelled.png`, fullPage: true });
  checks.push("the explicit cancel button permits a new draft; its delayed stale response makes no candidate, no IndexedDB write, and no extra API request");
  await cancelPage.close(); await cancelContext.close();

  expect(errors).toEqual([]);
  const report = { base, checkedAt: new Date().toISOString(), passed: true, provider: "deepseek-flash", liveCalls, checks, errors };
  await writeFile(`artifacts/${label}-browser-campaign-deepseek.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { base, checkedAt: new Date().toISOString(), passed: false, provider: "deepseek-flash", liveCalls, checks, errors, failure: error instanceof Error ? error.message : String(error) };
  await writeFile(`artifacts/${label}-browser-campaign-deepseek.json`, JSON.stringify(report, null, 2)).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
