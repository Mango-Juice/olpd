import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { STAGES } from "../src/campaign/catalog";
const directory = "artifacts/all-stages-browser";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
const visited: string[] = [];
let calls = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (request.url().includes("/api/") && request.method() === "POST") calls++; });
try {
  await page.goto("http://localhost:5173/?qa=1");
  for (const chapter of STAGES.slice(1)) {
    await page.locator(".qa-grid section").filter({ has: page.getByRole("heading", { name: chapter.title, exact: true }) }).getByRole("button", { name: "바로 입장", exact: true }).click();
    await expect(page.locator(".layout > .notebook.paper")).toBeVisible();
    const select = page.getByRole("combobox", { name: "QA 스테이지 선택" });
    const values = await select.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    expect(values).toHaveLength(chapter.segments);
    for (const [index, value] of values.entries()) {
      await select.selectOption(value);
      await expect(page.locator(".play-stage-progress-heading")).toContainText(`${chapter.id}-${index + 1} / ${chapter.segments}개`);
      await expect(page.locator(".campaign-goal")).toBeVisible();
      expect(await page.locator("vite-error-overlay").count()).toBe(0);
      visited.push(`${chapter.id}-${index + 1}`);
      if (index === 0 || index === values.length - 1) await page.screenshot({ path: `${directory}/chapter-${chapter.id}-${index + 1}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "QA 장 선택", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".qa-grid section").filter({ has: page.getByRole("heading", { name: STAGES[1].title, exact: true }) }).getByRole("button", { name: "이어 하기", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
  expect(errors).toEqual([]);
  expect(calls).toBe(0);
  await writeFile(`${directory}/report.json`, JSON.stringify({ visited, errors, liveAiCalls: calls, scope: "rendering and QA navigation; physics and AI interpretation checked separately" }, null, 2));
  console.log(`PASS ${visited.length} campaign scenes; mobile width; no runtime errors or AI calls`);
} finally { await browser.close(); }
