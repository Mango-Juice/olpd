import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolveStage } from '../src/campaign/registry';
import { stageDynamics } from '../src/campaign/level';
import { advanceStage, createCampaignRun, departStage } from '../src/campaign/run';
import { parseStageRun } from '../src/campaign/run-validation';
import type { InstructionProgram, ProgramNode } from '../src/campaign/types';
const stage=resolveStage(2)!;
const key='one-line-per-death:qa:spatial-v1';
const note=(id:string,body:ProgramNode):InstructionProgram=>({version:2,id,text:id,model:'explicit-fixture',scope:{region:'02-v2-1'},guard:false,body});
const walk=note('앞으로 계속 전진해',{kind:'action',actor:'hero',verb:'move',target:'02-v2-1-exit'});
const jump=note('상자가 보이면 점프해',{kind:'if',condition:{kind:'visible',entity:'02-v2-1-box'},then:{kind:'action',actor:'hero',verb:'jump',target:'02-v2-1-box'}});
const push=note('상자를 밀어',{kind:'action',actor:'hero',verb:'push',target:'02-v2-1-box'});
const browser=await chromium.launch();
await mkdir('artifacts/persistent-rules',{recursive:true});
try{
 for(const scenario of ['old-stop','jump-first','repeat-push'] as const){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  const errors:string[]=[];let apiCalls=0;page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))apiCalls++;});
  let run=createCampaignRun(`persistent-${scenario}`,stage);
  if(scenario==='old-stop')run=advanceStage(departStage(run),stageDynamics(stage));
  run.notebook.instructions=scenario==='jump-first'?[walk,jump]:scenario==='repeat-push'?[push]:[jump,walk];
  run.history.initialInstructions=structuredClone(run.notebook.instructions);
  if(scenario==='old-stop')run.execution.completed=run.notebook.instructions.map(n=>`${run.execution.epoch}:${n.id}`);
  expect(parseStageRun(run)).not.toBeNull();
  await page.addInitScript(({key,run})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({'2':{label:'2장',run:{kind:'world',run}}}));},{key,run});
  const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!)['2'].run.run,key);
  const enter=()=>page.locator('.roadmap-stop').filter({has:page.getByRole('heading',{name:'비에 잠긴 회랑',exact:true})}).getByRole('button',{name:/들어가기|이어 걷기/}).click();
  try{
   await page.goto('http://localhost:5173/?qa=1');await enter();
   if(scenario!=='old-stop')await page.getByRole('button',{name:/모험 출발/}).click();
   if(scenario==='repeat-push'){
    await expect.poll(async()=>(await state()).events.filter((e:{instructionId:string;reason:string})=>e.instructionId===push.id&&e.reason.includes('제자리')).length,{timeout:20000}).toBeGreaterThan(1);
    await page.reload();await enter();
    await expect.poll(async()=>(await state()).events.filter((e:{instructionId:string;reason:string})=>e.instructionId===push.id&&e.reason.includes('제자리')).length,{timeout:15000}).toBeGreaterThan(2);
    expect((await state()).phase).toBe('running');
   }else{
    await expect(page.locator('.play-contact-hint')).toContainText(scenario==='old-stop'?'상자':'천장',{timeout:20000});
    const current=await state();expect(current.notebook.deaths).toBe(0);
    const actions=current.events.filter((event:{actor:string|null})=>event.actor==='hero');
    expect(actions.length).toBeGreaterThan(0);expect(actions.every((event:{instructionId:string})=>event.instructionId===(scenario==='old-stop'?walk.id:jump.id))).toBe(true);
   }
   await page.screenshot({path:`artifacts/persistent-rules/${scenario}.png`,fullPage:true});
   expect(errors).toEqual([]);expect(apiCalls).toBe(0);
  }finally{await context.close();}
 }
 console.log('PASS persistent priorities, old consumed-stop recovery without death, repeated successful rule and reload; 0 API calls');
}finally{await browser.close();}
