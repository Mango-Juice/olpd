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
  it("ships 66 compact scenes with revised IDs and valid fresh saves", () => {
    let total = ONBOARDING_STAGES.length + ROOMS.length;
    const authority = campaignAuthority(resolveStage);
    for (const summary of STAGES.slice(1)) {
      const stage = resolveStage(summary.id)!;
      expect(stage, summary.title).not.toBeNull();
      expect(stage.segments).toHaveLength(summary.coreSegments);
      expect(stage.onboarding ?? []).toHaveLength(summary.onboardingSegments);
      expect(stage.contentRevision).toBe("quiet-v1");
      const scenes = allStageSegments(stage);
      total += scenes.length;
      expect(scenes).toHaveLength(summary.segments);
      expect(new Set(scenes.map((scene) => scene.id)).size).toBe(scenes.length);
      expect(stage.segments.map((scene) => scene.id)).toEqual(Array.from({ length: summary.coreSegments }, (_, index) => `${String(stage.id).padStart(2, "0")}-v2-${index + 1}`));
      const run = createCampaignRun(`content-contract-${stage.id}`, stage);
      expect(authority.parse({ kind: "world", run }), `fresh ${stage.id}`).not.toBeNull();
      for (const scene of [...scenes, stage.practice]) {
        expect(parseWorldState(scene.enter(null)), scene.id).not.toBeNull();
        const initial = scene.enter(null);
        const objects = initial.visible.filter((id) => initial.entities[id]?.properties.equipment !== true);
        expect(objects.length, scene.id).toBeLessThanOrEqual(4);
        expect(scene.scene?.floors.length, scene.id).toBeGreaterThan(0);
        expect(scene.goal.length, scene.id).toBeLessThanOrEqual(65);
        for (const id of objects) {
          const object = initial.entities[id];
          expect(object.location.x, `${scene.id}/${id}`).toBeGreaterThanOrEqual(0);
          expect(object.location.x, `${scene.id}/${id}`).toBeLessThanOrEqual(10);
          expect(object.location.y, `${scene.id}/${id}`).toBeGreaterThanOrEqual(0);
          expect(object.location.y, `${scene.id}/${id}`).toBeLessThanOrEqual(4);
        }
        for (const entity of Object.values(initial.entities)) {
          for (const key of Object.keys(entity.properties)) {
            if (key.startsWith("_")) expect(propertyVisibility(key), `${scene.id}/${entity.id}/${key}`).not.toBe("shown");
          }
        }
      }
    }
    expect(total).toBe(66);
  });
  it("keeps the ending recipient private until the delivery presentation", () => {
    expect(propertyVisibility("recipient")).toBe("hidden");
  });
});
