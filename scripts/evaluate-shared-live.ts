/** Four paid calls maximum, no retries. A provider smoke check, not a difficulty test. */
import { mkdir, writeFile } from 'node:fs/promises';
import { interpretWithJev } from '../server/jev';
import { interpretCampaignWithDeepSeek, DEEPSEEK_CAMPAIGN_PROMPT_VERSION } from '../server/campaign-deepseek';
import { campaignContext } from '../server/campaign-service';
import { resolveStage } from '../src/campaign/registry';
import { stageDynamics } from '../src/campaign/level';
import { acknowledgePresentation, advanceStage, createCampaignRun, departStage, writeStageProgram } from '../src/campaign/run';
import { resolveProgramBindings } from '../src/campaign/bindings';
import { QUIET_EARLY_INTENT_CASES } from '../src/campaign/quiet/early';
import { QUIET_MIDDLE_INTENT_CASES } from '../tests/fixtures/quiet-middle-intents';
import type { StageId } from '../src/campaign/types';
process.env.AI_STRUCTURED_LOGS = 'false';
const directory = `artifacts/shared-live/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const started = performance.now();
if (!only || only === "jev") try {
  const response = await interpretWithJev('구덩이가 있으면 뛰어');
  results.push({ provider: 'jev', pass: response.interpretation.action === 'jump' && response.interpretation.appliesTo.includes('pit'), interpretation: response, latencyMs: Math.round(performance.now() - started) });
} catch (error) { results.push({ provider: 'jev', pass: false, error: error instanceof Error ? error.message : String(error) }); }
const cases = [
  { stageId: 2 as StageId, segmentId: '02-v2-1', text: '상자가 보일 때마다 옆으로 밀어 줘', portable: true },
  { ...QUIET_EARLY_INTENT_CASES.find((item) => item.segmentId === '03-v2-1')!, portable: false },
  { ...QUIET_MIDDLE_INTENT_CASES.find((item) => item.segmentId === '07-v2-3')!, portable: false },
];
for (const entry of cases.filter((item) => !only || item.segmentId === only)) {
  const stage = resolveStage(entry.stageId)!;
  const scene = stage.segments.find((item) => item.id === entry.segmentId)!;
  const traces: unknown[] = [];
  const started = performance.now();
  try {
    const run = createCampaignRun(`shared-live-${entry.segmentId}`, { ...stage, segments: [scene] });
    const canonical = campaignContext({ text: entry.text, world: run.world, stageId: stage.id, runId: run.id, revision: run.revision, attempt: run.world.attempt });
    const { program } = await interpretCampaignWithDeepSeek(entry.text, canonical.world, { trace: (trace) => traces.push(trace) });
    let current = departStage(writeStageProgram(run, program));
    for (let i = 0; i < 80 && ['running', 'waiting'].includes(current.phase); i++) current = advanceStage(acknowledgePresentation(current), stageDynamics({ ...stage, segments: [scene] }));
    const rebinding = entry.portable ? resolveProgramBindings(stage.segments[1].enter(null), program) : null;
    const pass = current.phase === 'cleared' && (!entry.portable || (program.scope.stageId === stage.id && rebinding?.kind === 'resolved'));
    results.push({ provider: 'deepseek', id: entry.segmentId, text: entry.text, pass, phase: current.phase, reason: current.statusReason,
      portable: rebinding?.kind, program, latencyMs: Math.round(performance.now() - started), traces });
  } catch (error) { results.push({ provider: 'deepseek', id: entry.segmentId, pass: false, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), traces }); }
}
await writeFile(`${directory}/report.json`, JSON.stringify({ promptVersion: DEEPSEEK_CAMPAIGN_PROMPT_VERSION, scope: '4 bounded live provider calls; not exhaustive quality or blind difficulty evidence', results }, null, 2));
console.log(JSON.stringify({ calls: results.length, passed: results.filter((item) => item.pass).length, directory,
  results: results.map(({ provider, id, pass, latencyMs, phase, portable, error }) => ({ provider, id, pass, latencyMs, phase, portable, error })) }, null, 2));
if (results.some((item) => !item.pass)) process.exitCode = 1;
