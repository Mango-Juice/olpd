import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { addInstruction } from "../src/game/core";
import { makeSave } from "../src/game/storage";
import {
  createFirstForkDeathSave,
  FIXTURE_INSTRUCTIONS,
  runUntilTerminal,
} from "./browser-fixtures";
import { installLegacyBrowserHarness } from "./legacy-browser-harness";
const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
await mkdir("artifacts", { recursive: true });
const deadFixture = createFirstForkDeathSave("browser-notebook-dead-fixture");
const deadSave = JSON.stringify(deadFixture);
const clearState = runUntilTerminal(
  addInstruction(
    deadFixture.state,
    FIXTURE_INSTRUCTIONS[4].text,
    FIXTURE_INSTRUCTIONS[4].interpretation,
  ),
);
expect(clearState.phase).toBe("cleared");
const clearSave = JSON.stringify(
  makeSave(clearState, {
    writer: "browser-notebook-clear-fixture",
    tutorialCompleted: true,
    settings: { muted: true, reducedMotion: true },
    savedAt: 2,
  }),
);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
await installLegacyBrowserHarness(page);
const state = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("one-line-per-death:save")!).state,
  );
try {
  await page.goto(base);
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    deadSave,
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await page.locator(".notebook-summary").click();
  const initial = await state();
  await page.locator(".erase-button").last().click();
  await expect(page.getByRole("dialog")).toContainText("지우개 1개");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  expect(await state()).toEqual(initial);
  for (let i = 0; i < 3; i++) {
    await page.locator(".erase-button").last().click();
    await expect(page.getByRole("dialog")).toContainText(
      i < 2 ? "지우개 1개" : "3데스",
    );
    await page.getByRole("button", { name: "비용을 사용하고 삭제" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const s = await state();
    expect(s.erasers).toBe(Math.max(0, 1 - i));
    expect(s.penaltyDeaths).toBe(i === 2 ? 3 : 0);
    expect(s.canWrite).toBe(initial.canWrite);
  }
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  expect((await state()).penaltyDeaths).toBe(3);
  await page
    .getByRole("button", {
      name: /한 줄 더 쓰지 않고 다시 출발|입구에서 다시 출발/,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: /한 줄 더 쓰지 않고 다시 출발|입구에서 다시 출발/,
    }),
  ).toBeVisible({ timeout: 20000 });
  const after = await state();
  expect(after.lastEvent.observation).toBe("pit");
  expect(after.lastEvent.outcome).toBe("death");
  expect(after.deaths).toBe(4);
  expect(after.penaltyDeaths).toBe(3);
  await page.screenshot({
    path: `artifacts/${label}-mobile-deletion.png`,
    fullPage: true,
  });
  await page.goto(`${base}/?challenge=new`);
  await page.getByRole("button", { name: "새 모험 시작" }).click();
  expect((await state()).deaths).toBe(0);
  expect((await state()).instructions).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((k) =>
        k.startsWith("one-line-per-death:save.recovery."),
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("배경음악·효과음 끄기").check();
  await page.getByLabel("움직임과 장식 효과 줄이기").check();
  await page.reload();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByLabel("배경음악·효과음 끄기")).toBeChecked();
  await expect(page.getByLabel("움직임과 장식 효과 줄이기")).toBeChecked();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.evaluate(
    (raw) => localStorage.setItem("one-line-per-death:save", raw),
    clearSave,
  );
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await page.getByRole("button", { name: "우리의 모험 공유하기" }).click();
  await page.getByRole("button", { name: "내용 복사" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "복사",
  );
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("challenge=new");
  expect(copied).not.toContain("나의 메모장");
  const checks = [
    "mobile deletion cancellation no cost",
    "two erasers then +3 atomic penalty",
    "penalty does not grant new writing chance",
    "penalty survives refresh once",
    "deleting jump rules changes earlier pit outcome",
    "shared link archives existing record and starts new",
    "mute/reduced-motion persistence",
    "mobile clear restore and actual clipboard share",
  ];
  console.log(
    JSON.stringify(
      { passed: true, fixtureMode: "deterministic-core", checks },
      null,
      2,
    ),
  );
  await writeFile(
    `artifacts/${label}-notebook-report.json`,
    JSON.stringify(
      { passed: true, fixtureMode: "deterministic-core", checks },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({
    path: `artifacts/${label}-notebook-failure.png`,
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
