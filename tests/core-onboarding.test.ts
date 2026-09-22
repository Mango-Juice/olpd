import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STAGES,
  attachOnboardingHandoff,
  attemptOnboarding,
  chooseNarrative,
  createOnboardingProgress,
  isOnboardingComplete,
  loadOnboardingProgress,
  progressBelongsToRun,
  writeOnboardingProgress,
} from "../src/game/onboarding";
import type {
  Action,
  Interpretation,
  ObservationId,
} from "../src/game/types";

function interpretation(
  action: Action,
  appliesTo: ObservationId[],
): Interpretation {
  return {
    action,
    appliesTo,
    uncertainty: 0,
    model: "fixture",
    rulesVersion: "1",
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

describe("chapter 1 formal onboarding", () => {
  it("keeps narrative skip separate from the four required physical stages", () => {
    const initial = createOnboardingProgress("run-intro");
    const skipped = chooseNarrative(initial, "skipped");

    expect(skipped.narrative).toBe("skipped");
    expect(skipped.currentStage).toBe(0);
    expect(skipped.completedStageIds).toEqual([]);
    expect(isOnboardingComplete(skipped)).toBe(false);
  });

  it("uses interpretation applicability and physical action instead of matching text", () => {
    const initial = chooseNarrative(
      createOnboardingProgress("run-intro"),
      "read",
    );
    const synonym = attemptOnboarding(
      initial,
      "저 문턱까지 천천히 다가가 줘",
      interpretation("advance", ["clear"]),
    );
    expect(synonym.attempt).toMatchObject({
      action: "advance",
      applied: true,
      succeeded: true,
    });
    expect(synonym.progress.currentStage).toBe(1);

    const wrongCondition = attemptOnboarding(
      synonym.progress,
      "낮은 천장이 보이면 몸을 낮춰",
      interpretation("duck", ["lowCeiling"]),
    );
    expect(wrongCondition.attempt).toMatchObject({
      action: "duck",
      applied: false,
      succeeded: false,
    });
    expect(wrongCondition.progress.currentStage).toBe(1);
    expect(wrongCondition.message).toContain("안전하게 기다렸어요");
  });

  it("preserves the legacy flat-ground physics for matching jump and duck actions", () => {
    const initial = createOnboardingProgress("run-intro");
    const jumped = attemptOnboarding(
      initial,
      "평평한 길에서는 가볍게 뛰며 문으로 가",
      interpretation("jump", ["clear"]),
    );
    const ducked = attemptOnboarding(
      initial,
      "평평한 길에서는 몸을 낮추고 문으로 가",
      interpretation("duck", ["clear"]),
    );
    const detoured = attemptOnboarding(
      initial,
      "평평한 길에서도 돌아가",
      interpretation("detour", ["clear"]),
    );

    expect(jumped.attempt.succeeded).toBe(true);
    expect(ducked.attempt.succeeded).toBe(true);
    expect(detoured.attempt.succeeded).toBe(false);
  });

  it("records every raw attempt and completes only after all four goals", () => {
    let progress = createOnboardingProgress("run-intro");
    const attempts: Array<[string, Interpretation]> = [
      ["문으로 걸어가", interpretation("advance", ["clear"])],
      ["틈을 그냥 걸어", interpretation("advance", ["bridge"])],
      ["끊긴 곳은 뛰어넘어", interpretation("jump", ["bridge"])],
      ["낮은 아치에서는 숙여", interpretation("duck", ["lowCeiling"])],
      [
        "정면이 막히고 옆길이 있으면 돌아가",
        interpretation("detour", ["pitCeilingPath", "spikesCeilingPath"]),
      ],
    ];

    for (const [text, value] of attempts) {
      progress = attemptOnboarding(progress, text, value).progress;
    }

    expect(isOnboardingComplete(progress)).toBe(true);
    expect(progress.completedStageIds).toEqual(
      ONBOARDING_STAGES.map((stage) => stage.id),
    );
    expect(progress.attempts.map((attempt) => attempt.text)).toEqual(
      attempts.map(([text]) => text),
    );
    expect(progress.attempts[1].succeeded).toBe(false);
    expect(progress.attempts[2].succeeded).toBe(true);
  });

  it("stores onboarding separately and binds the eventual main run without fake history", () => {
    const storage = memoryStorage();
    let progress = createOnboardingProgress("run-intro");
    for (const [action, appliesTo] of [
      ["advance", ["clear"]],
      ["jump", ["bridge"]],
      ["duck", ["lowCeiling"]],
      ["detour", ["pitCeilingPath"]],
    ] as const) {
      progress = attemptOnboarding(
        progress,
        `원문 ${action}`,
        interpretation(action, [...appliesTo]),
      ).progress;
    }
    const handedOff = attachOnboardingHandoff(progress, "run-main");

    expect(writeOnboardingProgress(handedOff, storage)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(loadOnboardingProgress(storage)).toEqual(handedOff);
    expect(progressBelongsToRun(handedOff, "run-intro")).toBe(true);
    expect(progressBelongsToRun(handedOff, "run-main")).toBe(true);
    expect(progressBelongsToRun(handedOff, "old-main")).toBe(false);
    expect(storage.values.has(ONBOARDING_STORAGE_KEY)).toBe(true);
  });

  it("keeps damaged onboarding data inert so an unrelated legacy save can be exempt", () => {
    const storage = memoryStorage();
    storage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ version: 1, ownerRunId: "old", currentStage: 99 }),
    );
    expect(loadOnboardingProgress(storage)).toBeNull();
    expect(progressBelongsToRun(null, "existing-main")).toBe(false);
  });
});
