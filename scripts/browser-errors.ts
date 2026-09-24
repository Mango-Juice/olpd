import { chromium, webkit, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createFirstForkDeathSave } from "./browser-fixtures";
import { installChapterOneBrowserHarness } from "./chapter-one-browser-harness";
const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
await mkdir("artifacts", { recursive: true });
const browser = await (process.env.BROWSER === "webkit" ? webkit : chromium).launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
const page = await context.newPage();
await installChapterOneBrowserHarness(page);
const fixtureSave = createFirstForkDeathSave("browser-errors-fixture");
fixtureSave.settings.muted = false;
const fixture = JSON.stringify(fixtureSave);
const report: string[] = [];
try {
  await page.goto(base);
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    fixture,
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem("one-line-per-death:save"),
  );
  await page.route("**/api/interpret", (route) => route.abort("failed"));
  await page.locator("#instruction").fill("앞으로 전진해");
  await page.locator("#instruction").dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: false,
    bubbles: true,
  });
  await expect(page.locator(".error")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "읽고 있어요" }),
  ).not.toBeVisible();
  report.push("IME keyCode 229 does not submit even when isComposing is false");
  await page
    .getByRole("button", { name: /뜻을 확인해 볼까|기억하고 출발/ })
    .click();
  await expect(page.locator(".error")).toBeVisible();
  await expect(page.locator("#instruction")).toHaveValue("앞으로 전진해");
  expect(
    await page.evaluate(() => localStorage.getItem("one-line-per-death:save")),
  ).toBe(before);
  report.push(
    "Network failure preserves draft, score, erasers and writing slot",
  );
  await page.unroute("**/api/interpret");
  let resolve!: () => void;
  const barrier = new Promise<void>((r) => (resolve = r));
  let caught!: () => void;
  const received = new Promise<void>((r) => (caught = r));
  await page.route("**/api/interpret", async (route) => {
    caught();
    await barrier;
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          action: "advance",
          appliesTo: ["clear"],
          uncertainty: 0,
          model: "browser-late-response-fixture",
          rulesVersion: "1",
        }),
      })
      .catch(() => {});
  });
  const beforeLateResponse = await page.evaluate(() =>
    localStorage.getItem("one-line-per-death:save"),
  );
  await page
    .getByRole("button", { name: /뜻을 확인해 볼까|기억하고 출발/ })
    .click();
  await received;
  await page.locator("#instruction").fill("계속 앞으로 걸어");
  resolve();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: "기억하고 출발" })).toBeEnabled();
  await expect(page.locator("#instruction")).toHaveValue("계속 앞으로 걸어");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("one-line-per-death:save"),
    ),
  ).toBe(beforeLateResponse);
  report.push("Late deterministic response ignored after draft changes");
  await page.unroute("**/api/interpret");
  await page.locator("#instruction").focus();
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(page.locator(".shell")).toHaveClass(/keyboard-open/);
  await page.screenshot({
    path: "artifacts/mobile-keyboard-layout.png",
    fullPage: true,
  });
  const bounds = await page.evaluate(() => ({
    scene: document
      .querySelector(".scene-frame")!
      .getBoundingClientRect()
      .toJSON(),
    input: document
      .querySelector(".composer")!
      .getBoundingClientRect()
      .toJSON(),
    h: innerHeight,
  }));
  if (bounds.scene.bottom <= 0 || bounds.input.top < 0 || bounds.input.bottom > bounds.h)
    throw new Error(
      `Keyboard layout hides core controls ${JSON.stringify(bounds)}`,
    );
  report.push(
    "Compact 390x430 keyboard viewport keeps scene and input visible",
  );
  let tapCalls = 0;
  await page.route("**/api/interpret", route => { tapCalls += 1; return route.abort("failed"); });
  for (const composing of [false, true]) {
    await page.locator("#instruction").focus();
    await expect(page.locator(".shell")).toHaveClass(/keyboard-open/);
    if (composing) {
      await page.locator("#instruction").dispatchEvent("compositionstart", { data: "어" });
      await page.locator("#instruction").dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
    }
    const beforeTap = tapCalls;
    await page.getByRole("button", { name: "기억하고 출발" }).tap();
    await expect.poll(() => tapCalls).toBe(beforeTap + 1);
    await expect(page.locator(".error")).toBeVisible();
    await expect(page.locator("#instruction")).toHaveValue("계속 앞으로 걸어");
    await page.waitForTimeout(150);
    expect(tapCalls).toBe(beforeTap + 1);
    if (composing) await page.locator("#instruction").dispatchEvent("compositionend", { data: "어" });
  }
  await page.unroute("**/api/interpret");
  report.push("One touch submits once from compact keyboard layout, including composing Korean; failed request preserves draft");
  const launch = page.getByRole("button", { name: "기억하고 출발" });
  const beforeDismiss = await launch.evaluate((button) => button.getBoundingClientRect().top + window.scrollY);
  await page.locator("#instruction").blur();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".shell")).toHaveClass(/keyboard-open/);
  const afterDismiss = await launch.evaluate((button) => button.getBoundingClientRect().top + window.scrollY);
  expect(Math.abs(afterDismiss - beforeDismiss)).toBeLessThan(2);
  await expect(launch).toBeInViewport();
  // Force the iOS failure order: input blurs between press and release.
  let blurCalls = 0;
  await page.route("**/api/interpret", route => { blurCalls += 1; return route.abort("failed"); });
  await page.locator("#instruction").focus();
  const target = await launch.boundingBox();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
  await page.mouse.down();
  await page.locator("#instruction").blur();
  await page.mouse.up();
  await expect.poll(() => blurCalls).toBe(1);
  await expect(page.locator(".error")).toBeVisible();
  await expect(page.locator(".shell")).toHaveClass(/keyboard-open/);
  await page.unroute("**/api/interpret");
  await page.locator("#instruction").fill("");
  await page.locator("#instruction").blur();
  await expect(page.locator(".shell")).not.toHaveClass(/keyboard-open/);
  report.push("Keyboard dismissal preserves button position; blur between press/release submits once; clearing draft restores full layout");
  // Storage denial is injected as a browser capability failure, not an AI substitute.
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "소리 끄기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "자동 저장" })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("one-line-per-death:save")),
  ).toBe(before);
  report.push("Quota failure retains original saved data");
  const broken = await browser.newContext();
  const bp = await broken.newPage();
  await installChapterOneBrowserHarness(bp);
  await bp.addInitScript(() => {
    localStorage.setItem("one-line-per-death:save", "{broken");
  });
  await bp.goto(base);
  await expect(bp.getByRole("alert")).toContainText("저장된 기록을 읽을 수 없어요");
  expect(
    await bp.evaluate(() => localStorage.getItem("one-line-per-death:save")),
  ).toBe("{broken");
  report.push("Corrupt save preserved and recovery surfaced");
  console.log(JSON.stringify({ passed: true, report }, null, 2));
  await writeFile(
    `artifacts/${label}-browser-errors-report.json`,
    JSON.stringify(
      {
        base,
        checkedAt: new Date().toISOString(),
        passed: true,
        interpretationMode: "deterministic fixture; no provider calls",
        report,
        bounds,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/browser-errors-failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
