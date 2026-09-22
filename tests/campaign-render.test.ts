import { describe, expect, it } from "vitest";
import { STAGES } from "../src/campaign/catalog";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import { allStageSegments } from "../src/campaign/level";
import { resolveStage } from "../src/campaign/registry";
import {
  CAMPAIGN_VIEW_HEIGHT,
  campaignEntitySignals,
  campaignSceneWidth,
  hitTestCampaignLayout,
  layoutCampaignActors,
  layoutCampaignEntities,
} from "../src/render/campaign-scene";

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

  it("gives all 68 campaign maps finite collision-free labels inside their intrinsic scene", () => {
    let sceneCount = 0;
    for (const summary of STAGES.slice(1)) {
      const stage = resolveStage(summary.id)!;
      for (const segment of allStageSegments(stage)) {
        sceneCount += 1;
        const world = segment.enter(null);
        const width = campaignSceneWidth(world);
        const layouts = layoutCampaignEntities(world);
        expect(width, segment.id).toBeGreaterThanOrEqual(960);
        expect(layouts.map((layout) => layout.id), segment.id).toEqual(
          [...new Set(world.visible)].filter((id) => world.entities[id]
            && world.entities[id].properties.equipment !== true
            && !(world.entities[id].properties.causeMapVisible === true
              && world.entities[id].location.region !== world.actors.hero.location.region)),
        );
        for (const layout of layouts) {
          const values = [layout.anchorX, layout.anchorY, layout.x, layout.y,
            layout.labelBounds.x, layout.labelBounds.y, layout.labelBounds.width, layout.labelBounds.height];
          expect(values.every(Number.isFinite), `${segment.id}/${layout.id}`).toBe(true);
          expect(layout.labelBounds.x, `${segment.id}/${layout.id}`).toBeGreaterThanOrEqual(0);
          expect(layout.labelBounds.x + layout.labelBounds.width, `${segment.id}/${layout.id}`).toBeLessThanOrEqual(width);
          expect(layout.labelBounds.y, `${segment.id}/${layout.id}`).toBeGreaterThanOrEqual(0);
          expect(layout.labelBounds.y + layout.labelBounds.height, `${segment.id}/${layout.id}`).toBeLessThanOrEqual(CAMPAIGN_VIEW_HEIGHT);
          expect(hitTestCampaignLayout(layouts,
            layout.labelBounds.x + layout.labelBounds.width / 2,
            layout.labelBounds.y + layout.labelBounds.height / 2), `${segment.id}/${layout.id}`).toBe(layout.id);
        }
        for (let left = 0; left < layouts.length; left++) {
          for (let right = left + 1; right < layouts.length; right++) {
            const a = layouts[left].labelBounds;
            const b = layouts[right].labelBounds;
            const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            expect(overlapWidth > 1 && overlapHeight > 1,
              `${segment.id}: ${layouts[left].id} / ${layouts[right].id}`).toBe(false);
          }
        }
      }
    }
    expect(sceneCount).toBe(68);
  });

  it("keeps scene geometry stable when only an actor moves", () => {
    const world = makeWorld(2, "stable-map", [
      makeEntity("start", "시작 발판", "stable-map", 0),
      makeEntity("middle", "중앙 장치", "stable-map", 3),
      makeEntity("exit", "출구 발판", "stable-map", 8),
    ]);
    const beforeWidth = campaignSceneWidth(world);
    const before = layoutCampaignEntities(world).map(({ id, anchorX, anchorY }) => ({ id, anchorX, anchorY }));
    const moved = structuredClone(world);
    moved.actors.hero.location.x = 7;
    expect(campaignSceneWidth(moved)).toBe(beforeWidth);
    expect(layoutCampaignEntities(moved).map(({ id, anchorX, anchorY }) => ({ id, anchorX, anchorY }))).toEqual(before);
    expect(layoutCampaignActors(moved)[0].x).not.toBe(layoutCampaignActors(world)[0].x);
  });

  it("mounts riders on their support and carried objects on their actor", () => {
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
    expect(bag.anchorX).toBe(actor.anchorX);
  });

  it("keeps fixed held controls installed while reserving actor lanes", () => {
    const world = makeWorld(7, "fixed-hold", [
      makeEntity("handle", "고정 유지 손잡이", "fixed-hold", 3, { properties: { kind: "hold-handle" } }),
    ]);
    world.actors.hero.holding = "handle";
    world.actors.keeper = { ...makeHero("fixed-hold", 0), id: "keeper", carrying: [] };
    const handle = layoutCampaignEntities(world)[0];
    const actors = layoutCampaignActors(world);
    expect(handle.relation).toBe("world");
    expect(new Set(actors.map((actor) => actor.x)).size).toBe(2);
    expect(Math.abs(actors[0].x - actors[1].x)).toBeGreaterThanOrEqual(100);
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

it("keeps carried tools and their labels inside ceiling and wall scenes", () => {
  for (const gravity of ["up", "left", "right"]) {
    const region = `carry-${gravity}`;
    const world = makeWorld(5, region, [
      makeEntity("gravity", "중력 표식", region, 0, { properties: { kind: "room-gravity-marker", gravity, fixedGravity: true } }),
      makeEntity("tool", "작은 도구", region, 0, { parent: "hero", movable: true, properties: { slot: "small" } }),
    ]);
    world.actors.hero.carrying = ["tool"];
    const tool = layoutCampaignEntities(world).find((item) => item.id === "tool")!;
    const hero = layoutCampaignActors(world)[0];
    expect(tool.relation).toBe("carried");
    if (gravity === "up") expect(tool.y).toBeGreaterThan(hero.y);
    expect(tool.labelBounds.y).toBeGreaterThanOrEqual(0);
    expect(tool.labelBounds.y + tool.labelBounds.height).toBeLessThanOrEqual(CAMPAIGN_VIEW_HEIGHT);
  }
});
