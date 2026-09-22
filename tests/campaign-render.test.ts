import { describe, expect, it } from "vitest";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import { campaignEntitySignals, layoutCampaignEntities } from "../src/render/campaign-scene";

describe("campaign scene layout", () => {
  it("keeps previous causal devices out of the current scene without hiding reachable neighboring rooms", () => {
    const world = makeWorld(4, "04-2", [
      makeEntity("past", "지난 장치", "04-1", 1, { properties: { causeMapVisible: true } }),
      makeEntity("current", "현재 장치", "04-2", 2, { properties: { causeMapVisible: true } }),
      makeEntity("neighbor", "옆방 입구", "04-next", 3),
    ]);
    const before = structuredClone(world);
    expect(layoutCampaignEntities(world).map((item) => item.id)).toEqual(["current", "neighbor"]);
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

  it("keeps worn equipment on the actor instead of adding a floor target", () => {
    const world = makeWorld(2, "02-equipment", [
      makeEntity("box", "코르크 상자", "02-equipment", 0, { properties: { kind: "box" } }),
    ]);
    expect(world.visible).toContain("letter");
    expect(world.entities.letter.properties.equipment).toBe(true);
    expect(layoutCampaignEntities(world).map((layout) => layout.id)).toEqual(["box"]);
  });

  it("keeps every public anchor and drawn position finite across campaign chapters", () => {
    for (let stage = 2; stage <= 10; stage++) {
      const world = makeWorld(stage as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, `chapter-${stage}`, [
        makeEntity(`left-${stage}`, "왼쪽 장치", `chapter-${stage}`, -12, { location: { region: `chapter-${stage}`, x: -12, y: 0 } }),
        makeEntity(`high-${stage}`, "높은 장치", `chapter-${stage}`, 48, { location: { region: `chapter-${stage}`, x: 48, y: 6 } }),
      ]);
      for (const layout of layoutCampaignEntities(world)) {
        expect([layout.anchorX, layout.anchorY, layout.x, layout.y].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("exposes only declared visual state signals with stable progress and direction cues", () => {
    const lock = makeEntity("lock", "세 박자 잠금판", "signals", 0, {
      properties: {
        kind: "lock",
        open: false,
        locked: true,
        safeBeat: 2,
        requiredTurns: 3,
        flowDirection: "up",
      },
    });
    expect(campaignEntitySignals(lock)).toEqual([
      "open:false",
      "locked:true",
      "progress:2/3",
      "direction:up",
    ]);
    expect(campaignEntitySignals(makeEntity("plain", "표식 없는 돌", "signals", 1))).toEqual([]);
  });
});
