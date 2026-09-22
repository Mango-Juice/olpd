import { describe, expect, it } from "vitest";
import { STAGES } from "../src/campaign/catalog";
import { resolveStage } from "../src/campaign/registry";
import { allStageSegments } from "../src/campaign/level";
import { parseWorldState } from "../src/campaign/run-validation";
import { createCampaignRun } from "../src/campaign/run";
import { campaignAuthority } from "../src/campaign/authority";
import { propertyVisibility } from "../src/campaign/presentation";
import { ONBOARDING_STAGES } from "../src/game/onboarding";
import { ROOMS } from "../src/game/content";

describe("implemented document content contract", () => {
  it("ships all 80 scenes with stable core IDs and valid fresh saves", () => {
    let total = ONBOARDING_STAGES.length + ROOMS.length;
    const authority = campaignAuthority(resolveStage);
    for (const summary of STAGES.slice(1)) {
      const stage = resolveStage(summary.id)!;
      expect(stage, summary.title).not.toBeNull();
      expect(stage.segments).toHaveLength(summary.coreSegments);
      expect(stage.onboarding).toHaveLength(summary.onboardingSegments);
      const scenes = allStageSegments(stage);
      total += scenes.length;
      expect(scenes).toHaveLength(summary.segments);
      expect(new Set(scenes.map((scene) => scene.id)).size).toBe(scenes.length);
      expect(stage.segments.map((scene) => scene.id)).toEqual(Array.from({ length: summary.coreSegments }, (_, index) => `${String(stage.id).padStart(2, "0")}-${index + 1}`));
      const run = createCampaignRun(`content-contract-${stage.id}`, stage);
      expect(authority.parse({ kind: "world", run }), `fresh ${stage.id}`).not.toBeNull();
      for (const scene of [...scenes, stage.practice]) {
        expect(parseWorldState(scene.enter(null)), scene.id).not.toBeNull();
        for (const entity of Object.values(scene.enter(null).entities)) {
          for (const key of Object.keys(entity.properties)) {
            expect(propertyVisibility(key), `${scene.id}/${entity.id}/${key}`).not.toBe("unknown");
          }
        }
      }
    }
    expect(total).toBe(80);
  });
  it("keeps the ending recipient private until the delivery presentation", () => {
    expect(propertyVisibility("recipient")).toBe("hidden");
  });
});
