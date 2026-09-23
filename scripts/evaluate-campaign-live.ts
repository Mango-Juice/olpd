/** Explicitly bounded live check; samples are authored intents, not a blind playtest. */
import { mkdir, writeFile } from 'node:fs/promises';
import { interpretCampaignWithDeepSeek, DEEPSEEK_CAMPAIGN_PROMPT_VERSION } from '../server/campaign-deepseek';
import { campaignContext } from '../server/campaign-service';
import { resolveStage } from '../src/campaign/registry';
import { createCampaignRun } from '../src/campaign/run';
import { runSceneProgram } from './lib/run-campaign-probe';
import { SPATIAL_INTENT_CASES } from '../tests/fixtures/spatial-intents';
process.env.AI_STRUCTURED_LOGS = 'false';
const selected = process.argv.find((arg) => arg.startsWith('--ids='))?.slice(6).split(',');
const all = process.argv.includes('--all');
if (!all && !selected?.length) throw new Error('Select --ids=02-v2-1,... or --all (maximum 54 calls, no retries)');
const cases = SPATIAL_INTENT_CASES.filter((row) => all || selected?.includes(row.segmentId));
if (cases.length > 54 || !cases.length) throw new Error('Invalid probe selection');
const override = process.argv.find((arg) => arg.startsWith('--text='))?.slice(7);
if (override && cases.length !== 1) throw new Error('Text override needs one scene');
const directory = `artifacts/campaign-live/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
let cursor = 0;
async function worker() {
  while (cursor < cases.length) {
    const entry = cases[cursor++];
    const stage = resolveStage(entry.stageId)!;
    const scene = stage.segments.find((item) => item.id === entry.segmentId)!;
    const text = override ?? entry.text;
    const traces: unknown[] = [];
    const started = performance.now();
    let record: Record<string, unknown>;
    try {
      const initial = createCampaignRun(`probe-${scene.id}`, { ...stage, segments: [scene] });
      const canonical = campaignContext({ text, world: initial.world, stageId: stage.id, runId: initial.id, revision: initial.revision, attempt: initial.world.attempt });
      const { program } = await interpretCampaignWithDeepSeek(text, canonical.world, { trace: (event) => traces.push(event) });
      const { run, steps } = runSceneProgram(stage, scene, program);
      record = { id: scene.id, text, pass: run.clearedSegments.includes(scene.id), phase: run.phase, reason: run.statusReason, steps, program,
        events: run.events.filter((event) => event.segmentId === scene.id).map(({ reason, outcome }) => ({ reason, outcome })) };
    } catch (error) { record = { id: scene.id, text, pass: false, error: error instanceof Error ? error.message : String(error) }; }
    record.latencyMs = Math.round(performance.now() - started);
    results.push({ ...record, traces });
    console.log(JSON.stringify({ ...record, events: undefined, program: undefined }));
    await writeFile(`${directory}/${entry.segmentId}.json`, JSON.stringify({ ...record, traces }, null, 2));
  }
}
await Promise.all([worker(), worker(), worker()]);
results.sort((a, b) => String(a.id).localeCompare(String(b.id)));
await writeFile(`${directory}/report.json`, JSON.stringify({ promptVersion: DEEPSEEK_CAMPAIGN_PROMPT_VERSION, scope: 'Authored Korean intent -> actual provider -> actual stage runtime; not blind difficulty validation', results }, null, 2));
console.log(JSON.stringify({ passed: results.filter((row) => row.pass).length, calls: results.length, directory }));
if (results.some((row) => !row.pass)) process.exitCode = 1;
