import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { STAGES } from '../src/campaign/catalog';

const directory = 'artifacts/quiet-scenes';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [];
const scenes: Record<string, unknown>[] = [];
let calls = 0;
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => { if (request.url().includes('/api/') && request.method() === 'POST') calls++; });
async function geometry() {
  return page.locator('.campaign-scene canvas').evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const parent = canvas.parentElement!;
    return { width: bounds.width, height: bounds.height, parentWidth: parent.clientWidth,
      parentScrollWidth: parent.scrollWidth, documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth };
  });
}
async function assertCompact() {
  const measured = await geometry();
  expect(measured.width).toBeLessThanOrEqual(measured.parentWidth + 1);
  expect(measured.parentScrollWidth).toBeLessThanOrEqual(measured.parentWidth + 1);
  expect(measured.documentWidth).toBeLessThanOrEqual(measured.viewportWidth + 1);
  expect(Math.abs(measured.width / measured.height - 960 / 500)).toBeLessThan(0.02);
  expect(await page.locator('.campaign-entity-facts, .campaign-entity-details, .campaign-pan-controls').count()).toBe(0);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  await expect(page.locator('.campaign-goal')).toBeVisible();
  return measured;
}
try {
  await page.goto('http://localhost:5173/?qa=1');
  for (const chapter of STAGES.slice(1)) {
    await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: chapter.title, exact: true }) })
      .getByRole('button', { name: /들어가기|이어 걷기/ }).click();
    const select = page.getByRole('combobox', { name: 'QA 스테이지 선택' });
    const values = await select.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    expect(values).toHaveLength(6);
    for (const value of values) {
      await select.selectOption(value);
      const measured = await assertCompact();
      await page.locator('.scene-frame.campaign-scene').screenshot({ path: `${directory}/${value}.png` });
      scenes.push({ id: value, ...measured });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await assertCompact();
    await page.screenshot({ path: `${directory}/mobile-${chapter.id}.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'QA 장 선택', exact: true }).click();
  }
  expect(scenes).toHaveLength(54);
  expect(errors).toEqual([]);
  expect(calls).toBe(0);
  await writeFile(`${directory}/report.json`, JSON.stringify({ scenes, errors, calls, scope: 'All 54 initial scene renders, fixed width and mobile overflow; not a blind difficulty playtest.' }, null, 2));
  console.log('PASS 54 fixed scenes + 9 mobile chapters; no inspector or horizontal overflow; 0 AI calls');
} finally { await browser.close(); }
