import type { CampaignStageDefinition, SegmentDefinition } from '../../src/campaign/level';
import { stageDynamics } from '../../src/campaign/level';
import { acknowledgePresentation, advanceStage, createCampaignRun, departStage, writeStageProgram } from '../../src/campaign/run';
import type { InstructionProgram } from '../../src/campaign/types';

/** Paid evaluators share the real v3 lifecycle; they never bypass the presentation boundary. */
export function runSceneProgram(stage: CampaignStageDefinition, scene: SegmentDefinition, program: InstructionProgram) {
  const isolated = { ...stage, onboarding: [], segments: [scene] };
  let run = departStage(writeStageProgram(createCampaignRun(`probe-${scene.id}`, isolated), program));
  const dynamics = stageDynamics(isolated);
  let steps = 0;
  while (steps < 80 && (run.phase === 'running' || run.phase === 'waiting')) {
    run = advanceStage(acknowledgePresentation(run), dynamics);
    steps++;
  }
  return { run, steps };
}
