import { expect, it } from 'vitest';
import { runSceneProgram } from '../scripts/lib/run-campaign-probe';
import { QUIET_RAIN_STAGE, QUIET_EARLY_INTENT_CASES, quietEarlyProgram } from './fixtures/quiet-worlds/early';
import { parseStageRun } from '../src/campaign/run-validation';

it('live evaluator advances every presentation boundary and preserves valid notebook history without AI', () => {
  const scene = QUIET_RAIN_STAGE.segments[0];
  const intent = QUIET_EARLY_INTENT_CASES.find((item) => item.segmentId === scene.id)!;
  const { run, steps } = runSceneProgram(QUIET_RAIN_STAGE, scene, quietEarlyProgram(intent));
  expect(steps).toBeGreaterThan(1);
  expect(run.phase).toBe('cleared');
  expect(run.clearedSegments).toEqual([scene.id]);
  expect(run.history.entries[0].kind).toBe('write');
  expect(parseStageRun(JSON.parse(JSON.stringify(run)))).not.toBeNull();
});
