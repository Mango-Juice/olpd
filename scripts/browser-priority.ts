import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createFirstForkDeathSave } from "./browser-fixtures";
import { installLegacyBrowserHarness } from "./legacy-browser-harness";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "v2-local";
const liveAi = process.env.LIVE_AI?.toLowerCase() === "true";
await mkdir("artifacts", { recursive: true });
const originalSave = createFirstForkDeathSave("browser-priority");
const fixture = JSON.stringify(originalSave);
const original = originalSave.state;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await installLegacyBrowserHarness(page);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const saved = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("one-line-per-death:save")!).state,
  );
const install = async () => {
  await page.goto(base);
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    fixture,
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await page.locator(".notebook-summary").click();
};
try {
  await install();
  await expect(page.locator(".line-number, .latest-memory")).toHaveCount(0);
  await expect(page.locator(".memory-priority")).toContainText("위쪽 메모부터");
  await expect(page.locator(".priority-controls")).toHaveCount(0);
  const rightEdges = await page
    .locator(".memory-menu-toggle")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().right),
    );
  expect(Math.max(...rightEdges) - Math.min(...rightEdges)).toBeLessThan(1);
  await page
    .getByRole("button", { name: "앞으로 전진해 메모 관리", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("button", {
        name: "앞으로 전진해 우선순위 높이기",
        exact: true,
      })
      .click();
  }
  await expect(page.locator(".instruction").first()).toContainText(
    "앞으로 전진해",
  );
  const reordered = await saved();
  expect(reordered.instructions.at(-1).id).toBe(original.instructions[0].id);
  expect(reordered.deaths).toBe(original.deaths);
  expect(reordered.penaltyDeaths).toBe(original.penaltyDeaths);
  expect(reordered.erasers).toBe(original.erasers);
  expect(reordered.canWrite).toBe(original.canWrite);
  expect(reordered.events).toEqual(original.events);
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await page.locator(".notebook-summary").click();
  expect((await saved()).instructions).toEqual(reordered.instructions);
  await page.screenshot({
    path: `artifacts/${label}-priority-mobile.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "한 줄 더 쓰지 않고 다시 출발" })
    .click();
  await expect(page.locator(".priority-controls")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "한 줄 더 쓰지 않고 다시 출발" }),
  ).toBeVisible({ timeout: 20000 });
  const result = await saved();
  expect(result.lastEvent.observation).toBe("pit");
  expect(result.lastEvent.action).toBe("advance");
  expect(result.lastEvent.instructionId).toBe(original.instructions[0].id);

  await install();
  if (!liveAi) {
    await page.route("**/api/interpret", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          action: "advance",
          appliesTo: ["pit", "bridge", "pitCeilingPath"],
          uncertainty: 0.05,
          model: "browser-fixture",
          rulesVersion: "1",
        }),
      });
    });
  }
  const before = await page.evaluate(() =>
    localStorage.getItem("one-line-per-death:save"),
  );
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/interpret"),
  );
  await page.locator("#instruction").fill("구덩이가 있으면 전진해");
  await page.locator("#instruction").press("Enter");
  const aiResponse = await response;
  expect(aiResponse.status()).toBe(200);
  const interpretation = await aiResponse.json();
  await expect(page.locator(".error")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".error")).toContainText("구덩이가 있으면 뛰어");
  await expect(page.locator("#instruction")).toHaveValue(
    "구덩이가 있으면 전진해",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("one-line-per-death:save")),
  ).toBe(before);
  expect((await saved()).canWrite).toBe(true);
  await page.screenshot({
    path: `artifacts/${label}-priority-conflict.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const report = {
    base,
    interpretationMode: liveAi ? "live-jev" : "fixture",
    passed: true,
    checks: [
      "no input numbering",
      "delete and menu buttons stay aligned; arrows open on demand",
      "arrow order persists after reload",
      "free reordering preserves writing chance and events",
      "manual priority changes actual pit action",
      "priority locked during animation",
      `${liveAi ? "live Jev" : "fixture API"} interpretation conflict rejected before save`,
      "conflict preserves draft and writing chance",
    ],
    interpretation,
    errors,
  };
  await writeFile(
    `artifacts/${label}-priority-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
