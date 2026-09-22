import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
const storageKey = "one-line-per-death:save";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
const checks: string[] = [];

const saved = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    storageKey,
  );

async function expectFreshMain(page: Page) {
  const save = await saved(page);
  expect(save.tutorialCompleted).toBe(true);
  expect(save.state.tutorial).toBe(false);
  expect(save.state.phase).toBe("ready");
  expect(save.state.room).toBe(0);
  expect(save.state.point).toBe(0);
  expect(save.state.instructions).toEqual([]);
  expect(save.state.canWrite).toBe(true);
  expect(save.state.erasers).toBe(2);
  expect(save.state.deaths).toBe(0);
  expect(save.state.penaltyDeaths).toBe(0);
  expect(save.state.events).toEqual([]);
  expect(save.state.history).toEqual({
    version: 1,
    complete: true,
    initialInstructions: [],
    entries: [],
  });
  await expect(page.locator("#instruction")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "프롤로그 건너뛰기" }),
  ).toHaveCount(0);
  return save;
}

async function reloadAndResume(page: Page, expectedId: string) {
  await page.reload();
  await expect(
    page.getByRole("button", { name: "모험 이어하기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "프롤로그 건너뛰기" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  const save = await expectFreshMain(page);
  expect(save.state.id).toBe(expectedId);
}

try {
  const initial = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  initial.on("pageerror", (error) => errors.push(`initial: ${error.message}`));
  await initial.goto(base);
  await expect(
    initial.getByRole("button", { name: "프롤로그 건너뛰기" }),
  ).toBeVisible();
  await initial
    .getByRole("button", { name: "프롤로그 건너뛰기" })
    .click();
  const initialSave = await expectFreshMain(initial);
  checks.push("title-screen skip starts a fresh writable main run");
  await initial.screenshot({
    path: `artifacts/${label}-prologue-skip-initial.png`,
    fullPage: true,
  });
  await reloadAndResume(initial, initialSave.state.id);
  checks.push("initial skip persists as completed and non-tutorial after reload");
  await initial.close();

  const pending = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pending.on("pageerror", (error) => errors.push(`pending: ${error.message}`));
  let releaseResponse!: () => void;
  const responseBarrier = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestReceived!: () => void;
  const received = new Promise<void>((resolve) => {
    requestReceived = resolve;
  });
  await pending.route("**/api/interpret", async (route) => {
    requestReceived();
    await responseBarrier;
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          action: "advance",
          appliesTo: ["clear"],
          uncertainty: 0,
          model: "delayed-browser-fixture",
          rulesVersion: "1",
        }),
      })
      .catch(() => {});
  });
  await pending.goto(base);
  await pending
    .getByRole("button", { name: "첫 번째 한 줄 남기기" })
    .click();
  await pending.locator("#instruction").fill("앞으로 전진해");
  await pending.locator("#instruction").press("Enter");
  await received;
  await expect(pending.getByRole("button", { name: "읽고 있어요" })).toBeVisible();
  await expect(
    pending.getByRole("button", { name: "프롤로그 건너뛰기" }),
  ).toBeVisible();
  await pending
    .getByRole("button", { name: "프롤로그 건너뛰기" })
    .click();
  const pendingSave = await expectFreshMain(pending);
  const skippedBytes = await pending.evaluate((key) => localStorage.getItem(key), storageKey);
  releaseResponse();
  await pending.waitForTimeout(750);
  expect(await pending.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(
    skippedBytes,
  );
  await expect(pending.locator(".interpretation")).toHaveCount(0);
  await expect(pending.locator("#instruction")).toHaveValue("");
  await expectFreshMain(pending);
  checks.push("skip aborts an in-flight interpretation and ignores its late response");
  await pending.screenshot({
    path: `artifacts/${label}-prologue-skip-pending.png`,
    fullPage: true,
  });
  await reloadAndResume(pending, pendingSave.state.id);
  checks.push("pending-request skip persists as completed and non-tutorial after reload");
  await pending.screenshot({
    path: `artifacts/${label}-prologue-skip-reload.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);

  const report = {
    base,
    checkedAt: new Date().toISOString(),
    passed: true,
    interpretationMode: "delayed fixture interception",
    checks,
    errors,
  };
  await writeFile(
    `artifacts/${label}-prologue-skip-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
