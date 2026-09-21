import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createFirstForkDeathSave } from "./browser-fixtures";

const base = process.env.APP_URL ?? "http://localhost:5173";
await mkdir("artifacts", { recursive: true });
const originalSave = createFirstForkDeathSave("browser-drag");
const fixture = JSON.stringify(originalSave);
const original = originalSave.state;
const saveKey = "one-line-per-death:save";

type Run = {
  instructions: Array<{ id: string; text: string }>;
  deaths: number;
  penaltyDeaths: number;
  erasers: number;
  canWrite: boolean;
  events: unknown[];
  revision: number;
};

const state = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state as Run,
    saveKey,
  );

async function installAndOpen(page: Page) {
  console.log("drag-check: install", await page.viewportSize());
  await page.goto(base);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: saveKey,
    raw: fixture,
  });
  await page.reload();
  await page.getByRole("button", { name: "모험 이어하기" }).click();
  console.log("drag-check: continued", await page.locator("summary").count());
  const notebook = page.locator("details.notebook");
  if (!(await notebook.evaluate((element) => element.hasAttribute("open"))))
    await page.locator("summary").click();
  await expect(page.locator(".instruction")).toHaveCount(4);
}

function unchangedCost(before: Run, after: Run) {
  expect(after.deaths).toBe(before.deaths);
  expect(after.penaltyDeaths).toBe(before.penaltyDeaths);
  expect(after.erasers).toBe(before.erasers);
  expect(after.canWrite).toBe(before.canWrite);
  expect(after.events).toEqual(before.events);
}

async function checkControls(page: Page) {
  await expect(page.locator(".erase-button")).toHaveCount(4);
  await expect(page.locator(".priority-controls")).toHaveCount(0);
  await expect(page.locator(".memory-tools .erase-button")).toHaveCount(0);
  const edges = await page
    .locator(".memory-actions")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
  console.log("drag-check: action-right-edges", edges);
  const actionAlignmentDelta = Math.max(...edges) - Math.min(...edges);
  expect(actionAlignmentDelta).toBeLessThan(1);
  const menuEdges = await page
    .locator(".memory-menu-toggle")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
  const menuAlignmentDelta = Math.max(...menuEdges) - Math.min(...menuEdges);
  expect(menuAlignmentDelta).toBeLessThan(1);
  return { actionAlignmentDelta, menuAlignmentDelta };
}

async function checkOnlySelectedMenu(page: Page, text: string) {
  await page.getByRole("button", { name: `${text} 메모 관리` }).click();
  await expect(page.locator(".priority-controls")).toHaveCount(1);
  await expect(page.locator(".memory-tools .erase-button")).toHaveCount(0);
  const expanded = await page
    .locator(".memory-menu-toggle")
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => node.getAttribute("aria-expanded") === "true")
          .length,
    );
  expect(expanded).toBe(1);
}

const browser = await chromium.launch();
const errors: string[] = [];
const report: Record<string, unknown> = { base, passed: false, errors };

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const desktop = await desktopContext.newPage();
  desktop.on("pageerror", (error) => errors.push(`desktop: ${error.message}`));
  await installAndOpen(desktop);
  const desktopControls = await checkControls(desktop);
  await checkOnlySelectedMenu(desktop, "앞으로 전진해");
  // Close the menu so the drag starts from the fully initial notebook state.
  await desktop
    .getByRole("button", { name: "앞으로 전진해 메모 관리" })
    .click();

  const beforeDesktop = await state(desktop);
  const source = desktop
    .locator(".instruction")
    .last()
    .locator(".memory-drag-handle");
  const target = desktop.locator(".instruction").first();
  // Native HTML5 DnD: start on the bottom handle and drop in the top row's upper half.
  await source.dragTo(target, { targetPosition: { x: 10, y: 3 } });
  await expect(desktop.locator(".instruction").first()).toContainText(
    "앞으로 전진해",
  );
  const afterDesktop = await state(desktop);
  expect(afterDesktop.instructions.at(-1)!.id).toBe(
    original.instructions[0].id,
  );
  expect(afterDesktop.revision).toBe(beforeDesktop.revision + 1);
  unchangedCost(beforeDesktop, afterDesktop);

  await desktop.reload();
  await desktop.getByRole("button", { name: "모험 이어하기" }).click();
  if (
    !(await desktop
      .locator("details.notebook")
      .evaluate((element) => element.hasAttribute("open")))
  )
    await desktop.locator("summary").click();
  expect((await state(desktop)).instructions).toEqual(
    afterDesktop.instructions,
  );
  await desktop.screenshot({
    path: "artifacts/drag-desktop.png",
    fullPage: true,
  });

  await checkOnlySelectedMenu(desktop, "앞으로 전진해");
  for (let i = 0; i < 3; i++) {
    await desktop
      .getByRole("button", { name: "앞으로 전진해 우선순위 낮추기" })
      .click();
  }
  const undone = await state(desktop);
  expect(undone.instructions.map((item) => item.id)).toEqual(
    original.instructions.map((item: { id: string }) => item.id),
  );
  expect(undone.revision).toBe(afterDesktop.revision + 3);
  unchangedCost(beforeDesktop, undone);
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
  await installAndOpen(mobile);
  const mobileControls = await checkControls(mobile);
  const beforeMobile = await state(mobile);
  const mobileSource = mobile
    .locator(".instruction")
    .last()
    .locator(".memory-drag-handle");
  const mobileTarget = mobile.locator(".instruction").first();
  await mobileSource.scrollIntoViewIfNeeded();
  const sourceBox = await mobileSource.boundingBox();
  const targetBox = await mobileTarget.boundingBox();
  if (!sourceBox || !targetBox)
    throw new Error("Touch drag targets have no box");
  const viewport = await mobile.viewportSize();
  if (
    !viewport ||
    [sourceBox, targetBox].some(
      (box) => box.y < 0 || box.y + box.height > viewport.height,
    )
  )
    throw new Error("Touch drag target is outside the mobile viewport");
  const cdp = await mobile.context().newCDPSession(mobile);
  const touch = (x: number, y: number) => ({
    id: 1,
    x,
    y,
    radiusX: 2,
    radiusY: 2,
    force: 1,
  });
  const start = touch(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  const overTop = touch(targetBox.x + 12, targetBox.y + 3);
  // CDP touch input establishes the app's pointer capture; no synthetic PointerEvent is used.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [overTop],
  });
  await expect(mobileTarget).toHaveAttribute("data-drop-position", "before");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(mobile.locator(".instruction").first()).toContainText(
    "앞으로 전진해",
  );
  const afterMobile = await state(mobile);
  expect(afterMobile.instructions.at(-1)!.id).toBe(original.instructions[0].id);
  expect(afterMobile.revision).toBe(beforeMobile.revision + 1);
  unchangedCost(beforeMobile, afterMobile);
  await mobile.screenshot({
    path: "artifacts/drag-mobile.png",
    fullPage: true,
  });
  await mobileContext.close();

  expect(errors).toEqual([]);
  Object.assign(report, {
    passed: true,
    checks: [
      "four always-visible erase buttons and aligned controls",
      "menu initially hides priority controls and opens only selected arrows",
      "native desktop handle drag moves bottom memo before first, persists, and adds one revision",
      "menu down arrows restore original order without changing costs or events",
      "CDP touch drag establishes capture, exposes before drop target, moves actual order, and adds one revision",
    ],
    desktop: {
      revisionAfterDrag: afterDesktop.revision,
      revisionAfterUndo: undone.revision,
    },
    mobile: { revisionAfterDrag: afterMobile.revision },
    alignment: { desktop: desktopControls, mobile: mobileControls },
  });
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile(
    "artifacts/drag-report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
