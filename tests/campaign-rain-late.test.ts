import { describe, expect, it } from "vitest";
import { RAIN_BOATS, RAIN_ORGAN, RAIN_REACH } from "../src/campaign/stages/rain-late";
import type { SegmentDefinition } from "../src/campaign/level";
import type { PhysicalAction, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  options: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...options });

function step(segment: SegmentDefinition, world: WorldState, physicalAction: PhysicalAction): WorldState {
  const result = segment.execute!(world, physicalAction);
  expect(result.outcome, result.reason).toBe("done");
  const environment = segment.advance(result.world);
  expect(environment.failure).toBeUndefined();
  return environment.world;
}

describe("02-3 닿지 않는 손잡이", () => {
  it("stabilizes the barrel with exactly two visible water units", () => {
    let world = RAIN_REACH.enter(null);
    world = step(RAIN_REACH, world, action("pour", "reach-basin", { destination: "reach-barrel", amount: 2 }));
    expect(world.entities["reach-barrel"].properties).toMatchObject({ amount: 2, stable: true, afloat: false });
    world = step(RAIN_REACH, world, action("climb", "reach-barrel"));
    world = step(RAIN_REACH, world, action("pull", "reach-handle"));
    world = step(RAIN_REACH, world, action("dismount", "reach-barrel", { destination: "reach-exit" }));
    expect(RAIN_REACH.complete(world)).toBe(true);
  });

  it("stabilizes the empty barrel through a real rope-anchor relation", () => {
    let world = RAIN_REACH.enter(null);
    world = step(RAIN_REACH, world, action("tie", "reach-barrel", { destination: "reach-anchor", instrument: "reach-rope" }));
    expect(world.entities["reach-barrel"].properties).toMatchObject({ tiedTo: "reach-anchor", tiedWith: "reach-rope", stable: true, afloat: true });
    world = step(RAIN_REACH, world, action("climb", "reach-barrel"));
    world = step(RAIN_REACH, world, action("pull", "reach-handle"));
    world = step(RAIN_REACH, world, action("dismount", "reach-barrel", { destination: "reach-exit" }));
    expect(RAIN_REACH.complete(world)).toBe(true);
  });

  it("physically tips an empty climb and a three-unit barrel", () => {
    const empty = RAIN_REACH.execute!(RAIN_REACH.enter(null), action("climb", "reach-barrel"));
    expect(empty.outcome).toBe("failure");
    expect(empty.world.entities["reach-barrel"].properties.tipped).toBe(true);
    expect(RAIN_REACH.execute!(RAIN_REACH.enter(null), action("board", "reach-barrel")).outcome).toBe("failure");

    const poured = RAIN_REACH.execute!(RAIN_REACH.enter(null), action("pour", "reach-basin", { destination: "reach-barrel", amount: 3 }));
    expect(poured.outcome).toBe("done");
    const overflow = RAIN_REACH.advance(poured.world);
    expect(overflow.failure).toContain("적재선");
    expect(overflow.world.entities["reach-barrel"].properties.tipped).toBe(true);
  });

  it("does not allow walking directly across the basin", () => {
    const crossed = RAIN_REACH.execute!(RAIN_REACH.enter(null), action("move", "reach-exit"));
    expect(crossed.outcome).toBe("failure");
  });
});

function pairedBoats(heroBoat: string, weightBoat: string): WorldState {
  let world = RAIN_BOATS.enter(null);
  world = step(RAIN_BOATS, world, action("tie", heroBoat, { destination: weightBoat, instrument: "boat-short-rope" }));
  world = step(RAIN_BOATS, world, action("place", "boat-door-weight", { destination: weightBoat }));
  world = step(RAIN_BOATS, world, action("board", heroBoat));
  expect(world.entities[heroBoat].location.x).toBe(8);
  expect(world.entities[weightBoat].location.x).toBe(8);
  world = step(RAIN_BOATS, world, action("dismount", heroBoat, { destination: "boat-exit" }));
  world = step(RAIN_BOATS, world, action("place", "boat-door-weight", { destination: "boat-pedestal" }));
  return world;
}

describe("02-4 서로 묶인 배", () => {
  it("accepts either boat identity for the hero and weight roles", () => {
    const first = pairedBoats("boat-striped", "boat-dotted");
    const swapped = pairedBoats("boat-dotted", "boat-striped");
    expect(RAIN_BOATS.complete(first)).toBe(true);
    expect(RAIN_BOATS.complete(swapped)).toBe(true);
  });

  it("sends the cargo by long pulley and relays the hero boat across short anchors", () => {
    let world = RAIN_BOATS.enter(null);
    world = step(RAIN_BOATS, world, action("place", "boat-door-weight", { destination: "boat-striped" }));
    world = step(RAIN_BOATS, world, action("tie", "boat-striped", { destination: "boat-pulley", instrument: "boat-long-rope" }));
    world = step(RAIN_BOATS, world, action("pull", "boat-long-rope", { destination: "boat-pulley" }));
    expect(world.entities["boat-striped"].location.x).toBe(8);
    expect(world.entities["boat-door-weight"].location.x).toBe(8);

    world = step(RAIN_BOATS, world, action("tie", "boat-dotted", { destination: "boat-rock", instrument: "boat-short-rope" }));
    world = step(RAIN_BOATS, world, action("board", "boat-dotted"));
    world = step(RAIN_BOATS, world, action("pull", "boat-short-rope", { destination: "boat-rock" }));
    world = step(RAIN_BOATS, world, action("untie", "boat-dotted", { destination: "boat-rock", instrument: "boat-short-rope" }));
    world = step(RAIN_BOATS, world, action("tie", "boat-dotted", { destination: "boat-exit-ring", instrument: "boat-short-rope" }));
    world = step(RAIN_BOATS, world, action("pull", "boat-short-rope", { destination: "boat-exit-ring" }));
    world = step(RAIN_BOATS, world, action("dismount", "boat-dotted", { destination: "boat-exit" }));
    world = step(RAIN_BOATS, world, action("place", "boat-door-weight", { destination: "boat-pedestal" }));
    expect(RAIN_BOATS.complete(world)).toBe(true);
  });

  it("fails from real capacity when the hero boards the weight boat", () => {
    let world = RAIN_BOATS.enter(null);
    world = step(RAIN_BOATS, world, action("place", "boat-door-weight", { destination: "boat-striped" }));
    const overloaded = RAIN_BOATS.execute!(world, action("board", "boat-striped"));
    expect(overloaded.outcome).toBe("failure");
    expect(overloaded.world.entities["boat-striped"].properties).toMatchObject({ overloaded: true, tipped: true });
  });
});

function raiseWithLargeWheel(world: WorldState): WorldState {
  return step(RAIN_ORGAN, world, action("turn", "organ-gutter", { amount: 1 }));
}

function rideSmallLift(world: WorldState): WorldState {
  world = step(RAIN_ORGAN, world, action("turn", "organ-gutter", { amount: 1 }));
  world = step(RAIN_ORGAN, world, action("board", "organ-lift"));
  return step(RAIN_ORGAN, world, action("dismount", "organ-lift", { destination: "organ-exit" }));
}

describe("02-5 빗물 오르간", () => {
  it("preserves the raised door with the counterweight bag before redirecting flow", () => {
    let world = raiseWithLargeWheel(RAIN_ORGAN.enter(null));
    expect(world.entities["organ-counterweight"].properties.raised).toBe(true);
    world = step(RAIN_ORGAN, world, action("place", "organ-stone-bag", { destination: "organ-hook" }));
    world = rideSmallLift(world);
    expect(world.entities["organ-door"].properties).toMatchObject({ open: true, supported: true, supportMethod: "counterweight" });
    expect(RAIN_ORGAN.complete(world)).toBe(true);
  });

  it("preserves the raised door with a filled barrel support", () => {
    let world = raiseWithLargeWheel(RAIN_ORGAN.enter(null));
    world = step(RAIN_ORGAN, world, action("pour", "organ-water-source", { destination: "organ-barrel", amount: 2 }));
    world = step(RAIN_ORGAN, world, action("place", "organ-barrel", { destination: "organ-door-socket" }));
    world = rideSmallLift(world);
    expect(world.entities["organ-door"].properties).toMatchObject({ open: true, supported: true, supportMethod: "water-barrel" });
    expect(RAIN_ORGAN.complete(world)).toBe(true);
  });

  it("drops the unpreserved door when flow is redirected", () => {
    let world = raiseWithLargeWheel(RAIN_ORGAN.enter(null));
    const redirected = RAIN_ORGAN.execute!(world, action("turn", "organ-gutter", { amount: 1 }));
    expect(redirected.outcome).toBe("done");
    const environment = RAIN_ORGAN.advance(redirected.world);
    expect(environment.failure).toContain("받치지 않아");
    expect(environment.world.entities["organ-door"].properties.open).toBe(false);
  });

  it("keeps both physical supports inaccessible until the large wheel raises the door", () => {
    const initial = RAIN_ORGAN.enter(null);
    expect(RAIN_ORGAN.execute!(initial, action("place", "organ-stone-bag", { destination: "organ-hook" })).outcome).toBe("clarification");
    expect(RAIN_ORGAN.execute!(initial, action("place", "organ-barrel", { destination: "organ-door-socket" })).outcome).toBe("clarification");
  });

  it("resumes deterministically from the same serialized physical state", () => {
    let world = raiseWithLargeWheel(RAIN_ORGAN.enter(null));
    world = step(RAIN_ORGAN, world, action("place", "organ-stone-bag", { destination: "organ-hook" }));
    const redirected = RAIN_ORGAN.execute!(world, action("turn", "organ-gutter", { amount: 1 }));
    expect(redirected.outcome).toBe("done");
    const restored = JSON.parse(JSON.stringify(redirected.world)) as WorldState;
    expect(RAIN_ORGAN.advance(restored)).toEqual(RAIN_ORGAN.advance(redirected.world));
  });
});
