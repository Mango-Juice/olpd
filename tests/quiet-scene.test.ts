import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld, type CampaignStageDefinition } from "../src/campaign/level";
import { QUIET_FORGE_STAGE, QUIET_KITCHEN_STAGE, QUIET_RAIN_STAGE } from "./fixtures/quiet-worlds/early";
import { QUIET_FOG_STAGE, QUIET_TOWER_STAGE, QUIET_WARDEN_STAGE } from "./fixtures/quiet-worlds/late";
import { QUIET_GARDEN_STAGE, QUIET_STOREHOUSE_STAGE, QUIET_THEATRE_STAGE } from "./fixtures/quiet-worlds/middle";
import { CampaignCanvas } from "../src/components/CampaignCanvas";
import {
  CAMPAIGN_VIEW_HEIGHT,
  CAMPAIGN_VIEW_WIDTH,
  campaignSceneWidth,
  campaignUnsupportedKinds,
  layoutCampaignActors,
  layoutCampaignEntities,
} from "../src/render/campaign-scene";

const stages: readonly CampaignStageDefinition[] = [
  QUIET_RAIN_STAGE,
  QUIET_KITCHEN_STAGE,
  QUIET_FORGE_STAGE,
  QUIET_GARDEN_STAGE,
  QUIET_STOREHOUSE_STAGE,
  QUIET_THEATRE_STAGE,
  QUIET_FOG_STAGE,
  QUIET_TOWER_STAGE,
  QUIET_WARDEN_STAGE,
];

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

describe("quiet authored campaign scenes", () => {
  it("keeps all 54 authored scenes in one fixed 960 by 500 view", () => {
    expect(stages.flatMap((stage) => stage.segments)).toHaveLength(54);
    for (const stage of stages) for (const segment of stage.segments) {
      const world = segment.enter(null);
      expect(campaignSceneWidth(world, segment.scene), segment.id).toBe(960);
      expect(segment.scene, segment.id).toBeDefined();
      for (const floor of segment.scene?.floors ?? []) {
        expect(floor.from, segment.id).toBeGreaterThanOrEqual(0);
        expect(floor.to, segment.id).toBeLessThanOrEqual(10);
        expect(floor.y, segment.id).toBeGreaterThanOrEqual(0);
        expect(floor.y, segment.id).toBeLessThanOrEqual(4);
      }
    }
    expect(CAMPAIGN_VIEW_WIDTH).toBe(960);
    expect(CAMPAIGN_VIEW_HEIGHT).toBe(500);
  });

  it("projects authored physical coordinates directly and keeps every label legible", () => {
    for (const stage of stages) for (const segment of stage.segments) {
      const world = segment.enter(null);
      const layouts = layoutCampaignEntities(world, segment.scene);
      const actors = layoutCampaignActors(world, segment.scene);
      const expectedIds = [...new Set(world.visible)].filter((id) =>
        world.entities[id] && world.entities[id].properties.equipment !== true);
      expect(layouts.map((layout) => layout.id), segment.id).toEqual(expectedIds);

      for (const layout of layouts) {
        expect(layout.anchorX, `${segment.id}/${layout.id}`).toBeCloseTo(80 + 80 * layout.entity.location.x, 5);
        expect(layout.anchorY, `${segment.id}/${layout.id}`).toBeCloseTo(400 - 65 * layout.entity.location.y, 5);
        const label = layout.labelBounds;
        expect(label.x, `${segment.id}/${layout.id}`).toBeGreaterThanOrEqual(0);
        expect(label.x + label.width, `${segment.id}/${layout.id}`).toBeLessThanOrEqual(960);
        expect(label.y, `${segment.id}/${layout.id}`).toBeGreaterThanOrEqual(0);
        expect(label.y + label.height, `${segment.id}/${layout.id}`).toBeLessThanOrEqual(500);
        for (const actor of actors) {
          expect(actor.x >= label.x && actor.x <= label.x + label.width
            && actor.y >= label.y && actor.y <= label.y + label.height, `${segment.id}/${layout.id}/${actor.id}`).toBe(false);
        }
      }
      for (let left = 0; left < layouts.length; left++) {
        for (let right = left + 1; right < layouts.length; right++) {
          expect(overlaps(layouts[left].labelBounds, layouts[right].labelBounds),
            `${segment.id}/${layouts[left].id}/${layouts[right].id}`).toBe(false);
        }
      }
    }
  });

  it("enlarges mobile labels without changing terrain coordinates, clipping, or collisions", () => {
    for (const stage of stages) for (const segment of stage.segments) {
      const world = segment.enter(null);
      const desktop = layoutCampaignEntities(world, segment.scene, 1);
      const mobile = layoutCampaignEntities(world, segment.scene, 2.3);
      expect(mobile.map(({ anchorX, anchorY }) => ({ anchorX, anchorY })), segment.id)
        .toEqual(desktop.map(({ anchorX, anchorY }) => ({ anchorX, anchorY })));
      for (const layout of mobile) {
        expect(layout.labelScale, `${segment.id}/${layout.id}`).toBe(2.3);
        expect(layout.labelBounds.width, `${segment.id}/${layout.id}`).toBeCloseTo(116 * 2.3, 5);
        expect(layout.labelBounds.x, `${segment.id}/${layout.id}`).toBeGreaterThanOrEqual(0);
        expect(layout.labelBounds.x + layout.labelBounds.width, `${segment.id}/${layout.id}`).toBeLessThanOrEqual(960);
        expect(layout.labelBounds.y, `${segment.id}/${layout.id}`).toBeGreaterThanOrEqual(0);
        expect(layout.labelBounds.y + layout.labelBounds.height, `${segment.id}/${layout.id}`).toBeLessThanOrEqual(500);
      }
      for (let left = 0; left < mobile.length; left++) {
        for (let right = left + 1; right < mobile.length; right++) {
          expect(overlaps(mobile[left].labelBounds, mobile[right].labelBounds),
            `${segment.id}/${mobile[left].id}/${mobile[right].id}`).toBe(false);
        }
      }
    }
  });

  it("has explicit art semantics for every quiet scene object", () => {
    for (const stage of stages) for (const segment of stage.segments) {
      expect(campaignUnsupportedKinds(segment.enter(null)), segment.id).toEqual([]);
    }
  });

  it("fits an old scene with extreme coordinates without widening the canvas", () => {
    const world = makeWorld(2, "old-save", [
      makeEntity("far-left", "왼쪽 장치", "old-save", -100),
      makeEntity("far-right", "오른쪽 장치", "old-save", 500),
      makeEntity("high", "높은 장치", "old-save", 50, { location: { region: "old-save", x: 50, y: 99 } }),
    ]);
    const layouts = layoutCampaignEntities(world);
    expect(campaignSceneWidth(world)).toBe(960);
    for (const layout of layouts) {
      expect(layout.x).toBeGreaterThanOrEqual(0);
      expect(layout.x).toBeLessThanOrEqual(960);
      expect(layout.y).toBeGreaterThanOrEqual(0);
      expect(layout.y).toBeLessThanOrEqual(500);
    }
  });

  it("renders only names in the accessible picker and never prints object internals", () => {
    const world = makeWorld(2, "quiet-ui", [
      makeEntity("door", "짧은 문", "quiet-ui", 6, {
        description: "화면에 나오면 안 되는 긴 설명",
        properties: { kind: "door", open: false, capacity: 77, reach: 88, hiddenBoolean: true },
      }),
    ]);
    const html = renderToStaticMarkup(createElement(CampaignCanvas, {
      world,
      scene: { floors: [{ from: 0, to: 10, y: 0 }] },
      title: "고요한 방",
      reducedMotion: true,
      paused: true,
      selectedEntityId: "door",
      onSelectEntity: () => undefined,
    }));
    expect(html).toContain('data-scene-width="960"');
    expect(html).toContain("짧은 문 선택됨");
    expect(html).not.toContain("화면에 나오면 안 되는 긴 설명");
    expect(html).not.toContain("capacity");
    expect(html).not.toContain("reach");
    expect(html).not.toContain("hiddenBoolean");
    expect(html).not.toContain("campaign-entity-facts");
    expect(html).not.toContain("campaign-map-navigation");
    expect(html).not.toContain("campaign-scene-observation");
  });
});
