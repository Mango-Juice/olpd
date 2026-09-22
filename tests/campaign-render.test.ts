import { describe, expect, it } from "vitest";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import {
  campaignEntitySignals,
  campaignSceneWidth,
  hitTestCampaignLayout,
  layoutCampaignActors,
  layoutCampaignEntities,
} from "../src/render/campaign-scene";

describe("campaign scene layout compatibility", () => {
  it("renders only current public entities in declared order", () => {
    const world = makeWorld(4, "current", [
      makeEntity("past", "지난 장치", "past", 1, { properties: { causeMapVisible: true } }),
      makeEntity("current", "현재 장치", "current", 2),
      makeEntity("neighbor", "옆방 입구", "neighbor", 3),
    ]);
    world.visible = ["neighbor", "past", "current", "letter"];
    expect(layoutCampaignEntities(world).map((item) => item.id)).toEqual(["neighbor", "current"]);
    expect(campaignSceneWidth(world)).toBe(960);
  });

  it("keeps worn equipment off the floor", () => {
    const world = makeWorld(2, "equipment", [
      makeEntity("box", "코르크 상자", "equipment", 2, { properties: { kind: "box" } }),
    ]);
    expect(world.entities.letter.properties.equipment).toBe(true);
    expect(layoutCampaignEntities(world).map((layout) => layout.id)).toEqual(["box"]);
  });

  it("mounts riders and carried objects on the actor", () => {
    const world = makeWorld(2, "relations", [
      makeEntity("raft", "코르크 뗏목", "relations", 2, {
        movable: true, properties: { kind: "raft", boardable: true },
      }),
      makeEntity("bag", "작은 도구 가방", "relations", 7, {
        movable: true, parent: "hero", properties: { kind: "portable-small" },
      }),
    ], makeHero("relations", 2));
    world.actors.hero.riding = "raft";
    world.actors.hero.carrying.push("bag");
    const entities = layoutCampaignEntities(world);
    const actor = layoutCampaignActors(world)[0];
    const raft = entities.find((layout) => layout.id === "raft")!;
    const bag = entities.find((layout) => layout.id === "bag")!;
    expect(actor.x).toBe(raft.x);
    expect(actor.y).toBeLessThan(raft.y);
    expect(bag.relation).toBe("carried");
    expect(Math.abs(bag.x - actor.x)).toBeLessThan(80);
  });

  it("keeps fixed held controls installed and separates colocated actors", () => {
    const world = makeWorld(7, "fixed-hold", [
      makeEntity("handle", "고정 손잡이", "fixed-hold", 3, { properties: { kind: "hold-handle" } }),
    ]);
    world.actors.hero.holding = "handle";
    world.actors.keeper = { ...makeHero("fixed-hold", 0), id: "keeper", carrying: [] };
    expect(layoutCampaignEntities(world)[0].relation).toBe("world");
    const actors = layoutCampaignActors(world);
    expect(new Set(actors.map((actor) => actor.x)).size).toBe(2);
  });

  it("hit-tests names and shapes in the fixed view", () => {
    const world = makeWorld(2, "hit", [makeEntity("door", "문", "hit", 7, { properties: { kind: "door" } })]);
    const layouts = layoutCampaignEntities(world, { floors: [{ from: 0, to: 10, y: 0 }] });
    const layout = layouts[0];
    expect(hitTestCampaignLayout(layouts,
      layout.labelBounds.x + layout.labelBounds.width / 2,
      layout.labelBounds.y + layout.labelBounds.height / 2)).toBe("door");
    expect(hitTestCampaignLayout(layouts, layout.x, layout.y - 30)).toBe("door");
  });

  it("keeps deterministic public state signals for drawing, without UI prose", () => {
    const door = makeEntity("door", "문", "signals", 0, {
      properties: { kind: "door", open: false, locked: true, flowDirection: "up" },
    });
    expect(campaignEntitySignals(door)).toEqual(["open:false", "locked:true", "direction:up"]);
  });
});
