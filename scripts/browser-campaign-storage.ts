import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.APP_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript({ content: 'globalThis.__name = (fn) => fn;' });
const page = await context.newPage();
try {
  await page.goto(base + '/favicon.svg');
  const evidence = await page.evaluate(async () => {
    const load = (path: string): Promise<Record<string, any>> => import(/* @vite-ignore */ path);
    const [repositoryModule, authorityModule, core, content, storage] = await Promise.all([
      load('/src/campaign/repository.ts'), load('/src/campaign/authority.ts'),
      load('/src/game/core.ts'), load('/src/game/chapter-layout.ts'), load('/src/game/storage.ts'),
    ]);
    const { CampaignRepository, CAMPAIGN_DATABASE } = repositoryModule;
    const { makeSave, STORAGE_KEY } = storage;
    const current = makeSave({ ...core.newRun(false), id: 'browser-active' }, { writer: 'old-tab', savedAt: 30 });
    const room = content.LEGACY_ROOMS.length - 1;
    const completed = makeSave({ ...core.newRun(false), id: 'browser-old-clear', phase: 'cleared', room, point: content.LEGACY_ROOMS[room].points.length, deaths: 4 }, { writer: 'old-tab', savedAt: 20 });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    const sourceBefore = localStorage.getItem(STORAGE_KEY);
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('one-line-per-death:chronicles', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('stages', { keyPath: 'id' });
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const tx = db.transaction('stages', 'readwrite');
        tx.objectStore('stages').put({ id: completed.state.id, stageId: 'memory-dungeon', title: '이전 모험', completedAt: completed.savedAt, save: completed });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    let failSerialization = false;
    const original = authorityModule.campaignAuthority(() => null);
    const authority = { ...original, serialize(run: any) {
      const serialized = original.serialize(run);
      return failSerialization ? { ...serialized, __uncloneable: () => undefined } : serialized;
    } };
    const repository = new CampaignRepository(authority, { migrateLegacyRun: (save: any) => ({ kind: 'legacy', save }) });
    const migrated = await repository.loadOrCreate('browser-a');
    if (!migrated.ok) throw Error('Migration failed: ' + migrated.error.code);
    if (migrated.value.state.stages[0].bestScore !== 4 || migrated.value.activeRuns.length !== 1 || 'archives' in migrated.value) throw Error('Migration did not preserve summary/current run');
    const stamp = { writer: migrated.value.state.writer, revision: migrated.value.state.revision };
    failSerialization = true;
    const aborted = await repository.saveActiveRun({ kind: 'legacy', save: current }, { writer: 'browser-a', expected: stamp });
    failSerialization = false;
    if (aborted.ok || aborted.error.code !== 'write') throw Error('Expected real IDB clone failure');
    const afterAbort = await repository.load();
    if (!afterAbort.ok || afterAbort.value.state.revision !== stamp.revision) throw Error('Aborted transaction changed state');
    let next = await repository.saveActiveRun({ kind: 'legacy', save: current }, { writer: 'browser-b', expected: stamp });
    if (!next.ok) throw Error('Active save failed');
    const stale = await repository.saveActiveRun({ kind: 'legacy', save: current }, { writer: 'browser-c', expected: stamp });
    if (stale.ok || stale.error.code !== 'conflict') throw Error('Stale write accepted');
    const readRoot = () => new Promise<any>((resolve, reject) => {
      const opening = indexedDB.open(CAMPAIGN_DATABASE);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const q = db.transaction('campaign').objectStore('campaign').get('root');
        q.onsuccess = () => { resolve(q.result); db.close(); };
        q.onerror = () => { reject(q.error); db.close(); };
      };
    });
    const sizes: number[] = [];
    for (let i = 0; i < 30; i++) {
      const fresh = { ...core.newChapterRun(), id: 'replay-' + String(i).padStart(3, '0') };
      const active = { kind: 'legacy', save: makeSave(fresh, { writer: 'browser-b' }) };
      next = await repository.saveActiveRun(active, { writer: 'browser-b', expected: next.value.state });
      if (!next.ok) throw Error('Replay entry failed');
      const clear = { kind: 'legacy', save: makeSave({ ...fresh, phase: 'cleared', room: 5, point: 1, canWrite: false, deaths: 2 + i }, { writer: 'browser-b' }) };
      next = await repository.completeActiveRun(clear, { writer: 'browser-b', expected: next.value.state, completedAt: 100 + i });
      if (!next.ok) throw Error('Replay completion failed: ' + next.error.message);
      const root = await readRoot();
      if (root.version !== 5 || 'archives' in root || root.activeRuns.length || root.recoveries.some((x: any) => x.kind === 'archive')) throw Error('Completed payload retained');
      sizes.push(JSON.stringify(root).length);
    }
    const oldArchiveCount = await new Promise<number>((resolve, reject) => {
      const opening = indexedDB.open('one-line-per-death:chronicles', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('stages', { keyPath: 'id' });
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const q = db.transaction('stages').objectStore('stages').count();
        q.onsuccess = () => { resolve(q.result); db.close(); };
        q.onerror = () => { reject(q.error); db.close(); };
      };
    });
    return {
      abortCode: aborted.error.code, conflictCode: stale.error.code,
      bestScore: next.value.state.stages[0].bestScore,
      latestRunId: next.value.state.stages[0].completion.run.runId,
      chapter2Status: next.value.state.stages[1].status,
      oldArchiveCleared: oldArchiveCount === 0,
      activeSourcePreserved: localStorage.getItem(STORAGE_KEY) === sourceBefore,
      completedRuns: sizes.length, firstSize: sizes[0], finalSize: sizes.at(-1), maxSize: Math.max(...sizes),
    };
  });
  expect(evidence.abortCode).toBe('write');
  expect(evidence.conflictCode).toBe('conflict');
  expect(evidence.bestScore).toBe(2);
  expect(evidence.latestRunId).toBe('replay-029');
  expect(evidence.chapter2Status).toBe('unlocked');
  expect(evidence.oldArchiveCleared).toBe(true);
  expect(evidence.activeSourcePreserved).toBe(true);
  expect(evidence.maxSize - evidence.firstSize).toBeLessThan(64);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/browser-compact-storage.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, evidence }, null, 2));
} finally { await browser.close(); }
