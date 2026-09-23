import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveStage } from '../src/campaign/registry';
import { stageDynamics } from '../src/campaign/level';
import { acknowledgePresentation, advanceStage, abandonStage, createCampaignRun, departStage, retryStage, writeStageProgram, type StageRun } from '../src/campaign/run';
import { QUIET_EARLY_INTENT_CASES, quietEarlyProgram } from '../src/campaign/quiet/early';
import type { InstructionProgram } from '../src/campaign/types';

// UI contract checks use explicit interpreter fixtures, never a claim of live model accuracy.
const base = process.env.APP_URL ?? 'http://localhost:5173';
const key = 'one-line-per-death:qa:shared-v1';
const out = 'artifacts/shared-campaign';
await mkdir(out, { recursive: true });
const stage = resolveStage(2)!;
function browserState(page: Page): Promise<StageRun> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!)['2'].run.run, key);
}
async function install(page: Page, run: StageRun) {
  await page.goto(`${base}/?qa=1`);
  await page.evaluate(({ key, run }) => localStorage.setItem(key, JSON.stringify({ 2: { label: '2장 · 비에 잠긴 회랑', run: { kind: 'world', run } } })), { key, run });
  await page.reload();
  await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) }).getByRole('button', { name: /들어가기|이어 걷기/ }).click();
  await expect(page.locator('.game-panel')).toBeVisible();
}
function terminal(input: StageRun): StageRun {
  let run = input;
  for (let i = 0; i < 100 && ['running', 'waiting'].includes(run.phase); i++) run = advanceStage(acknowledgePresentation(run), stageDynamics(stage));
  return acknowledgePresentation(run);
}
function deletionFixture(): StageRun {
  let run = createCampaignRun('shared-notebook-browser-fixture', stage);
  for (let i = 0; i < 4; i++) {
    const note: InstructionProgram = { version: 2, id: `note-${i}`, text: `지난 길의 기억 ${i + 1}`, model: 'browser-fixture', scope: { region: `unseen-room-${i}` }, guard: false,
      body: { kind: 'action', actor: 'hero', verb: 'move', target: '02-v2-1-exit' } };
    run = writeStageProgram(run, note);
    if (run.phase === 'failed') run = acknowledgePresentation(retryStage(run));
    run = terminal(departStage(run));
    if (run.phase === 'blocked') run = acknowledgePresentation(abandonStage(run));
    expect(run.phase).toBe('failed');
  }
  return run;
}
const browser = await chromium.launch();
const errors: string[] = [];
let fixtureCalls = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/qa/campaign-interpret', async (route) => {
    fixtureCalls++;
    const request = route.request().postDataJSON();
    const entry = QUIET_EARLY_INTENT_CASES.find((item) => item.segmentId === request.world.segmentId)!;
    const program = { ...quietEarlyProgram(entry), id: `browser-note-${fixtureCalls}`, text: request.text };
    await route.fulfill({ json: { program } });
  });
  await install(page, createCampaignRun('shared-flow-browser-fixture', stage));
  await page.getByLabel('한 장면씩 보기').check();
  await page.locator('#campaign-instruction').fill('상자를 옆으로 밀고 출구로 걸어 줘');
  await page.locator('#campaign-instruction').press('Enter');
  await expect.poll(async () => (await browserState(page)).notebook.instructions.length).toBe(1);
  await expect(page.getByRole('button', { name: '다음 장면 →', exact: true })).toBeVisible({ timeout: 12000 });
  const pausedBoundary = await browserState(page);
  await page.waitForTimeout(900);
  expect((await browserState(page)).revision).toBe(pausedBoundary.revision);
  await page.screenshot({ path: `${out}/chapter-2-step.png`, fullPage: true });
  await page.getByLabel('한 장면씩 보기').uncheck();
  await expect.poll(async () => (await browserState(page)).world.segmentId, { timeout: 18000 }).toBe('02-v2-2');
  await expect.poll(async () => {
    const run = await browserState(page); return !run.presentation && ['blocked', 'failed'].includes(run.phase);
  }, { timeout: 18000 }).toBe(true);
  if ((await browserState(page)).phase === 'blocked') await page.getByRole('button', { name: '포기하고 부활하기 · +1데스', exact: true }).click();
  await expect(page.locator('#campaign-instruction')).toBeVisible({ timeout: 12000 });
  expect((await browserState(page)).notebook.instructions).toHaveLength(1);
  await page.locator('#campaign-instruction').fill('상자를 창문 아래로 밀고 창문으로 올라가 줘');
  await page.locator('#campaign-instruction').press('Enter');
  await expect.poll(async () => (await browserState(page)).notebook.instructions.length).toBe(2);
  const restarted = await browserState(page);
  expect(restarted.world.segmentId).toBe('02-v2-1');
  expect(restarted.presentation?.outcome).toBe('revive');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  const revision = (await browserState(page)).revision;
  await page.waitForTimeout(1200);
  expect((await browserState(page)).revision).toBe(revision);
  await page.reload();
  await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) }).getByRole('button', { name: /들어가기|이어 걷기/ }).click();
  expect((await browserState(page)).notebook.instructions).toHaveLength(2);
  await page.getByRole('button', { name: '지난 모험 기록', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('새로 남긴 말');
  await expect(page.getByRole('dialog')).toContainText('메모를 챙겨');
  await page.getByRole('button', { name: /장면 다시 보기/ }).first().click();
  await expect(page.locator('.chronicle-replay canvas')).toBeVisible();
  await page.screenshot({ path: `${out}/chapter-2-history.png`, fullPage: true });

  const notebook = await context.newPage();
  notebook.on('pageerror', (error) => errors.push(error.message));
  await install(notebook, deletionFixture());
  await expect(notebook.locator('.instruction')).toHaveCount(4);
  const before = await browserState(notebook);
  await notebook.getByRole('button', { name: '지난 길의 기억 3 메모 관리', exact: true }).click();
  await notebook.getByRole('button', { name: '지난 길의 기억 3 우선순위 높이기' }).click();
  await expect.poll(async () => (await browserState(notebook)).notebook.instructions.at(-1)?.id).toBe('note-2');
  expect((await browserState(notebook)).notebook.deaths).toBe(before.notebook.deaths);
  for (let i = 0; i < 3; i++) {
    await notebook.locator('.erase-button').last().click();
    await expect(notebook.getByRole('dialog')).toContainText(i < 2 ? '지우개 1개' : '3데스');
    await notebook.getByRole('button', { name: '비용을 사용하고 삭제', exact: true }).click();
    await expect(notebook.getByRole('dialog')).not.toBeVisible();
    const state = await browserState(notebook);
    expect(state.notebook.erasers).toBe(Math.max(0, 1 - i));
    expect(state.notebook.penaltyDeaths).toBe(i === 2 ? 3 : 0);
    expect(state.notebook.canWrite).toBe(before.notebook.canWrite);
  }
  await notebook.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => notebook.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await notebook.screenshot({ path: `${out}/chapter-2-mobile.png`, fullPage: true });
  await notebook.getByRole('combobox', { name: 'QA 스테이지 선택' }).selectOption('02-v2-3');
  await notebook.reload();
  await notebook.locator('.roadmap-stop').filter({ has: notebook.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) }).getByRole('button', { name: /들어가기|이어 걷기/ }).click();
  await expect(notebook.getByRole('combobox', { name: 'QA 스테이지 선택' })).toHaveValue('02-v2-3');
  expect((await browserState(notebook)).checkpoint.segmentId).toBe('02-v2-3');
  expect(errors).toEqual([]);
  expect(fixtureCalls).toBe(2);
  await writeFile(`${out}/report.json`, JSON.stringify({ passed: true, provider: 'explicit browser fixtures, no paid calls', fixtureCalls, errors,
    checks: ['Enter direct execution', 'playback completion gating', 'step mode', 'pause', 'memo accumulation', 'entrance revival', 'reload', 'animated chronicle', 'priority', '2 erasers then +3 death', 'mobile overflow', 'QA scene checkpoint reload'] }, null, 2));
  console.log('PASS shared campaign UI contract; 2 interpreter fixtures; 0 paid calls');
} finally { await browser.close(); }
