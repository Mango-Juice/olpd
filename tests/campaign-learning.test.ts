import { describe, expect, it } from "vitest";
import { campaignLearningNote } from "../src/campaign/learning";
import { createStageRun } from "../src/campaign/run";
import { RAIN_INTRO } from "../src/campaign/stages/rain";
import type { WorldEvent } from "../src/campaign/types";

function actionEvent(patch: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: "event-1",
    segmentId: "02-1",
    tick: 1,
    attempt: 1,
    instructionId: "note-1",
    actor: "hero",
    target: "rain-cork",
    outcome: "safe",
    reason: "상자를 밀었어요.",
    changes: [],
    ...patch,
  };
}

describe("campaign progressive learning note", () => {
  it("starts with one stage concept and advances only after an actual local action", () => {
    const initial = createStageRun("learning", RAIN_INTRO.enter(null));
    expect(campaignLearningNote(initial)).toContain("무엇이 움직이거나 물에 뜰 수 있는지");

    const withAction = { ...initial, events: [actionEvent()] };
    expect(campaignLearningNote(withAction)).toContain("첫 움직임 뒤에는");
    expect(campaignLearningNote(withAction)).not.toContain("상자를 밀었어요");
  });

  it("ignores non-actions and events from an earlier attempt or segment", () => {
    const initial = createStageRun("learning", RAIN_INTRO.enter(null));
    const events = [
      actionEvent({ outcome: "interrupted", actor: null, target: null }),
      actionEvent({ id: "clarification", outcome: "clarification" }),
      actionEvent({ id: "blocked", outcome: "blocked" }),
      actionEvent({ id: "old-attempt", attempt: 0 }),
      actionEvent({ id: "old-segment", segmentId: "02-practice" }),
    ];
    expect(campaignLearningNote({ ...initial, events })).toBe(campaignLearningNote(initial));
  });
});
