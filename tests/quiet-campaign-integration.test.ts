import { describe, expect, it } from 'vitest';
import { campaignAuthority } from '../src/campaign/authority';
import { resolveStage } from '../src/campaign/registry';
import { STAGES } from '../src/campaign/catalog';
import { stageDynamics } from '../src/campaign/level';
import { advanceStage, createCampaignRun, departStage, type StageRun } from '../src/campaign/run';
import { writeProgram } from '../src/campaign/notebook';
import { QUIET_EARLY_INTENT_CASES } from '../src/campaign/quiet/early';
import { QUIET_MIDDLE_INTENT_CASES } from './fixtures/quiet-middle-intents';
import { QUIET_LATE_INTENT_CASES } from './fixtures/quiet-late-intents';
const probes = [...QUIET_EARLY_INTENT_CASES, ...QUIET_MIDDLE_INTENT_CASES, ...QUIET_LATE_INTENT_CASES];
const authority = campaignAuthority(resolveStage);
function restore(run: StageRun): StageRun {
  const parsed = authority.parse(JSON.parse(JSON.stringify({ kind: 'world', run })));
  expect(parsed, `serialized ${run.world.segmentId}, revision ${run.revision}, ${run.phase}`).not.toBeNull();
  if (parsed?.kind !== 'world') throw new Error('Unrestorable run');
  return parsed.run;
}
describe('quiet campaign saved execution boundaries', () => {
  it.each(STAGES.slice(1))('finishes chapter $id across every serialized atomic boundary', (summary) => {
    const stage = resolveStage(summary.id)!;
    let run = restore(createCampaignRun(`integration-${stage.id}`, stage));
    for (const scene of stage.segments) {
      expect(run.world.segmentId).toBe(scene.id);
      const probe = probes.find((entry) => entry.segmentId === scene.id)!;
      run.notebook = writeProgram(run.notebook, { version: 2, id: scene.id, text: probe.text, model: 'fixture', scope: { stageId: stage.id, region: scene.id }, guard: false, body: probe.body });
      run = restore(departStage(run));
      for (let step = 0; step < 80 && ['running', 'waiting'].includes(run.phase) && run.world.segmentId === scene.id; step++) run = restore(advanceStage(run, stageDynamics(stage)));
      expect(run.clearedSegments, `${scene.id}: ${run.statusReason}`).toContain(scene.id);
      expect(run.notebook.bells).toBe(0);
    }
    expect(run.phase).toBe('cleared');
    expect(run.sceneNotes).toHaveLength(6);
    expect(authority.isCleared({ kind: 'world', run })).toBe(true);
  });
});
