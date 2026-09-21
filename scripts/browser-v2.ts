import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import {
  newRun,
  addInstruction,
  startRun,
  step,
  retry,
} from "../src/game/core";
import { makeSave } from "../src/game/storage";
import type { SaveData } from "../src/game/types";
const base = process.env.APP_URL ?? "http://localhost:5173";
const original = JSON.parse(
  await readFile("artifacts/production-real-death-save.json", "utf8"),
) as SaveData;
let tutorial = newRun(true);
const [a, b] = original.state.instructions;
tutorial = addInstruction(tutorial, a.text, a.interpretation);
tutorial = step(step(startRun(tutorial)));
tutorial = addInstruction(tutorial, b.text, b.interpretation);
tutorial = startRun(retry(tutorial));
while (tutorial.phase === "running") tutorial = step(tutorial);
const practice = makeSave(tutorial, {
  writer: "layout-verification",
  settings: { muted: true, reducedMotion: false },
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    JSON.stringify(practice),
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await expect(
    page.getByRole("button", { name: "이 연습 문장 지우기" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/v2-practice-desktop.png",
    fullPage: true,
  });
  const colors = await page.locator(".practice").evaluate((el) => ({
    ink: getComputedStyle(el).color,
    paper: getComputedStyle(el).backgroundColor,
    body: getComputedStyle(el.querySelector("p")!).color,
  }));
  expect(colors.ink).toBe("rgb(66, 57, 46)");
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    JSON.stringify(original),
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await expect(page.locator(".memory-priority")).toContainText("위쪽 메모부터");
  await expect(page.locator(".instruction").first()).toContainText(
    original.state.instructions.at(-1)!.text,
  );
  await expect(page.locator(".instruction.active")).toContainText(
    "방금 따른 기억",
  );
  await expect(page.locator(".route-hint")).toContainText("우회");
  await expect(page.locator(".line-number, .latest-memory")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/v2-priority-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/v2-priority-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "방금 무슨 일이?" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    original.state.lastEvent!.instructionText!,
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".situation")).toHaveCount(0);
  await expect(
    page.getByText("익숙한 길은 빠르게, 처음 보는 길은 천천히"),
  ).toHaveCount(0);
  await expect(page.getByText("Jev와 함께 배우는 중")).toHaveCount(0);
  expect(
    await page
      .locator(".memory-priority")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(30);
  await page.getByLabel("한 장면씩 보기").check();
  await page
    .getByRole("button", { name: "한 줄 더 쓰지 않고 다시 출발" })
    .click();
  await expect(page.locator(".scene-caption")).toContainText(
    "다시, 던전 입구에서",
  );
  await expect(page.getByRole("button", { name: "다음 장면" })).toBeVisible({
    timeout: 12000,
  });
  const readEventId = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("one-line-per-death:save")!).state
          .lastEvent.id,
    );
  const firstEvent = await readEventId();
  await page.waitForTimeout(1700);
  expect(await readEventId()).toBe(firstEvent);
  await page.getByRole("button", { name: "다음 장면" }).click();
  expect(await readEventId()).not.toBe(firstEvent);
  await expect(page.getByRole("button", { name: "다음 장면" })).toBeVisible({
    timeout: 12000,
  });
  await page.getByLabel("한 장면씩 보기").uncheck();
  await expect(
    page.getByRole("button", { name: "다음 장면" }),
  ).not.toBeVisible();
  let repeatedFailure = startRun(retry(original.state));
  while (repeatedFailure.phase === "running")
    repeatedFailure = step(repeatedFailure);
  const repeatedSave = makeSave(repeatedFailure, {
    writer: "hint-verification",
    settings: { muted: true, reducedMotion: false },
    tutorialCompleted: true,
  });
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    JSON.stringify(repeatedSave),
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await expect(page.locator(".route-hint")).toHaveCount(0);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        passed: true,
        colors,
        checks: [
          "readable practice foreground",
          "saved priority display order",
          "recorded winner badge",
          "no instruction numbering or newest badge",
          "in-scene accident caption",
          "mobile width",
          "readable execution history",
          "compact priority and removed duplicate copy",
          "entrance caption on retry",
          "scene-by-scene holds, advances once, and resumes",
          "detour hint appears after the first fork failure, not repeat failures",
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    "artifacts/v2-ui-report.json",
    JSON.stringify({ base, passed: true, colors, errors }, null, 2),
  );
} finally {
  await browser.close();
}
