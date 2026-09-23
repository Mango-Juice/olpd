import { chromium, expect } from '@playwright/test';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const raf=window.requestAnimationFrame.bind(window);
  (window as any).__frames=0;
  window.requestAnimationFrame=callback=>raf(time=>{(window as any).__frames++;callback(time);});
 });
 const count=()=>page.evaluate(()=>(window as any).__frames as number);
 await page.goto('http://localhost:5173/?qa=1');
 for(const title of ['기억의 던전','비에 잠긴 회랑','돌아오지 못한 문지기']){
  await page.locator('.roadmap-stop').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:/들어가기|이어 걷기/}).click();
  if(title==='기억의 던전')await page.getByRole('button',{name:/모험 이어하기/}).click();
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(350);let before=await count();await page.waitForTimeout(500);expect(await count()).toBe(before);
  const reduced=page.getByRole('checkbox',{name:'움직임과 장식 효과 줄이기'});
  await reduced.setChecked(!await reduced.isChecked());
  await page.waitForTimeout(150);expect((await count())-before).toBeGreaterThan(0);expect((await count())-before).toBeLessThanOrEqual(5);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  const canvas=page.locator('canvas').first();expect(await canvas.evaluate((node:HTMLCanvasElement)=>node.width)).toBeGreaterThan(300);
  expect(await canvas.evaluate((node:HTMLCanvasElement)=>node.toDataURL().length)).toBeGreaterThan(10000);
  before=await count();await page.waitForTimeout(400);expect(await count()).toBe(before);
  await page.getByRole('button',{name:'닫기',exact:true}).click();before=await count();await page.waitForTimeout(500);expect((await count())-before).toBeGreaterThan(5);
  // Simulate visibility events to exercise our lifecycle, not OS/browser throttling.
  await page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));");
  await page.waitForTimeout(100);before=await count();await page.waitForTimeout(400);expect(await count()).toBe(before);
  await page.evaluate(()=>{delete (document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
  before=await count();await page.waitForTimeout(400);expect((await count())-before).toBeGreaterThan(5);
  await page.getByRole('button',{name:'QA 장 선택',exact:true}).click();await page.waitForTimeout(100);before=await count();await page.waitForTimeout(400);expect(await count()).toBe(before);
  await page.setViewportSize({width:1440,height:1000});
 }
 expect(errors).toEqual([]);
 console.log('PASS Chapters 1/2/10: paused RAF stops; settings/resize redraw; visible resumes; simulated hidden stops; unmount cleanup');
}finally{await browser.close();}
