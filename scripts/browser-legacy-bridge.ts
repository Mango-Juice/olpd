import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { newRun, skipTutorial } from "../src/game/core";
import { makeSave, STORAGE_KEY } from "../src/game/storage";
import type { RunState, SaveData } from "../src/game/types";

const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
await mkdir("artifacts", { recursive: true });

type Evidence = {
  saves: SaveData[];
  pending: number;
  roadmap: number;
  cleared: number;
};

function html(initial: SaveData | null) {
  const serialized = JSON.stringify(initial).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module">
    import React from "/node_modules/.vite/deps/react.js";
    import ReactDOMClient from "/node_modules/.vite/deps/react-dom_client.js";
    import RefreshRuntime from "/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: App } = await import("/src/App.tsx");
    const evidence = { saves: [], pending: [], roadmap: 0, cleared: 0 };
    window.__bridgeEvidence = evidence;
    window.__bridgeResolve = (result) => {
      const resolve = evidence.pending.shift();
      if (!resolve) throw new Error("No bridge save is pending");
      resolve(result);
    };
    const bridge = {
      initial: ${serialized},
      save(data) {
        evidence.saves.push(structuredClone(data));
        return new Promise((resolve) => evidence.pending.push(resolve));
      },
      onRoadmap() { evidence.roadmap++; },
      onClearedPresentation() { evidence.cleared++; },
    };
    ReactDOMClient.createRoot(document.getElementById("root")).render(React.createElement(App, { bridge }));
  </script></body></html>`;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript((key) => {
  localStorage.setItem(key, "legacy-sentinel");
}, STORAGE_KEY);
const errors: string[] = [];
const checks: string[] = [];

async function open(initial: SaveData | null, name: string) {
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    // The intercepted HTML harness has no Vite HMR socket; application errors still fail.
    if (error.message === "WebSocket closed without opened.") return;
    errors.push(`${name}: ${error.message}`);
  });
  await page.route("**/bridge-harness*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html(initial) }),
  );
  await page.goto(`${base}/bridge-harness?case=${name}`);
  await page.waitForLoadState("networkidle");
  if ((await page.getByRole("button", { name: "여정 지도" }).count()) === 0)
    throw new Error(
      `Bridge harness did not mount: ${errors.join(" | ")} :: ${await page.locator("body").innerText()}`,
    );
  await expect(page.getByRole("button", { name: "여정 지도" })).toBeVisible();
  return page;
}

const evidence = (page: Page) =>
  page.evaluate(() => {
    const value = (
      window as unknown as {
        __bridgeEvidence: {
          saves: SaveData[];
          pending: unknown[];
          roadmap: number;
          cleared: number;
                };
      }
    ).__bridgeEvidence;
    return {
      saves: value.saves,
      pending: value.pending.length,
      roadmap: value.roadmap,
      cleared: value.cleared,
    } satisfies Evidence;
  });

const resolveSave = (
  page: Page,
  result:
    | { ok: true }
    | { ok: false; error: { code: string; message: string } },
) =>
  page.evaluate((value) => {
    (
      window as unknown as {
        __bridgeResolve: (result: typeof value) => void;
      }
    ).__bridgeResolve(value);
  }, result);

try {
  const success = await open(null, "success");
  await success.getByRole("button", { name: "첫 번째 한 줄 남기기" }).click();
  await expect.poll(async () => (await evidence(success)).pending).toBe(1);
  await expect(
    success.getByRole("button", { name: "첫 번째 한 줄 남기기" }),
  ).toBeVisible();
  await expect(success.locator("#instruction")).toHaveCount(0);
  await resolveSave(success, { ok: true });
  await expect(success.locator("#instruction")).toBeVisible();
  expect((await evidence(success)).saves[0].state.tutorial).toBe(true);
  expect(await success.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(
    "legacy-sentinel",
  );
  checks.push("bridge success updates UI only after the awaited primary save");
  await success.close();

  const failure = await open(null, "failure");
  await failure.getByRole("button", { name: "첫 번째 한 줄 남기기" }).click();
  await expect.poll(async () => (await evidence(failure)).pending).toBe(1);
  await resolveSave(failure, {
    ok: false,
    error: { code: "write", message: "fixture write failure" },
  });
  await expect(failure.getByRole("alert")).toContainText("자동 저장");
  await expect(
    failure.getByRole("button", { name: "첫 번째 한 줄 남기기" }),
  ).toBeVisible();
  await expect(failure.locator("#instruction")).toHaveCount(0);
  expect(await failure.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(
    "legacy-sentinel",
  );
  checks.push("failed bridge save leaves the authoritative and visible state unchanged");
  await failure.close();

  const conflict = await open(null, "conflict");
  await conflict.getByRole("button", { name: "첫 번째 한 줄 남기기" }).click();
  await expect.poll(async () => (await evidence(conflict)).pending).toBe(1);
  await resolveSave(conflict, {
    ok: false,
    error: { code: "conflict", message: "fixture conflict" },
  });
  await expect(
    conflict.getByRole("alert").filter({ hasText: "다른 탭" }),
  ).toBeVisible();
  await expect(
    conflict.getByRole("button", { name: "첫 번째 한 줄 남기기" }),
  ).toBeDisabled();
  checks.push("bridge conflict freezes the legacy UI without a local fallback write");
  await conflict.close();

  const main = skipTutorial(newRun(true));
  const mainSave = makeSave(main, {
    writer: "bridge-main",
    tutorialCompleted: true,
    settings: { muted: true, reducedMotion: true },
  });
  const serialized = await open(mainSave, "serialized");
  await serialized.getByRole("button", { name: "모험 이어하기" }).click();
  const launch = serialized.getByRole("button", { name: /^모험 출발/ });
  await expect(launch).toBeVisible();
  await launch.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(async () => (await evidence(serialized)).saves.length).toBe(1);
  expect((await evidence(serialized)).pending).toBe(1);
  await resolveSave(serialized, { ok: true });
  await expect.poll(async () => (await evidence(serialized)).saves.length).toBe(2);
  expect((await evidence(serialized)).pending).toBe(1);
  const revisions = (await evidence(serialized)).saves.map(
    (save) => save.state.revision,
  );
  expect(revisions).toEqual([main.revision + 1, main.revision + 2]);
  await resolveSave(serialized, { ok: true });
  await expect(
    serialized.getByRole("button", { name: "일시정지" }),
  ).toBeVisible();
  expect((await evidence(serialized)).saves).toHaveLength(2);
  checks.push("double launch serializes start and first judgment without duplicate steps");
  await serialized.close();

  const finalState: RunState = {
    ...newRun(false),
    phase: "running",
    room: 7,
    point: 5,
    canWrite: false,
    revision: 20,
    seen: ["7:clear:advance:default"],
  };
  const final = await open(
    makeSave(finalState, {
      writer: "bridge-final",
      tutorialCompleted: true,
      settings: { muted: true, reducedMotion: true },
    }),
    "final",
  );
  await final.getByRole("button", { name: "모험 이어하기" }).click();
  await expect.poll(async () => (await evidence(final)).pending).toBe(1);
  expect((await evidence(final)).cleared).toBe(0);
  await resolveSave(final, { ok: true });
  await expect.poll(async () => (await evidence(final)).cleared, {
    timeout: 4000,
  }).toBe(1);
  await expect(final.getByRole("button", { name: "우리의 모험 돌아보기" })).toHaveCount(0);
  await expect(final.getByRole("button", { name: "지난 모험 기록" })).toHaveCount(0);
  await final.getByRole("button", { name: "여정 지도" }).click();
  expect((await evidence(final)).roadmap).toBe(1);
  checks.push("clear handoff waits for final presentation; roadmap works without archive UI");
  await final.screenshot({
    path: `artifacts/${label}-legacy-bridge-clear.png`,
    fullPage: true,
  });
  expect(await final.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(
    "legacy-sentinel",
  );
  await final.close();

  expect(errors).toEqual([]);
  const report = {
    base,
    checkedAt: new Date().toISOString(),
    passed: true,
    checks,
    errors,
  };
  await writeFile(
    `artifacts/${label}-legacy-bridge-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
