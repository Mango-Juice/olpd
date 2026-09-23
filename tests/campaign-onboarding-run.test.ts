import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld, stillWorld, type CampaignStageDefinition, type SegmentDefinition } from "../src/campaign/level";
import { createCampaignRun } from "../src/campaign/run";

function segment(id: string): SegmentDefinition {
  return {
    id,
    title: id,
    goal: "목표 확인",
    description: id,
    hints: ["하나", "둘", "셋"],
    enter: () => makeWorld(2, id, [makeEntity("goal", "목표", id, 0)]),
    advance: stillWorld,
    complete: () => false,
  };
}

const stage: CampaignStageDefinition = {
  id: 2,
  title: "shared fixture",
  contentRevision: "shared-v1",
  // A stale authored onboarding list must not replace the shared chapter entrance.
  onboarding: [segment("02-intro")],
  segments: [segment("02-1"), segment("02-2")],
  practice: segment("02-practice"),
  story: { afterSegment: "02-1", object: "goal", text: "" },
};

describe("shared chapter entry", () => {
  it("starts at the first core segment with one real writing opportunity", () => {
    const run = createCampaignRun("shared", stage);
    expect(run).toMatchObject({
      version: 3,
      contentRevision: "shared-v1",
      phase: "bookmark",
      world: { segmentId: "02-1" },
      checkpoint: { segmentId: "02-1" },
      notebook: { canWrite: true, deaths: 0, penaltyDeaths: 0, erasers: 2 },
      history: { version: 1, entries: [] },
      presentationHistory: [],
    });
    expect(run.notebook.instructions).toEqual([]);
    expect("learning" in run).toBe(false);
    expect("sceneNotes" in run).toBe(false);
  });
});
