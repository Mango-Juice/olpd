import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createCampaignRun, type StageRun } from '../src/campaign/run';
import { resolveStage } from '../src/campaign/registry';

const base = process.env.APP_URL ?? 'http://localhost:5173';
const key = 'one-line-per-death:qa:spatial-v1';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let calls = 0;
  await page.route('**/api/qa/campaign-interpret', async route => {
    calls++;
    await route.fulfill({ json: { program: {
      version: 2, id: 'push-only', text: '상자가 보이면 밀어', model: 'browser-fixture',
      scope: { stageId: 2 }, guard: false,
      condition: { kind: 'visible', entity: '02-v2-1-box' },
      body: { kind: 'action', actor: 'hero', verb: 'push', target: '02-v2-1-box' },
    } } });
  });
  await page.goto(`${base}/?qa=1`);
  const run = createCampaignRun('stagnation-browser', resolveStage(2)!);
  await page.evaluate(({ key, run }) => localStorage.setItem(key, JSON.stringify({
    2: { label: '2장', run: { kind: 'world', run } },
  })), { key, run });
  await page.reload();
  await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) })
    .getByRole('button', { name: /들어가기|이어 걷기/ }).click();
  await page.locator('#campaign-instruction').fill('상자가 보이면 밀어');
  await page.locator('#campaign-instruction').press('Enter');
  const state = (): Promise<StageRun> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!)['2'].run.run, key);
  await expect.poll(async () => (await state()).phase, { timeout: 30000 }).toBe('failed');
  await expect(page.locator('#campaign-instruction')).toBeVisible({ timeout: 10000 });
  const failed = await state();
  expect(failed.notebook.deaths).toBe(1);
  expect(failed.notebook.instructions).toHaveLength(1);
  expect(failed.statusReason).toContain('같은 자리');
  expect(calls).toBe(1);
  await expect(page.getByText(failed.statusReason!, { exact: false }).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect((await state()).notebook.deaths).toBe(1);
  await mkdir('artifacts/stagnation', { recursive: true });
  await page.screenshot({ path: 'artifacts/stagnation/death-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  console.log('PASS: 2-1 push-only stops with one death, readable reason, preserved notebook and available input; 1 fixture, 0 paid calls');
} finally { await browser.close(); }
