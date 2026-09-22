import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
async function campaignRecord() {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("one-line-per-death:campaign"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<string>((resolve, reject) => { const request = db.transaction("campaign").objectStore("campaign").get("root"); request.onsuccess = () => resolve(JSON.stringify(request.result)); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
}
try {
  await page.goto("http://localhost:5173");
  await expect(page.getByRole("heading", { name: "한 줄이 용사의 길이 됩니다." })).toBeVisible();
  await expect(page.getByText("용사는 메모장에 적은 문장을 따라 움직여요. 실패해도 메모장은 남습니다.")).toBeVisible();
  const before = await campaignRecord();
  await page.screenshot({ path: "artifacts/prologue-short-guide.png", fullPage: true });
  await page.goto("http://localhost:5173/?qa=1");
  await expect(page.getByRole("heading", { name: "어디부터 확인할까요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "바로 입장", exact: true })).toHaveCount(11);
  await expect(page.locator(".qa-grid button:disabled")).toHaveCount(3);
  await page.screenshot({ path: "artifacts/local-qa-map.png", fullPage: true });
  const titles = ["프롤로그", "기억의 던전", "비에 잠긴 회랑", "태엽 부엌", "바람 대장간", "뒤집힌 정원", "등불 보관소", "평형 인형극장"];
  for (const title of titles) {
    await page.locator(".qa-grid section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).getByRole("button", { name: "바로 입장", exact: true }).click();
    await expect(page.locator(".qa-grid")).toHaveCount(0);
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "QA 장 선택", exact: true }).click();
  }
  const saved = await page.evaluate(() => localStorage.getItem("one-line-per-death:qa:v1"));
  await page.reload();
  await expect(page.getByRole("button", { name: "이어 하기", exact: true })).toHaveCount(8);
  expect(await page.evaluate(() => localStorage.getItem("one-line-per-death:qa:v1"))).toBe(saved);
  expect(await campaignRecord()).toBe(before);
  await page.getByRole("link", { name: "일반 플레이로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "한 줄이 용사의 길이 됩니다." })).toBeVisible();
  expect(await campaignRecord()).toBe(before);
  expect(errors).toEqual([]);
  await writeFile("artifacts/local-qa-browser.json", JSON.stringify({ passed: true, testedEntries: titles, unavailable: [8, 9, 10], savedAcrossReload: true, productionRecordUnchanged: true, errors }, null, 2));
  console.log("PASS: guide, 8 QA entries, unavailable stages, reload persistence, production isolation, no browser errors");
} finally { await browser.close(); }
