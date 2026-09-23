import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { RULES_VERSION } from '../src/game/content';
const browser = await chromium.launch();
const key = 'one-line-per-death:qa:spatial-v1';
await mkdir('artifacts/contact-hints', {recursive:true});
try {
 for (const verb of ['move','jump'] as const) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/qa/campaign-interpret',route=>route.fulfill({json:{program:{version:2,id:'contact-fixture',model:'explicit-fixture',text:route.request().postDataJSON().text,scope:{region:'02-v2-1'},guard:false,
   body:{kind:'action',actor:'hero',verb,target:verb==='move'?'02-v2-1-exit':'02-v2-1-box'}}}}));
  const enter=()=>page.locator('.roadmap-stop').filter({has:page.getByRole('heading',{name:'비에 잠긴 회랑',exact:true})}).getByRole('button',{name:/들어가기|이어 걷기/}).click();
  const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!)['2'].run.run,key);
  try{
   await page.goto('http://localhost:5173/?qa=1');await enter();
   await expect(page.locator('.play-contact-hint')).toHaveCount(0);
   await page.locator('#campaign-instruction').fill(verb==='move'?'출구로 걸어가':'상자를 뛰어넘어');await page.locator('#campaign-instruction').press('Enter');
   await expect(page.locator('.play-contact-hint')).toContainText(verb==='move'?'상자':'천장',{timeout:15000});
   expect((await state()).presentation).toBeNull();
   await page.screenshot({path:`artifacts/contact-hints/${verb}.png`,fullPage:true});
   if(verb==='move'){
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:'artifacts/contact-hints/mobile.png',fullPage:true});
    await page.getByRole('button',{name:'포기하고 부활하기 · +1데스',exact:true}).click();
    await page.getByRole('button',{name:/한 줄 더 쓰지 않고 다시 출발/}).click();
    await expect.poll(async()=>{const r=await state();return r.world.attempt===2&&!r.presentation&&r.phase==='blocked';},{timeout:15000}).toBe(true);
    await expect(page.locator('.play-contact-hint')).toHaveCount(0);
    await page.reload();await enter();await expect(page.locator('.play-contact-hint')).toHaveCount(0);
   }
   expect(errors).toEqual([]);
  }finally{await context.close();}
 }
 for (const fixture of [
  { chapter: '평형 인형극장', scene: '07-v2-5', verb: 'take', target: '07-v2-5-bench', text: '긴 의자를 들어', hint: '양쪽' },
  { chapter: '돌아오지 못한 문지기', scene: '10-v2-5', verb: 'pull', target: 'latch', text: '걸쇠를 당겨', hint: '너무 높' },
 ]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
   await page.route('**/api/qa/campaign-interpret', route => route.fulfill({ json: { program: {
    version: 2, id: 'late-contact-fixture', model: 'explicit-fixture', text: route.request().postDataJSON().text,
    scope: { region: fixture.scene }, guard: false,
    body: { kind: 'action', actor: 'hero', verb: fixture.verb, target: fixture.target },
   } } }));
   await page.goto('http://localhost:5173/?qa=1');
   await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: fixture.chapter, exact: true }) })
    .getByRole('button', { name: /들어가기|이어 걷기/ }).click();
   await page.getByRole('combobox', { name: 'QA 스테이지 선택' }).selectOption(fixture.scene);
   await expect(page.locator('.play-contact-hint')).toHaveCount(0);
   await page.locator('#campaign-instruction').fill(fixture.text);
   await page.locator('#campaign-instruction').press('Enter');
   await expect(page.locator('.play-contact-hint')).toContainText(fixture.hint, { timeout: 15000 });
   await page.screenshot({ path: `artifacts/contact-hints/${fixture.scene}.png`, fullPage: true });
   expect(errors).toEqual([]);
  } finally { await context.close(); }
 }
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
 try {
  await page.route('**/api/interpret', route=>route.fulfill({json:{text:route.request().postDataJSON().text,action:'advance',appliesTo:['clear','pit'],uncertainty:0,model:'browser-fixture',rulesVersion:RULES_VERSION}}));
  await page.goto('http://localhost:5173/');await page.getByRole('button',{name:'이야기 SKIP',exact:true}).click();
  const input=page.locator('#onboarding-instruction');
  await input.fill('앞으로 걸어');await input.press('Enter');
  await expect(page.locator('.play-stage-progress-heading')).toContainText('1-2');
  await expect(input).toHaveValue('');await input.fill('계속 걸어');await input.press('Enter');
  await expect(page.locator('.play-contact-hint')).toContainText('뛰어넘을');
  await input.fill('그대로 걸어');await input.press('Enter');
  await expect(page.locator('.legacy-onboarding-result')).toContainText('쿠션');
  await expect(page.locator('.play-contact-hint')).toHaveCount(0);
 } finally {await context.close();}
 console.log('PASS actual crate vs ceiling hint, post-playback timing, once-per-discovery retry/reload, mobile, Chapter 1 onboarding, joint lifting and unreachable final latch; 0 paid calls');
}finally{await browser.close();}
