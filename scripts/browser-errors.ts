import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const report: string[] = [];
try {
  await page.goto(base);
  await page.getByRole("button", { name: "첫 번째 한 줄 남기기" }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem("one-line-per-death:save"),
  );
  await page.route("**/api/interpret", (route) => route.abort("failed"));
  await page.locator("#instruction").fill("앞으로 전진해");
  await page
    .locator("#instruction")
    .dispatchEvent("keydown", {
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
    const response = await route.fetch();
    await barrier;
    await route.fulfill({ response }).catch(() => {});
  });
  await page
    .getByRole("button", { name: /뜻을 확인해 볼까|기억하고 출발/ })
    .click();
  await received;
  await page.locator("#instruction").fill("계속 앞으로 걸어");
  resolve();
  await page.waitForTimeout(1000);
  await expect(
    page.getByRole("button", { name: "기억하고 출발" }),
  ).not.toBeVisible();
  await expect(page.locator("#instruction")).toHaveValue("계속 앞으로 걸어");
  report.push("Late actual Jev response ignored after draft changes");
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
  if (bounds.scene.top < 0 || bounds.input.bottom > bounds.h)
    throw new Error(
      `Keyboard layout hides core controls ${JSON.stringify(bounds)}`,
    );
  report.push(
    "Compact 390x430 keyboard viewport keeps scene and input visible",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#instruction").blur();
  // Storage denial is injected as a browser capability failure, not an AI substitute.
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "소리 끄기" }).click();
  await expect(page.getByRole("alert")).toContainText("자동 저장");
  expect(
    await page.evaluate(() => localStorage.getItem("one-line-per-death:save")),
  ).toBe(before);
  report.push("Quota failure retains original saved data");
  const broken = await browser.newContext();
  const bp = await broken.newPage();
  await bp.goto(base);
  await bp.evaluate(() =>
    localStorage.setItem("one-line-per-death:save", "{broken"),
  );
  await bp.reload();
  await expect(bp.getByRole("alert")).toContainText("원본은 그대로");
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
