import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import {
  addInstruction,
  deleteInstruction,
  moveInstruction,
  newRun,
  practiceDeletion,
  retry,
  startMain,
  startRun,
  step,
} from "../src/game/core";
import { makeSave } from "../src/game/storage";
import type { RunState, SaveData } from "../src/game/types";
const base = process.env.APP_URL ?? "http://localhost:5173";
const original = JSON.parse(
  await readFile("artifacts/v2-production-real-clear-save.json", "utf8"),
) as SaveData;
const notes = original.state.instructions;
const run = (state: RunState) => {
  let next = startRun(state.phase === "dead" ? retry(state) : state);
  while (next.phase === "running") next = step(next);
  return next;
};
let tutorial = newRun(true);
tutorial = run(
  addInstruction(tutorial, notes[0].text, notes[0].interpretation),
);
tutorial = run(
  addInstruction(tutorial, notes[1].text, notes[1].interpretation),
);
for (let n = 0; n < 3; n++) tutorial = practiceDeletion(tutorial);
let state = run(startMain(tutorial));
state = addInstruction(state, notes[2].text, notes[2].interpretation);
state = moveInstruction(state, state.instructions[0].id, "up");
state = moveInstruction(state, state.instructions[1].id, "down");
state = deleteInstruction(state, state.instructions[1].id);
state = run(state);
state = run(addInstruction(state, notes[3].text, notes[3].interpretation));
state = run(addInstruction(state, notes[4].text, notes[4].interpretation));
expect(state.phase).toBe("cleared");
const save = makeSave(state, {
  writer: "chronicle-smoke",
  tutorialCompleted: true,
  settings: { muted: true, reducedMotion: true },
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base);
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    JSON.stringify(save),
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await page
    .getByRole("button", { name: "우리의 모험 돌아보기", exact: true })
    .click();
  await expect(page.locator(".chronicle-life")).toHaveCount(4);
  await expect(page.locator(".chronicle-change.write")).toHaveCount(3);
  await expect(page.locator(".chronicle-change.delete")).toHaveCount(1);
  await expect(page.locator(".chronicle-change.reorder")).toHaveCount(2);
  await expect(page.locator(".chronicle-legacy")).toHaveCount(0);
  await expect(page.locator(".chronicle-repeat").first()).toBeVisible();
  const before = await page.evaluate(() =>
    localStorage.getItem("one-line-per-death:save"),
  );
  await page
    .locator(".chronicle-action")
    .filter({ hasText: "바닥 가시" })
    .first()
    .getByRole("button")
    .click();
  await expect(page.locator(".chronicle-replay canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "다시 재생", exact: true })
    .waitFor({ timeout: 8000 });
  expect(
    await page.evaluate(() => localStorage.getItem("one-line-per-death:save")),
  ).toBe(before);
  await page.screenshot({ path: "artifacts/chronicle-desktop.png" });
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "새로운 도전", exact: true }).click();
  await page.getByRole("button", { name: "새 도전 시작", exact: true }).click();
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "지난 모험 기록", exact: true })
    .click();
  await expect(page.locator(".chronicle-archives li")).toHaveCount(1);
  await page.locator(".chronicle-archives button").click();
  await expect(page.locator(".chronicle-life")).toHaveCount(4);
  await page.screenshot({ path: "artifacts/chronicle-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const result = {
    passed: true,
    lives: 4,
    actions: state.events.length,
    historyEntries: state.history?.entries.length,
    checks: [
      "memo changes and life groups",
      "folded repeated safe paths",
      "isolated scene replay",
      "archive survives new challenge and reload",
      "desktop/mobile layout",
    ],
    errors,
  };
  await writeFile(
    "artifacts/chronicle-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
