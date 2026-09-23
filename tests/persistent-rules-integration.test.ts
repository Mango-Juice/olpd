import { expect, it } from 'vitest';
import { resolveStage } from '../src/campaign/registry';
import { stageDynamics } from '../src/campaign/level';
import { acknowledgePresentation, advanceStage, resumeConsumedRules, createCampaignRun, departStage, type StageRun } from '../src/campaign/run';
import { parseStageRun } from '../src/campaign/run-validation';
import type { InstructionProgram, ProgramNode } from '../src/campaign/types';
const stage = resolveStage(2)!;
const note = (id: string, body: ProgramNode): InstructionProgram => ({version:2,id,text:id,model:'fixture',scope:{region:'02-v2-1'},guard:false,body});
const walk = note('계속 전진', {kind:'action',actor:'hero',verb:'move',target:'02-v2-1-exit'});
const jump = note('상자가 보이면 점프', {kind:'if',condition:{kind:'visible',entity:'02-v2-1-box'},then:{kind:'action',actor:'hero',verb:'jump',target:'02-v2-1-box'}});
function start(highToLow: InstructionProgram[]) {
 const run=createCampaignRun('persistent-spatial',stage);
 run.notebook.instructions=[...highToLow].reverse();
 run.history.initialInstructions=structuredClone(run.notebook.instructions);
 return departStage(run);
}
function settle(run:StageRun){for(let i=0;i<40&&['running','waiting'].includes(run.phase);i++)run=advanceStage(acknowledgePresentation(run),stageDynamics(stage));return acknowledgePresentation(run);}
it('unconditional walking above jump never falls through to that lower rule',()=>{
 const run=settle(start([walk,jump]));
 expect(run.phase).toBe('blocked');
 expect(run.events.filter(e=>e.actor==='hero').every(e=>e.instructionId===walk.id)).toBe(true);
 expect(run.events.some(e=>e.motion?.contact?.entity==='02-v2-1-box')).toBe(true);
});
it('putting the visible-box rule first attempts its jump into the actual low ceiling',()=>{
 const run=settle(start([jump,walk]));
 expect(run.events.filter(e=>e.actor==='hero').every(e=>e.instructionId===jump.id)).toBe(true);
 expect(run.events.some(e=>e.motion?.contact?.surface==='ceiling')).toBe(true);
});
it('a successful push stays eligible after save and reload, including old consumed flags',()=>{
 const push=note('상자를 밀어',{kind:'action',actor:'hero',verb:'push',target:'02-v2-1-box'});
 let run=start([push,walk]);
 for(let i=0;i<30;i++){
  run=acknowledgePresentation(advanceStage(run,stageDynamics(stage)));
  if(run.execution.active===null)break;
 }
 expect(run.phase).toBe('running');
 expect(run.world.entities['02-v2-1-box'].location.z).toBeCloseTo(1.4);
 run.execution.completed=[`${run.execution.epoch}:${push.id}`,`${run.execution.epoch}:${walk.id}`];
 const restored=parseStageRun(JSON.parse(JSON.stringify(run)));
 expect(restored).not.toBeNull();
 const next=advanceStage(restored!,stageDynamics(stage));
 expect(next.phase).toBe('running');
 expect(next.events.at(-1)?.instructionId).toBe(push.id);
 expect(next.events.length).toBeGreaterThan(run.events.length);
});

it('recovers an old consumed-notebook stop without a death or rewriting its records',()=>{
 let stopped=advanceStage(departStage(createCampaignRun('old-stop',stage)),stageDynamics(stage));
 stopped.notebook.instructions=[walk];
 stopped.history.initialInstructions=[walk];
 stopped.execution.completed=[`${stopped.execution.epoch}:${walk.id}`];
 const saved=parseStageRun(JSON.parse(JSON.stringify(stopped)));
 expect(saved).not.toBeNull();
 const resumed=resumeConsumedRules(saved!);
 expect(resumed.phase).toBe('running');
 expect(resumed.notebook).toEqual(stopped.notebook);
 expect(resumed.history).toEqual(stopped.history);
 expect(parseStageRun(resumed)).not.toBeNull();
 expect(advanceStage(resumed,stageDynamics(stage)).events.at(-1)?.instructionId).toBe(walk.id);
 const physical=settle(start([walk]));
 physical.execution.completed=['0:old-note'];
 expect(resumeConsumedRules(physical)).toBe(physical);
});
