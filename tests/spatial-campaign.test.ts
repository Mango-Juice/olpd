import { describe, expect, it } from 'vitest';
import { SPATIAL_STAGES } from '../src/campaign/spatial/catalog';
import { SPATIAL_INTENT_CASES, spatialFixtureProgram } from './fixtures/spatial-intents';
import { runSceneProgram } from '../scripts/lib/run-campaign-probe';
import { parseStageRun } from '../src/campaign/run-validation';
import { createCampaignRun, createStageRun, writeStageProgram, departStage, advanceStage, acknowledgePresentation, retryStage, abandonStage, type StageRun } from '../src/campaign/run';
import { stageDynamics } from '../src/campaign/level';

function settle(run: StageRun, stage: typeof SPATIAL_STAGES[number]): StageRun {
  for(let i=0;i<512 && ['running','waiting'].includes(run.phase);i++) run=advanceStage(acknowledgePresentation(run),stageDynamics(stage));
  return acknowledgePresentation(run);
}
describe('spatial campaign integration (explicit fixtures, no AI)', () => {
  it('defines 54 real scenes under one spatial lifecycle', () => {
    expect(SPATIAL_STAGES).toHaveLength(9);
    expect(SPATIAL_INTENT_CASES).toHaveLength(54);
    for(const stage of SPATIAL_STAGES) {
      expect(stage.contentRevision).toBe('spatial-v1');
      expect(stage.segments).toHaveLength(6);
      for(const scene of stage.segments) expect(scene.scene?.spatial).toBeDefined();
    }
  });
  for(const stage of SPATIAL_STAGES) {
    it(`chapter ${stage.id} keeps every scene stationary without a written command`,()=>{
      for(const scene of stage.segments) {
        const initial=departStage(createStageRun(`idle-${scene.id}`,scene.enter(null),stage.contentRevision));
        const stopped=advanceStage(initial,stageDynamics(stage));
        expect(stopped.phase,scene.id).toBe('blocked');
        expect(stopped.world,scene.id).toEqual(initial.world);
        expect(stopped.notebook.deaths,scene.id).toBe(0);
        expect(stopped.events.filter(event=>event.actor==='hero'),scene.id).toHaveLength(0);
        expect(stopped.presentation,scene.id).toBeNull();
      }
    });
    for(const scene of stage.segments) {
      it(`${scene.id} intended program traverses the actual spatial engine and serializes`,()=>{
        const intent=SPATIAL_INTENT_CASES.find(c=>c.segmentId===scene.id)!;
        const {run}=runSceneProgram(stage,scene,spatialFixtureProgram(intent));
        expect(run.statusReason, JSON.stringify(run.events.slice(-2))).not.toBeUndefined();
        expect(run.phase,run.statusReason??'unfinished').toBe('cleared');
        const actorActions=run.events.filter(event=>event.actor!==null);
        expect(actorActions.length,scene.id).toBeGreaterThan(0);
        expect(actorActions.every(event=>event.instructionId===`spatial-fixture-${scene.id}`),scene.id).toBe(true);
        expect(parseStageRun(JSON.parse(JSON.stringify(run)))).not.toBeNull();
      });
    }
    it(`chapter ${stage.id} preserves accumulated notes through deaths and entrance retries`,()=>{
      let run=createCampaignRun(`spatial-life-${stage.id}`,stage);
      const learned = new Set<string>();
      while(run.phase !== 'cleared' && learned.size < stage.segments.length) {
        const sceneId = run.world.segmentId;
        expect(learned.has(sceneId), `same scene failed after its intended note: ${sceneId}: ${run.statusReason}`).toBe(false);
        const intent=SPATIAL_INTENT_CASES.find(c=>c.segmentId===sceneId)!;
        if(run.phase==='blocked') run=acknowledgePresentation(abandonStage(run));
        expect(['bookmark','failed']).toContain(run.phase);
        learned.add(sceneId);
        run=writeStageProgram(run,spatialFixtureProgram(intent));
        if(run.phase==='failed') run=acknowledgePresentation(retryStage(run));
        run=settle(departStage(run),stage);
        expect(run.notebook.instructions).toHaveLength(learned.size);
      }
      expect(run.phase,run.statusReason??'unfinished').toBe('cleared');
      expect(run.clearedSegments).toHaveLength(6);
      expect(parseStageRun(JSON.parse(JSON.stringify(run)))).not.toBeNull();
    });
  }
});
