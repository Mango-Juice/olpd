import { describe, expect, it } from "vitest";
import { makeEntity, makeHero, makeWorld } from "../src/campaign/level";
import type { StagePresentation } from "../src/campaign/run";
import type { SpatialComposition, SpatialMotion } from "../src/campaign/spatial/types";
import { spatialCampaignHeroFrame, spatialMotionPoint } from "../src/render/animation";
import { hitTestCampaignLayout, layoutCampaignActors, layoutCampaignEntities } from "../src/render/campaign-scene";
import { projectSpatialPoint, spatialBodyRect, spatialSurfaceLine } from "../src/render/spatial-geometry";

const scene: SpatialComposition = {
  floors: [{ from: 0, to: 10, y: 0 }],
  spatial: {
    surfaces: [{ from: 0, to: 4, y: 0, z: 0 }, { from: 4, to: 8, y: 0, endY: 1, z: 1.4 }],
    bodies: [{ entity: "crate", width: 1.25, height: 1.1, depth: .8, kind: "solid", support: true }],
    ceiling: 1.25,
  },
};

function presentation(trace: SpatialMotion, outcome: StagePresentation["outcome"]): StagePresentation {
  const before = makeWorld(2, "space", [makeEntity("crate", "짐상자", "space", 3.5)], makeHero("space", .8));
  const after = structuredClone(before);
  const end = trace.points.at(-1)!;
  after.actors.hero.location = { ...after.actors.hero.location, x: end.x, y: end.y, z: end.z };
  return { id: "trace", before, after, outcome, life: 1, attempt: 1, repeated: false,
    events: [{ id: "event", tick: 1, attempt: 1, instructionId: null,
      actor: "hero", target: "crate", verb: trace.kind === "jump" ? "jump" : "move",
      outcome: outcome === "blocked" ? "blocked" : "safe", reason: "", changes: [], motion: trace }] };
}

describe("spatial campaign rendering", () => {
  it("samples the actual swept walk and jump arc at middle frames", () => {
    const trace: SpatialMotion = { actor: "hero", kind: "jump", target: "crate",
      points: [{ x: .8, y: 0, z: 0, t: 0 }, { x: 2, y: 1.2, z: .7, t: .5 }, { x: 3.2, y: 0, z: 1.4, t: 1 }] };
    expect(spatialMotionPoint(trace, .5)).toMatchObject({ x: 2, y: 1.2, z: .7 });
    const state = presentation(trace, "safe");
    const frame = spatialCampaignHeroFrame({ presentation: state, trace, progress: .4,
      from: { x: 144, y: 400, rotation: 0 }, to: { x: 336, y: 358, rotation: 0 } });
    expect(frame.pose).toBe("jump");
    expect(frame.x).toBeCloseTo(projectSpatialPoint({ x: 2, y: 1.2, z: .7 }).x);
    expect(frame.y).toBeCloseTo(projectSpatialPoint({ x: 2, y: 1.2, z: .7 }).y);
  });

  it("keeps collision and drawing bounds in the same depth lane", () => {
    const world = makeWorld(2, "space", [makeEntity("crate", "짐상자", "space", 3.5,
      { location: { region: "space", x: 3.5, y: 0, z: 1.4 } })], makeHero("space", .8));
    world.actors.hero.location.z = 0;
    const actor = layoutCampaignActors(world, scene)[0];
    const crate = layoutCampaignEntities(world, scene)[0];
    const rect = spatialBodyRect(world, scene.spatial.bodies[0])!;
    expect(actor.y).toBe(400);
    expect(crate.y).toBe(358);
    expect(rect.y + rect.height).toBe(crate.y);
    expect(rect.width).toBe(100);
    expect(hitTestCampaignLayout([crate], rect.x + 4, rect.y + 4)).toBe("crate");
    const slope = spatialSurfaceLine(scene.spatial.surfaces[1]);
    expect(slope.end.y).toBeLessThan(slope.start.y);
  });

  it("uses different contact responses for steam, water, wind and solid blocking", () => {
    const base = { actor: "hero" as const,
      points: [{ x: 1, y: 0, t: 0 }, { x: 2, y: 0, t: 1 }], contact: { x: 2, y: 0 } };
    const frame = (kind: SpatialMotion["kind"], outcome: StagePresentation["outcome"]) => {
      const trace: SpatialMotion = { ...base, kind };
      return spatialCampaignHeroFrame({ presentation: presentation(trace, outcome), trace,
        progress: .9, from: { x: 160, y: 400, rotation: 0 }, to: { x: 240, y: 400, rotation: 0 } });
    };
    expect(frame("solid", "blocked").pose).toBe("push");
    const steam = frame("steam", "death"), water = frame("water", "death"), wind = frame("wind", "death");
    expect(steam.pose).toBe("death");
    expect(water.y).toBeGreaterThan(steam.y);
    expect(wind.x).toBeGreaterThan(water.x);
    expect(steam.contact).toBeDefined();
  });
});
