import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { DEEPSEEK_CASES, fixtureProgram } from "./campaign-deepseek-cases";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const testCase = DEEPSEEK_CASES.find((item) => item.id === "intro-exact")!;
const program = fixtureProgram(testCase)!;
try {
  await page.goto("http://localhost:5173/?qa=1");
  const openChapter = async (title: string) => {
    await page.locator(".qa-grid section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).getByRole("button", { name: "바로 입장", exact: true }).click();
  };
  await openChapter("기억의 던전");
  await expect(page.locator(".topbar .brand")).toHaveText(/ONE LINE PER DEATH/);
  await expect(page.locator(".layout > .notebook.paper")).toBeVisible();
  await expect(page.locator(".play-stage-progress")).toContainText("1-1 / 8개 스테이지");
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await expect(page.locator(".composer textarea")).toBeVisible();
  await expect(page.locator(".play-hints")).not.toHaveAttribute("open");
  await page.locator(".play-hints > summary").click();
  await page.getByRole("button", { name: "볼 곳 알려주기", exact: true }).click();
  await expect(page.locator(".play-hints-reveal li")).toHaveCount(1);
  await page.screenshot({ path: "artifacts/shared-play-chapter1.png", fullPage: true });
  await page.getByRole("button", { name: "QA 장 선택", exact: true }).click();
  await openChapter("비에 잠긴 회랑");
  await expect(page.locator(".topbar .brand")).toHaveText(/ONE LINE PER DEATH/);
  await expect(page.locator(".layout > .notebook.paper")).toBeVisible();
  await expect(page.locator(".play-stage-progress")).toContainText("2-1 / 5개 스테이지");
  await expect(page.locator(".campaign-object-picker")).not.toHaveAttribute("open");
  await expect(page.locator(".campaign-scene-observation")).toHaveCount(0);
  await expect(page.locator(".play-hints")).not.toHaveAttribute("open");
  await page.locator(".campaign-object-picker > summary").click();
  await page.locator(".campaign-object-picker button").filter({ hasText: "코르크 상자" }).click();
  await expect(page.locator(".campaign-scene-observation")).toBeVisible();
  await expect(page.locator(".campaign-scene-observation details")).not.toHaveAttribute("open");
  await page.locator(".play-hints > summary").click();
  await page.getByRole("button", { name: "볼 곳 알려주기", exact: true }).click();
  await expect(page.locator(".play-hints-reveal li")).toHaveCount(1);
  const firstLearning = await page.locator(".campaign-learning").innerText();
  await page.route("**/api/qa/campaign-interpret", async (route) => {
    const request = route.request().postDataJSON();
    const interpreted = request.stageId === 4 ? { ...program, scope: { stageId: 4, region: "04-1" }, body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "pull", target: "04-1-lever", destination: "04-1-latch", amount: 1 },
      { kind: "action", actor: "hero", verb: "move", target: "04-1-exit" },
    ] } } : program;
    await route.fulfill({ json: { program: { ...interpreted, text: request.text }, confidence: null, needsConfirmation: true } });
  });
  await page.getByLabel("이번 생에 남길 한 줄", { exact: true }).fill(testCase.text);
  await page.getByRole("button", { name: "뜻 확인하기", exact: true }).click();
  await page.getByRole("button", { name: "이 뜻으로 메모하기", exact: true }).click();
  await expect(page.locator(".notebook .instruction")).toHaveCount(1);
  await page.getByRole("button", { name: "이 메모로 출발 →", exact: true }).click();
  await expect(page.locator(".play-stage-progress")).toContainText("2-2 / 5개 스테이지", { timeout: 15000 });
  await expect(page.locator(".play-stage-progress [aria-current=step]")).toContainText("두 물길");
  await expect(page.locator(".play-hints")).not.toHaveAttribute("open");
  await expect(page.locator(".campaign-scene-observation")).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("one-line-per-death:qa:v1")!)["2"]);
  expect(saved.run.run.clearedSegments).toEqual(["02-1"]);
  expect(saved.run.run.world.segmentId).toBe("02-2");
  await page.screenshot({ path: "artifacts/shared-play-chapter2-next.png", fullPage: true });
  await page.getByRole("button", { name: "QA 장 선택", exact: true }).click();
  await openChapter("바람 대장간");
  await expect(page.locator(".play-stage-progress")).toContainText("4-1 / 5개 스테이지");
  await page.getByLabel("이번 생에 남길 한 줄", { exact: true }).fill("화덕 손잡이를 끝까지 당겨 걸쇠에 걸고 출구로 가");
  await page.getByRole("button", { name: "뜻 확인하기", exact: true }).click();
  await page.getByRole("button", { name: "이 뜻으로 메모하기", exact: true }).click();
  await page.getByRole("button", { name: "이 메모로 출발 →", exact: true }).click();
  await expect(page.locator(".play-stage-progress")).toContainText("4-2 / 5개 스테이지", { timeout: 15000 });
  await expect(page.getByText("이전 스테이지의 장치 상태", { exact: false })).toBeVisible();
  await page.screenshot({ path: "artifacts/shared-play-chapter4-next.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator(".qa-grid section").filter({ has: page.getByRole("heading", { name: "비에 잠긴 회랑", exact: true }) }).getByRole("button", { name: "이어 하기", exact: true }).click();
  await expect(page.locator(".play-stage-progress")).toContainText("2-2 / 5개 스테이지");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "artifacts/shared-play-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  await writeFile("artifacts/shared-play-browser.json", JSON.stringify({ passed: true, firstLearning, checks: ["shared chapter 1/2 chrome and paper", "initial object details and hints folded", "single object inspection", "one hint at a time", "real physics 2-1 to separate 2-2 bookmark", "real physics 4-1 to 4-2 with separate previous device state", "new-stage disclosure reset", "reload preserves stage", "mobile no overflow"], errors, liveApiCalls: 0 }, null, 2));
  console.log("PASS: shared play, progressive disclosure, separate 2-1 → 2-2, persistence, mobile");
} finally { await browser.close(); }
