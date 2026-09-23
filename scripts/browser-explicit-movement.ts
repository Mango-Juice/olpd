import { chromium, expect } from '@playwright/test';
import { newRun } from '../src/game/core';
import { makeSave } from '../src/game/storage';
import { installLegacyBrowserHarness } from './legacy-browser-harness';

const browser = await chromium.launch();
let apiCalls = 0;
try {
  for (const chapter of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) apiCalls++; });
    const key = chapter === 1 ? 'one-line-per-death:save' : 'one-line-per-death:qa:spatial-v1';
    if (chapter === 1) {
      await installLegacyBrowserHarness(page);
      const raw = JSON.stringify(makeSave(newRun(false), { writer: 'explicit-walking-browser', savedAt: Date.now() }));
      await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key, raw });
    }
    const enter = async () => {
      if (chapter === 1) await page.getByRole('button', { name: '모험 이어하기' }).click();
      else await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) })
        .getByRole('button', { name: /들어가기|이어 걷기/ }).click();
    };
    const read = () => page.evaluate(({ key, chapter }) => {
      const data = JSON.parse(localStorage.getItem(key)!);
      const state = chapter === 1 ? data.state : data['2'].run.run;
      return { phase: state.phase, position: chapter === 1 ? [state.room, state.point] : state.world.actors.hero.location,
        deaths: chapter === 1 ? state.deaths : state.notebook.deaths, events: state.events.length, revision: state.revision };
    }, { key, chapter });
    try {
      await page.goto(`http://localhost:5173/${chapter === 2 ? '?qa=1' : ''}`);
      await enter();
      const initial = await read();
      await page.getByRole('button', { name: '모험 출발' }).click();
      await expect.poll(async () => (await read()).phase).toBe('blocked');
      await expect(page.getByRole('button', { name: '부활하고 · +1데스', exact: true })).toBeVisible({ timeout: 1800 });
      const stopped = await read();
      expect(stopped.position).toEqual(initial.position);
      expect(stopped.deaths).toBe(0);
      await page.waitForTimeout(1000);
      expect(await read()).toEqual(stopped);
      await page.reload(); await enter();
      expect((await read()).phase).toBe('blocked');
      expect((await read()).position).toEqual(initial.position);
      expect((await read()).deaths).toBe(0);
      expect(errors).toEqual([]);
    } catch (error) {
      console.error({ chapter, state: await read(), page: await page.locator('body').innerText(), errors });
      throw error;
    } finally { await context.close(); }
  }
  expect(apiCalls).toBe(0);
  console.log('PASS Chapters 1/2: no memo means immediate stationary stop, no deaths, stable reload, 0 AI calls');
} finally { await browser.close(); }
