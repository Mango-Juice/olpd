import { describe, expect, it } from "vitest";
import { STAGES } from "../src/campaign/catalog";
import { resolveStage } from "../src/campaign/registry";
import { allStageSegments } from "../src/campaign/level";
import { parseWorldState } from "../src/campaign/run-validation";
import { createCampaignRun } from "../src/campaign/run";
import { campaignAuthority } from "../src/campaign/authority";
import { resolveProgramBindings } from "../src/campaign/bindings";
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
      expect(stage.contentRevision).toBe("shared-v1");
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
          if (entity.properties.equipment !== true) expect(entity.publicKind, `${scene.id}/${entity.id}`).toMatch(/^[a-z][a-z0-9-]*$/);
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

  it("authors a visible default approach without solving any scene for free", () => {
    for (const summary of STAGES.slice(1)) {
      const stage = resolveStage(summary.id)!;
      for (const scene of stage.segments) {
        const initial = scene.enter(null);
        expect(scene.complete(initial), scene.id).toBe(false);
        const action = scene.idleAction?.(initial) ?? null;
        if (!action) continue;
        expect(action).toMatchObject({ kind: "action", actor: "hero", verb: "move" });
        expect(initial.visible).toContain(action.target);
        const result = (scene.execute ?? (() => { throw new Error(`missing executor ${scene.id}`); }))(initial, action);
        expect(scene.complete(result.world), `${scene.id}: ${result.reason}`).toBe(false);
      }
    }
  });

  it("rebinds a stage rule by authored public nouns instead of hidden simulation kinds", () => {
    const stage = resolveStage(2)!;
    const first = stage.segments[0].enter(null);
    const second = stage.segments[1].enter(null);
    const program = {
      version: 2 as const,
      id: "portable-box",
      text: "상자를 옮겨",
      model: "fixture",
      scope: { stageId: 2 as const },
      bindings: {
        "02-v2-1-box": { kind: "public-kind" as const, value: first.entities["02-v2-1-box"].publicKind! },
      },
      guard: false,
      body: { kind: "action" as const, actor: "hero" as const, verb: "push" as const, target: "02-v2-1-box" },
    };
    second.entities["02-v2-2-box"].properties.kind = "hidden-different-value";
    const rebound = resolveProgramBindings(second, program);
    expect(rebound.kind).toBe("resolved");
    if (rebound.kind !== "resolved" || rebound.program.body.kind !== "action") throw new Error("portable fixture did not resolve");
    expect(rebound.program.body.target).toBe("02-v2-2-box");
    expect(second.entities["02-v2-2-window"].publicKind).toBe("window");
  });
});
