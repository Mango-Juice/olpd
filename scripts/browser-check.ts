import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "no-preference",
});
// tsx preserves function names with a helper that must exist in serialized browser callbacks.
await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
await context.addInitScript(() => {
  const w = window as typeof window & {
    __audioEvidence: { starts: number; contexts: AudioContext[] };
  };
  w.__audioEvidence = { starts: 0, contexts: [] };
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) {
      super(options);
      w.__audioEvidence.contexts.push(this);
    }
    createOscillator() {
      const node = super.createOscillator();
      const start = node.start.bind(node);
      node.start = (when?: number) => {
        w.__audioEvidence.starts++;
        start(when);
      };
      return node;
    }
  };
});
await context.addInitScript(() => {
  const w = window as unknown as {
    __frameEvidence: {
      enabled: boolean;
      count: number;
      total: number;
      slow: number;
      max: number;
    };
  };
  w.__frameEvidence = { enabled: false, count: 0, total: 0, slow: 0, max: 0 };
  let last = 0;
  function tick(t: number) {
    const d = t - last;
    last = t;
    const sample = w.__frameEvidence;
    if (sample.enabled && d > 0) {
      sample.count++;
      sample.total += d;
      if (d > 25) sample.slow++;
      sample.max = Math.max(sample.max, d);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const calls: { text: string; status: number; model?: string }[] = [];
page.on("response", async (r) => {
  if (r.url().endsWith("/api/interpret")) {
    const b = await r.json().catch(() => ({}));
    calls.push({
      text: JSON.parse(r.request().postData() ?? "{}").text,
      status: r.status(),
      model: b.model,
    });
  }
});
const state = async (p: Page = page) =>
  p.evaluate(
    () =>
      JSON.parse(localStorage.getItem("one-line-per-death:save") ?? "null")
        ?.state,
  );
async function teach(text: string) {
  const isFirst = (await state()).instructions.length === 0;
  await page.locator("#instruction").fill(text);
  await page.locator("#instruction").press("Enter");
  if (isFirst) {
    await expect(
      page.getByRole("button", { name: "기억하고 출발", exact: false }),
    ).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("button", { name: "기억하고 출발", exact: false })
      .click();
  }
  await expect
    .poll(
      async () =>
        (await state()).instructions.some(
          (i: { text: string }) => i.text === text,
        ),
      { timeout: 20000 },
    )
    .toBe(true);
}
async function go() {
  await page
    .getByRole("button", {
      name: /^(모험 출발|한 줄 더 쓰지 않고 다시 출발|입구에서 다시 출발)/,
    })
    .click();
}
async function dead() {
  await expect(
    page.getByRole("button", {
      name: /한 줄 더 쓰지 않고 다시 출발|입구에서 다시 출발/,
    }),
  ).toBeVisible({ timeout: 70000 });
}
try {
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "첫 번째 한 줄 남기기" }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/${label}-desktop-title.png`,
    fullPage: true,
  });
  const frameStats = await page.evaluate(
    () =>
      new Promise<{ fps: number; slowFrames: number }>((resolve) => {
        let last = performance.now();
        const intervals: number[] = [];
        function tick(now: number) {
          intervals.push(now - last);
          last = now;
          if (intervals.length < 120) requestAnimationFrame(tick);
          else
            resolve({
              fps: Math.round(
                1000 /
                  (intervals.reduce((a, b) => a + b, 0) / intervals.length),
              ),
              slowFrames: intervals.filter((d) => d > 25).length,
            });
        }
        requestAnimationFrame(tick);
      }),
  );
  await page.getByRole("button", { name: "첫 번째 한 줄 남기기" }).click();
  await teach("앞으로 전진해");
  await expect(
    page.getByRole("button", { name: "방금 무슨 일이?" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.waitForTimeout(100);
  const frozen = await page
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(300);
  expect(
    await page
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).toBe(frozen);
  await page.getByRole("button", { name: "다시 재생", exact: true }).click();
  await dead();
  await page.screenshot({
    path: `artifacts/${label}-tutorial-death.png`,
    fullPage: true,
  });
  if ((await state()).deaths !== 1)
    throw new Error("Tutorial death was not committed once");
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  if ((await state()).deaths !== 1)
    throw new Error("Reload double charged death");
  await teach("구덩이가 있으면 뛰어");
  await expect(
    page.getByRole("button", { name: "이 연습 문장 지우기" }),
  ).toBeVisible({ timeout: 40000 });
  await page.getByRole("button", { name: "이 연습 문장 지우기" }).click();
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await expect(page.getByText("지우개 연습 · 2 / 3")).toBeVisible();
  for (let i = 0; i < 2; i++)
    await page.getByRole("button", { name: "이 연습 문장 지우기" }).click();
  await page.getByRole("button", { name: "두 줄을 챙겨, 본편으로" }).click();
  const main = await state();
  await page.evaluate(() => {
    (
      window as unknown as { __frameEvidence: { enabled: boolean } }
    ).__frameEvidence.enabled = true;
  });
  if (main.deaths !== 0 || main.erasers !== 2 || main.instructions.length !== 2)
    throw new Error("Tutorial carry/reset invalid");
  await go();
  await dead();
  if ((await state()).lastEvent.observation !== "floorSpikes")
    throw new Error("Expected floor spikes lesson");
  await teach("구덩이나 바닥 가시가 있으면 뛰어");
  await dead();
  if ((await state()).lastEvent.observation !== "lowCeiling")
    throw new Error("Expected duck lesson");
  await teach("천장 가시가 있으면 숙여");
  await dead();
  if ((await state()).lastEvent.observation !== "pitCeilingPath")
    throw new Error("Expected detour lesson");
  await writeFile(
    `artifacts/${label}-real-death-save.json`,
    (await page.evaluate(() =>
      localStorage.getItem("one-line-per-death:save"),
    ))!,
  );
  await teach("샛길이 있으면 우회해");
  await expect(
    page.getByRole("button", { name: "우리의 모험 공유하기" }),
  ).toBeVisible({ timeout: 120000 });
  const won = await state();
  const gameplayFrames = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __frameEvidence: {
          enabled: boolean;
          count: number;
          total: number;
          slow: number;
          max: number;
        };
      }
    ).__frameEvidence;
    s.enabled = false;
    return {
      fps: Math.round((1000 * s.count) / s.total),
      frames: s.count,
      slowFrames: s.slow,
      maxIntervalMs: Math.round(s.max),
    };
  });
  const audioEvidence = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __audioEvidence: { starts: number; contexts: AudioContext[] };
      }
    ).__audioEvidence;
    return { starts: d.starts, states: d.contexts.map((c) => c.state) };
  });
  if (audioEvidence.starts < 15 || !audioEvidence.states.includes("running"))
    throw new Error("Gameplay audio was not activated after gesture");
  await writeFile(
    `artifacts/${label}-real-clear-save.json`,
    (await page.evaluate(() =>
      localStorage.getItem("one-line-per-death:save"),
    ))!,
  );
  if (won.deaths !== 3 || won.penaltyDeaths !== 0 || won.phase !== "cleared")
    throw new Error("Representative score mismatch");
  await page.screenshot({
    path: `artifacts/${label}-desktop-clear.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "우리의 모험 공유하기" }).click();
  await expect(page.locator("pre")).toContainText("3데스");
  await expect(page.locator("pre")).not.toContainText("나의 메모장");
  await page.getByLabel("최종 메모장도 함께 공유").check();
  await expect(page.locator("pre")).toContainText("샛길이 있으면 우회해");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  await expect(
    page.getByRole("button", { name: "우리의 모험 공유하기" }),
  ).toBeVisible();
  // A second tab takes ownership; the first must stop instead of overwriting.
  const other = await context.newPage();
  await other.goto(base);
  await other.getByRole("button", { name: "설정", exact: true }).click();
  await other.getByLabel("배경음악·효과음 끄기").check();
  await expect(
    page.getByText("다른 탭에서 기록이 바뀌어 이 탭을 멈췄어요.", {
      exact: false,
    }),
  ).toBeVisible();
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `artifacts/${label}-mobile-clear.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile horizontal overflow");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const mp = await mobile.newPage();
  await mp.goto(base);
  await mp.screenshot({
    path: `artifacts/${label}-mobile-title.png`,
    fullPage: true,
  });
  await mp.getByRole("button", { name: "첫 번째 한 줄 남기기" }).click();
  await mp.locator("#instruction").fill("앞으로 전진해");
  await mp.screenshot({
    path: `artifacts/${label}-mobile-input.png`,
    fullPage: true,
  });
  await mp.locator("#instruction").dispatchEvent("compositionstart");
  await mp.locator("#instruction").press("Enter");
  await expect(
    mp.getByRole("button", { name: "읽고 있어요" }),
  ).not.toBeVisible();
  await mp.locator("#instruction").dispatchEvent("compositionend");
  await mp.getByRole("button", { name: "설정", exact: true }).click();
  await mp.getByRole("button", { name: "새 도전 시작", exact: true }).click();
  await mp.getByRole("button", { name: "새 도전 시작", exact: true }).click();
  if ((await state(mp)).instructions.length !== 0)
    throw new Error("New challenge did not reset");
  if (errors.length) throw new Error(errors.join("\n"));
  const result = {
    base,
    checkedAt: new Date().toISOString(),
    passed: true,
    frameStats,
    gameplayFrames,
    audioEvidence,
    actualAIRequests: calls,
    score: won.deaths + won.penaltyDeaths,
    events: won.events.length,
    checks: [
      "actual Jev tutorial and full 8-room clear",
      "refresh cost idempotence",
      "tutorial carry and costs reset",
      "default priority without manual reorder",
      "share opt-in preview",
      "clear save restore",
      "other-tab conflict pause",
      "390px mobile no overflow",
      "Korean composition Enter prevented",
      "new challenge reset",
      "pause freezes all canvas pixels",
      "practice substep survives refresh",
    ],
    errors,
  };
  await writeFile(
    `artifacts/${label}-browser-report.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  await page.screenshot({
    path: `artifacts/${label}-failure.png`,
    fullPage: true,
  });
  console.error("BROWSER CHECK FAILED", e);
  console.error("State:", await state());
  process.exitCode = 1;
} finally {
  await browser.close();
}
