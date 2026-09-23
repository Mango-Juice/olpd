import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { RULES_VERSION } from "../src/game/content";
import { newRun } from "../src/game/core";
import { makeSave, STORAGE_KEY } from "../src/game/storage";
import { createOnboardingProgress, ONBOARDING_STORAGE_KEY } from "../src/game/onboarding";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
// Compatibility-only: resume an existing v1 onboarding save, never create one in the current UI.
const oldRun = newRun(true);
await page.addInitScript(({ save, onboarding, saveKey, onboardingKey }) => {
  if (!sessionStorage.getItem("seeded-old-onboarding")) {
    localStorage.setItem(saveKey, JSON.stringify(save));
    localStorage.setItem(onboardingKey, JSON.stringify(onboarding));
    sessionStorage.setItem("seeded-old-onboarding", "true");
  }
}, { save: makeSave(oldRun, { writer: "old-onboarding-fixture" }), onboarding: createOnboardingProgress(oldRun.id), saveKey: STORAGE_KEY, onboardingKey: ONBOARDING_STORAGE_KEY });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

const steps = [
  { text: "문으로 걸어가", action: "advance", appliesTo: ["clear"] },
  { text: "바닥이 끊기면 뛰어넘어", action: "jump", appliesTo: ["pit"] },
  { text: "낮은 천장에서는 숙여", action: "duck", appliesTo: ["lowCeiling"] },
  { text: "벽이 막으면 옆길로 돌아", action: "detour", appliesTo: ["pitCeilingPath"] },
];
const calls = new Map<string, number>();

try {
  await page.route("**/api/interpret", async (route) => {
    const body = route.request().postDataJSON() as { text: string };
    calls.set(body.text, (calls.get(body.text) ?? 0) + 1);
    if (body.text === "서버 오류") {
      await route.fulfill({
        status: 503,
        json: { error: { message: "테스트 해석 오류" } },
      });
      return;
    }
    if (body.text.startsWith("느린")) {
      await wait(300);
      await route.fulfill({
        json: {
          text: body.text,
          action: "advance",
          appliesTo: ["clear"],
          uncertainty: 0,
          model: "browser-fixture",
          rulesVersion: RULES_VERSION,
        },
      }).catch(() => undefined);
      return;
    }
    const step = steps.find((entry) => entry.text === body.text);
    if (!step) throw new Error(`Unexpected fixture command: ${body.text}`);
    if (body.text === steps[0].text) await wait(120);
    await route.fulfill({
      json: {
        ...step,
        uncertainty: 0,
        model: "browser-fixture",
        rulesVersion: RULES_VERSION,
      },
    });
  });

  const spriteReady = page.waitForResponse((response) =>
    response.url().endsWith("/art/moru-sprite-sheet-v3.png"),
  );
  await page.goto("http://localhost:5173/");
  await spriteReady;
  await page.getByRole("button", { name: "이야기 SKIP", exact: true }).click();

  const input = page.locator("#onboarding-instruction");
  await input.fill("서버 오류");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("테스트 해석 오류");
  await expect(input).toHaveValue("서버 오류");
  await expect(page.locator(".play-stage-progress-heading")).toContainText("1-1 / 12개");

  await input.fill("느린 문장");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "취소", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(input).toHaveValue("느린 문장");
  await wait(350);
  await expect(page.locator(".play-stage-progress-heading")).toContainText("1-1 / 12개");

  await input.fill("느린 변경");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "취소", exact: true })).toBeVisible();
  await input.fill(steps[0].text);
  await wait(350);
  await expect(input).toHaveValue(steps[0].text);
  await expect(page.locator(".play-stage-progress-heading")).toContainText("1-1 / 12개");

  for (const [index, step] of steps.entries()) {
    await expect(page.locator(".play-stage-progress-heading")).toContainText(
      `1-${index + 1} / 12개`,
    );
    await page.locator(".legacy-onboarding-canvas").screenshot({
      path: `artifacts/legacy-onboarding-map-${index + 1}.png`,
    });
    await input.fill(step.text);
    if (index === 1) {
      await input.dispatchEvent("compositionstart");
      await input.press("Enter");
      expect(calls.get(step.text) ?? 0).toBe(0);
      await input.dispatchEvent("compositionend");
    }
    await input.press("Enter");
    if (index === 0) await input.press("Enter");
    await expect(page.locator(".legacy-onboarding-interpretation")).toHaveCount(0);
    await expect(page.locator(".play-stage-progress-heading")).toContainText(
      `1-${index + 2} / 12개`,
      { timeout: 10_000 },
    );
    expect(calls.get(step.text)).toBe(1);
    if (index === 0) await page.reload();
  }

  await expect(page.locator(".instruction-list .instruction")).toHaveCount(0);
  await expect(page.getByText(/정식 도입 연습 기록 ·/)).toBeVisible();
  await page.screenshot({
    path: "artifacts/legacy-onboarding-handoff.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".play-stage-progress-heading")).toContainText("1-5 / 12개");
  expect(calls.get("서버 오류")).toBe(1);
  expect(calls.get("느린 문장")).toBe(1);
  expect(calls.get("느린 변경")).toBe(1);
  expect(errors).toEqual([]);

  await writeFile(
    "artifacts/legacy-onboarding-browser.json",
    JSON.stringify(
      {
        passed: true,
        liveCalls: 0,
        providerStubCalls: [...calls.values()].reduce((sum, count) => sum + count, 0),
        checks: [
          "story skip does not skip learning",
          "Enter interprets, saves and executes without confirmation",
          "IME Enter does not submit",
          "pending cancel preserves the draft and blocks stale execution",
          "editing the draft aborts stale provider execution",
          "provider error preserves the draft",
          "rapid duplicate Enter submits once",
          "reload resumes",
          "empty core notebook",
          "learning history retained",
          "atomic campaign persistence",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("PASS unified Enter, IME, cancel, error, duplicate, resume and handoff");
} finally {
  await browser.close();
}
