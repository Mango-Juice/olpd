import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCampaignState } from '../src/campaign/progress';
import { createStageRun } from '../src/campaign/run';
import { RAIN_STAGE } from '../tests/fixtures/campaign-worlds/rain';
const state = createCampaignState('historical-browser');
state.stages[0] = { stageId: 1, status: 'completed', activeRun: null, completion: { run: { stageId: 1, runId: 'old-one' }, completedAt: 1234, source: 'legacy' } };
const oldRun = createStageRun('old-two', RAIN_STAGE.segments[0].enter(null));
const payload = { kind: 'world', run: oldRun };
state.stages[1] = { stageId: 2, status: 'unlocked', activeRun: { stageId: 2, runId: oldRun.id }, completion: null };
const document = { state, activeRuns: [{ reference: state.stages[1].activeRun, payload }], archives: [] };
const browser = await chromium.launch();
const page = await browser.newPage();
let calls = 0;
page.on('request', (request) => { if (request.url().includes('/api/') && request.method() === 'POST') calls++; });
try {
  await page.goto('http://localhost:5173/favicon.svg');
  await page.evaluate(async (record) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('one-line-per-death:campaign', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('campaign');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('campaign', 'readwrite');
      tx.objectStore('campaign').put(record, 'root');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, document);
  await page.goto('http://localhost:5173/');
  await expect(page.getByText('개편 전 모험 기록을 따로 보관했어요.', { exact: true })).toBeVisible();
  await expect(page.locator('.roadmap-stop.is-locked')).toHaveCount(8);
  await page.locator('.roadmap-bookmark button').click();
  await expect(page.locator('.play-stage-progress-heading')).toContainText('2-1');
  await page.reload();
  await expect(page.locator('.roadmap-bookmark button')).toContainText('이야기 이어가기');
  await page.locator('.roadmap-bookmark button').click();
  await expect(page.locator('.play-stage-progress-heading')).toContainText('2-1');
  const root = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('one-line-per-death:campaign', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const record = await new Promise<any>((resolve, reject) => { const request = db.transaction('campaign').objectStore('campaign').get('root'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return record;
  });
  expect(root.version).toBe(2);
  expect(root.recoveries[0].payload).toEqual(payload);
  expect(root.activeRuns[0].payload.run.contentRevision).toBe('quiet-v1');
  expect(root.activeRuns[0].payload.run.world.segmentId).toBe('02-v2-1');
  expect(root.state.stages[0].completion.completedAt).toBe(1234);
  expect(calls).toBe(0);
  await mkdir('artifacts/quiet-recovery', { recursive: true });
  await writeFile('artifacts/quiet-recovery/report.json', JSON.stringify({ passed: true, checks: ['actual IndexedDB migration', 'exact old payload retained', 'old completion preserved', 'new quiet run persisted and resumed'], aiCalls: calls }, null, 2));
  console.log('PASS real IndexedDB old-run preservation, unlocks, new run and reload; 0 AI calls');
} finally { await browser.close(); }
