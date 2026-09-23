import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import type { RunState } from "../src/game/types";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await page.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const notes = [
  { text: "앞으로 전진해", action: "advance", appliesTo: ["clear", "pit", "bridge", "floorSpikes", "lowCeiling", "pitCeilingPath", "spikesCeilingPath"] },
  { text: "구덩이나 바닥 가시가 있으면 점프해", action: "jump", appliesTo: ["pit", "bridge", "floorSpikes", "pitCeilingPath", "spikesCeilingPath"] },
  { text: "천장이 낮으면 숙여", action: "duck", appliesTo: ["lowCeiling", "pitCeilingPath", "spikesCeilingPath"] },
  { text: "샛길이 있으면 우회해", action: "detour", appliesTo: ["pitCeilingPath", "spikesCeilingPath"] },
];
async function documentFor(page: Page): Promise<any> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("one-line-per-death:campaign");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("campaign").objectStore("campaign").get("root");
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
}
async function run(): Promise<RunState> {
  const data = await documentFor(page);
  return (data.activeRuns.find((item: any) => item.payload.kind === "legacy") ??
    data.archives.find((item: any) => item.payload.kind === "legacy")).payload.save.state;
}
let calls = 0;
try {
  await mkdir("artifacts/chapter-six", { recursive: true });
  await page.route("**/api/interpret", async route => {
    calls++;
    const { text } = route.request().postDataJSON();
    if (text === "오류 확인") {
      await route.fulfill({ status: 503, json: { error: { message: "검사용 통신 오류" } } });
      return;
    }
    const note = notes.find(note => note.text === text);
    if (!note) throw new Error("Unexpected interpretation fixture: " + text);
    await route.fulfill({ json: { ...note, uncertainty: 0, model: "fixture", rulesVersion: "1" } });
  });
  await page.goto(process.env.APP_URL ?? "http://localhost:5173/");
  await page.getByRole("button", { name: "이야기 SKIP", exact: true }).click();
  await expect(page.locator(".play-stage-progress-heading")).toContainText("1-1 / 6개");
  const input = page.locator("#instruction");
  await input.fill("오류 확인");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("검사용 통신 오류");
  expect((await run()).instructions).toHaveLength(0);
  expect((await run()).canWrite).toBe(true);
  await input.fill(notes[0].text);
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  expect(calls).toBe(1);
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect.poll(async () => (await run()).phase, { timeout: 20000 }).toBe("dead");
  await expect(input).toBeVisible({ timeout: 12000 });
  expect((await run()).room).toBe(1);
  const originalId = (await run()).instructions[0].id;
  await page.screenshot({ path: "artifacts/chapter-six/first-condition.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: /모험 이어하기/ }).click();
  expect((await run()).instructions[0].id).toBe(originalId);
  for (let i = 1; i < notes.length; i++) {
    await expect(input).toBeVisible({ timeout: 12000 });
    await input.fill(notes[i].text);
    await input.press("Enter");
    await expect.poll(async () => (await run()).instructions.length).toBe(i + 1);
    await expect.poll(async () => (await run()).phase, { timeout: 30000 }).toBe(i === 3 ? "cleared" : "dead");
  }
  const final = await run();
  expect(final).toMatchObject({ layoutVersion: 3, tutorial: false, room: 5, point: 1, deaths: 3, erasers: 2 });
  expect(final.instructions[0].id).toBe(originalId);
  expect(final.instructions).toHaveLength(4);
  const chapter2 = page.locator(".roadmap-stop").filter({ has: page.getByRole("heading", { name: "비에 잠긴 회랑", exact: true }) });
  await expect(chapter2.getByRole("button", { name: /들어가기|이어 걷기/ })).toBeEnabled({ timeout: 15000 });
  await page.screenshot({ path: "artifacts/chapter-six/unlocked.png", fullPage: true });
  await page.locator(".roadmap-stop").filter({ has: page.getByRole("heading", { name: "기억의 던전", exact: true }) }).getByRole("button", { name: /새 모험 시작/ }).click();
  // A completed chapter creates a new six-scene run, preserving its archive.
  await page.getByRole("button", { name: /모험 이어하기/ }).click();
  expect((await run()).layoutVersion).toBe(3);
  expect((await run()).instructions).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/chapter-six/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  await writeFile("artifacts/chapter-six/report.json", JSON.stringify({ calls, paidCalls: 0, errors, final, checks: ["story SKIP", "six scenes", "Enter/IME/error", "persistent notebook", "reload", "clear unlocks chapter2", "replay uses v3", "mobile overflow"] }, null, 2));
  console.log("PASS six-scene Chapter 1 through chapter2 unlock; persistent notebook, reload, Enter/IME/error, mobile; 0 paid calls");
} finally { await browser.close(); }
