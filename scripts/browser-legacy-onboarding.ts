import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { RULES_VERSION } from "../src/game/content";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const steps = [
  { text: "문으로 걸어가", action: "advance", appliesTo: ["clear"] },
  { text: "바닥이 끊기면 뛰어넘어", action: "jump", appliesTo: ["pit"] },
  { text: "낮은 천장에서는 숙여", action: "duck", appliesTo: ["lowCeiling"] },
  { text: "벽이 막으면 옆길로 돌아", action: "detour", appliesTo: ["pitCeilingPath"] },
];
let calls = 0;
try {
  await page.route("**/api/interpret", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    const step = steps.find((entry) => entry.text === body.text)!;
    await route.fulfill({ json: { ...step, uncertainty: 0, model: "browser-fixture", rulesVersion: RULES_VERSION } });
  });
  const spriteReady = page.waitForResponse((response) => response.url().endsWith("/art/moru-sprite-sheet-v3.png"));
  await page.goto("http://localhost:5173/");
  await spriteReady;
  await page.getByRole("button", { name: "이야기 SKIP", exact: true }).click();
  for (const [index, step] of steps.entries()) {
    await expect(page.locator(".play-stage-progress-heading")).toContainText(`1-${index + 1} / 12개`);
    await page.locator(".legacy-onboarding-canvas").screenshot({ path: `artifacts/legacy-onboarding-map-${index + 1}.png` });
    await page.locator("#onboarding-instruction").fill(step.text);
    await page.getByRole("button", { name: /뜻 확인/, exact: false }).click();
    await expect(page.locator(".legacy-onboarding-interpretation")).toBeVisible();
    // Interpretation alone must not complete the learning room.
    await expect(page.locator(".play-stage-progress-heading")).toContainText(`1-${index + 1} / 12개`);
    await page.getByRole("button", { name: /이 뜻으로 움직이기/ }).click();
    await expect(page.locator(".play-stage-progress-heading")).toContainText(`1-${index + 2} / 12개`, { timeout: 10000 });
    if (index === 0) await page.reload();
  }
  await expect(page.locator(".instruction-list .instruction")).toHaveCount(0);
  await expect(page.getByText(/정식 도입 연습 기록 ·/)).toBeVisible();
  await page.screenshot({ path: "artifacts/legacy-onboarding-handoff.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".play-stage-progress-heading")).toContainText("1-5 / 12개");
  expect(calls).toBe(4);
  expect(errors).toEqual([]);
  await writeFile("artifacts/legacy-onboarding-browser.json", JSON.stringify({ passed: true, liveCalls: 0, providerStubCalls: calls, checks: ["story skip does not skip learning", "four separate rooms", "preview before movement", "reload resumes", "empty core notebook", "learning history retained", "atomic campaign persistence"], errors }, null, 2));
  console.log("PASS fresh story skip, four scenes, preview, resume, core handoff and history");
} finally { await browser.close(); }
