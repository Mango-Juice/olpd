import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const commands = [
  { text: "코르크 상자를 빈 자리로 밀어", verb: "push", target: "02-learn-box", destination: "02-learn-box-spot" },
  { text: "빈 상자를 물받이에 놓아", verb: "place", target: "02-learn-floating-box", destination: "02-learn-basin" },
  { text: "떠 있는 상자에 올라", verb: "board", target: "02-learn-raft-box" },
];
try {
  await page.goto("http://localhost:5173/?qa=1");
  const openChapter = async (title: string) => {
    await page.locator(".roadmap-stop").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).getByRole("button", { name: /들어가기|이어 걷기/ }).click();
  };
  await openChapter("비에 잠긴 회랑");
  const before = await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
  let requests = 0;
  await page.route("**/api/qa/campaign-interpret", async (route) => {
    requests++;
    if (requests === 1 && process.env.LIVE_AI === "true") { await route.continue(); return; }
    const request = route.request().postDataJSON();
    const index = Number(String(request.world.segmentId).split("-").at(-1)) - 1;
    const command = commands[index];
    // Real parser + preflight + execution + storage after this provider-boundary stub.
    await route.fulfill({ json: { program: { version: 2, id: `browser-${requests}`, text: request.text, model: "browser-fixture", scope: { stageId: 2, region: request.world.segmentId }, guard: false, body: { kind: "action", actor: "hero", verb: command.verb, target: command.target, ...(command.destination ? { destination: command.destination } : {}) } }, confidence: null, needsConfirmation: true } });
  });
  for (const [index, command] of commands.entries()) {
    await expect(page.locator(".play-stage-progress-heading")).toContainText(`2-${index + 1} / 8개`);
    await page.locator("#campaign-instruction").fill(command.text);
    await page.getByRole("button", { name: "뜻 확인하기", exact: true }).click();
    await page.getByRole("button", { name: "이 뜻으로 메모하기", exact: true }).click();
    await expect(page.locator(".notebook .instruction")).toHaveCount(1);
    if (index === 0) {
      await page.locator("#campaign-instruction").fill(command.text + " 주세요");
      await page.getByRole("button", { name: "뜻 확인하기", exact: true }).click();
      await page.getByRole("button", { name: "이 뜻으로 메모하기", exact: true }).click();
      await expect(page.locator(".notebook .instruction")).toHaveCount(1);
    }
    await page.getByRole("button", { name: "이 메모로 출발 →", exact: true }).click();
    await expect(page.locator(".play-stage-progress-heading")).toContainText(`2-${index + 2} / 8개`, { timeout: 10000 });
    if (index === 0) {
      await page.reload();
      await openChapter("비에 잠긴 회랑");
    }
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("one-line-per-death:qa:v1")!)["2"].run.run);
  expect(saved.world.segmentId).toBe("02-1");
  expect(saved.checkpoint.segmentId).toBe("02-1");
  expect(saved.notebook.instructions).toEqual([]);
  expect(saved.notebook.canWrite).toBe(true);
  expect(saved.notebook.deaths).toBe(0);
  expect(saved.notebook.erasers).toBe(2);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).toEqual(before);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/onboarding-handoff.png", fullPage: true });
  await writeFile("artifacts/onboarding-browser.json", JSON.stringify({ passed: true, requests, liveCalls: process.env.LIVE_AI === "true" ? 1 : 0, checks: ["free replace", "separate scenes", "resume intro", "clean core handoff", "isolated QA"], errors }, null, 2));
  console.log("PASS onboarding free edits, reload, 3 scenes to core handoff, isolated QA");
} finally { await browser.close(); }
