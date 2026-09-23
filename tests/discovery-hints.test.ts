import { expect, it } from 'vitest';
import { latestDiscovery } from '../src/game/hints/discovery';
import { chapterOneContactHint, onboardingContactHint } from '../src/game/hints/chapter-one';
import { newRun } from '../src/game/core';
import type { ExecutionEvent } from '../src/game/types';
import type { OnboardingProgress } from '../src/game/onboarding';
const a={key:'a',text:'A'},b={key:'b',text:'B'};
it('suppresses learned discoveries but does not consume an unseen second candidate',()=>{
 expect(latestDiscovery([[a,b],[a,b]],row=>row)).toEqual(b);
 expect(latestDiscovery([[a,b],[a,b],[a,b]],row=>row)).toBeNull();
 expect(latestDiscovery([[a]],row=>row,['a'])).toBeNull();
});
it('keeps first chapter later hazards on the shared first-discovery policy',()=>{
 const state=newRun(false);
 const event:ExecutionEvent={id:'spikes',room:2,point:0,observation:'floorSpikes',action:'advance',instructionId:'walk',instructionText:'전진해',outcome:'death',reason:'가시',repeated:false};
 state.phase='dead';state.events=[event];state.lastEvent=event;
 expect(chapterOneContactHint(state)?.text).toContain('가시');
 const next={...event,id:'again'};state.events.push(next);state.lastEvent=next;
 expect(chapterOneContactHint(state)).toBeNull();
});
it('does not repeat onboarding discoveries or show a hint for an inapplicable instruction',()=>{
 const progress={attempts:[{stageId:'single-gap',applied:true,succeeded:false}]} as OnboardingProgress;
 expect(onboardingContactHint(progress)).toContain('뛰어넘');
 progress.attempts.push({...progress.attempts[0]});
 expect(onboardingContactHint(progress)).toBeNull();
 progress.attempts.push({...progress.attempts[0],stageId:'low-arch',applied:false});
 expect(onboardingContactHint(progress)).toBeNull();
});
