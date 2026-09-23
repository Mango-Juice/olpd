import { chromium, expect } from '@playwright/test';
import { newChapterRun, addInstruction, retry, startRun, step } from '../src/game/core';
import { makeSave, STORAGE_KEY } from '../src/game/storage';
import { FIXTURE_INSTRUCTIONS } from './browser-fixtures';
import type { RunState } from '../src/game/types';

let run: RunState = { ...newChapterRun(), layoutVersion: 2 };
for (const index of [0, 2, 3, 4]) {
  const note = FIXTURE_INSTRUCTIONS[index];
  run = addInstruction(run, note.text, note.interpretation);
  run = startRun(run.phase === 'dead' ? retry(run) : run);
  for (let n = 0; run.phase === 'running' && n < 30; n++) run = step(run);
}
expect(run.phase).toBe('cleared');
const pending: RunState = { ...run, phase: 'running', point: 1 };
const save = makeSave(pending, { writer: 'old-v2-tail', settings: { muted: true, reducedMotion: true } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, data }) => localStorage.setItem(key, data), { key: STORAGE_KEY, data: JSON.stringify(save) });
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: /모험 이어하기/ }).click();
  const chapter2 = page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) });
  await expect(chapter2.getByRole('button', { name: /들어가기/ })).toBeEnabled();
  const stored = await page.evaluate(() => new Promise<any>((resolve, reject) => {
    const opening = indexedDB.open('one-line-per-death:campaign');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction('campaign').objectStore('campaign').get('root');
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }));
  expect(stored.state.stages[0].completion.run.runId).toBe(pending.id);
  expect(stored.state.stages[0].bestScore).toBe(pending.deaths + pending.penaltyDeaths);
  expect(stored.activeRuns).toHaveLength(0);
  expect(stored).not.toHaveProperty('archives');
  expect(errors).toEqual([]);
  console.log('PASS existing v2 pending tail resumes directly to clear/map/unlocked chapter2; verified completion and best score retained; completed detail removed; 0 AI calls');
} finally { await browser.close(); }
