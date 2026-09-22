import { mkdir, writeFile } from "node:fs/promises";
import { DUNGEON_VERSION, RULES_VERSION } from "../src/game/content";
import { ONBOARDING_STAGES, attemptOnboarding, createOnboardingProgress } from "../src/game/onboarding";
const texts = ["문으로 걸어가", "바닥이 끊기면 뛰어넘어", "낮은 천장에서는 숙여", "벽이 막으면 옆길로 돌아"];
const rows: unknown[] = [];
for (const [index, text] of texts.entries()) {
  const started = performance.now();
  const response = await fetch("http://localhost:5173/api/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, dungeonVersion: DUNGEON_VERSION, rulesVersion: RULES_VERSION }) });
  const value = await response.json();
  let pass = false;
  if (response.ok) {
    const progress = createOnboardingProgress("live-test");
    progress.currentStage = index;
    progress.completedStageIds = ONBOARDING_STAGES.slice(0, index).map((stage) => stage.id);
    pass = attemptOnboarding(progress, text, value.interpretation ?? value).attempt.succeeded;
  }
  const row = { scene: index + 1, text, status: response.status, pass, latencyMs: Math.round(performance.now() - started), response: value };
  rows.push(row); console.log(JSON.stringify(row));
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/legacy-onboarding-live.json", JSON.stringify(rows, null, 2));
