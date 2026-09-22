import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { STAGES } from "../src/campaign/catalog";
const directory = "artifacts/map-readability";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors: string[] = [];
let calls = 0;
const scenes: unknown[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (request.url().includes("/api/") && request.method() === "POST") calls++; });
try {
  await page.goto("http://localhost:5173/?qa=1");
  for (const chapter of STAGES.slice(1)) {
    await page.locator(".roadmap-stop").filter({ has: page.getByRole("heading", { name: chapter.title, exact: true }) }).getByRole("button", { name: /들어가기|이어 걷기/ }).click();
    const select = page.getByRole("combobox", { name: "QA 스테이지 선택" });
    const values = await select.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    for (const [index, value] of values.entries()) {
      await select.selectOption(value);
      const viewport = page.locator(".campaign-map-viewport");
      await expect(viewport).toBeVisible();
      await expect(page.locator(".campaign-map-heading")).toContainText(`스테이지 ${index + 1}`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await viewport.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight }));
      expect(geometry.height).toBeGreaterThan(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const picker = page.locator(".campaign-object-picker").first();
      const objects = picker.getByRole("button");
      if (await objects.count()) {
        const last = objects.last();
        const name = await last.innerText();
        await last.click();
        await expect(page.locator(".campaign-scene-observation h2")).toHaveText(name);
      }
      await viewport.evaluate((element) => { element.scrollLeft = 0; });
      await viewport.screenshot({ path: `${directory}/${value}-left.png` });
      if (geometry.scrollWidth > geometry.width + 1) {
        if (geometry.scrollWidth > geometry.width * 2) {
          await viewport.evaluate((element) => { element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2; });
          await viewport.screenshot({ path: `${directory}/${value}-middle.png` });
        }
        await viewport.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        await viewport.screenshot({ path: `${directory}/${value}-right.png` });
      }
      scenes.push({ id: value, ...geometry });
    }
    await page.getByRole("button", { name: "QA 장 선택", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".roadmap-stop").filter({ has: page.getByRole("heading", { name: STAGES[8].title, exact: true }) }).getByRole("button", { name: /들어가기|이어 걷기/ }).click();
  await expect(page.locator(".campaign-map-viewport")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "용사 위치", exact: true }).click();
  await page.locator("figure.campaign-scene").screenshot({ path: `${directory}/mobile.png` });
  expect(errors).toEqual([]);
  expect(calls).toBe(0);
  await writeFile(`${directory}/report.json`, JSON.stringify({ scenes, errors, calls }, null, 2));
  console.log(`PASS ${scenes.length} scenes; object selection, scrolling and mobile layout; zero AI calls`);
} finally { await browser.close(); }
