import { describe, expect, it } from "vitest";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import { layoutCampaignEntities } from "../src/render/campaign-scene";

describe("campaign scene layout", () => {
  it("keeps previous causal devices out of the current scene without hiding reachable neighboring rooms", () => {
    const world = makeWorld(4, "04-2", [
      makeEntity("past", "지난 장치", "04-1", 1, { properties: { causeMapVisible: true } }),
      makeEntity("current", "현재 장치", "04-2", 2, { properties: { causeMapVisible: true } }),
      makeEntity("neighbor", "옆방 입구", "04-next", 3),
    ]);
    const before = structuredClone(world);
    expect(layoutCampaignEntities(world).map((item) => item.id)).toEqual(["current", "neighbor", "letter"]);
    expect(world).toEqual(before);
  });
  it("maps physical x and height monotonically into the scene", () => {
    const world = makeWorld(
      2,
      "02-layout",
      [
        makeEntity("low-left", "왼쪽", "02-layout", 0),
        makeEntity("high-right", "오른쪽", "02-layout", 6, {
          location: { region: "02-layout", x: 6, y: 3 },
        }),
      ],
      makeHero("02-layout", 0),
    );
    const [left, right] = layoutCampaignEntities(world);
    expect(left.x).toBeLessThan(right.x);
    expect(right.y).toBeLessThan(left.y);
  });

  it("separates visible entities sharing a physical marker without moving its anchor", () => {
    const world = makeWorld(2, "02-layout", [
      makeEntity("tank", "수조", "02-layout", 1),
      makeEntity("bridge", "부교", "02-layout", 1),
      makeEntity("rope", "밧줄", "02-layout", 1),
    ]);
    const layouts = layoutCampaignEntities(world).filter((layout) => ["tank", "bridge", "rope"].includes(layout.id));
    expect(new Set(layouts.map((layout) => layout.anchorX)).size).toBe(1);
    expect(new Set(layouts.map((layout) => layout.x)).size).toBe(3);
  });

  it("renders only public visible entities and keeps their declared order", () => {
    const world = makeWorld(3, "03-layout", [
      makeEntity("oven", "낮은 오븐", "03-layout", 0),
      makeEntity("gear", "큰 기어", "03-layout", 2),
      makeEntity("hidden", "숨은 해답", "03-layout", 4),
    ]);
    world.visible = ["gear", "oven", "missing"];
    expect(layoutCampaignEntities(world).map((layout) => layout.id)).toEqual([
      "gear",
      "oven",
    ]);
  });
});
