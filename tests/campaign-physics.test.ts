import { describe, expect, it } from "vitest";
import { executePhysicalAction, validateAction } from "../src/campaign/physics";
import type { Actor, Entity, PhysicalAction, WorldState } from "../src/campaign/types";
import { makeWorld } from "../src/campaign/level";

const location = (x: number, y = 0, region = "room") => ({ region, x, y });
const entity = (id: string, overrides: Partial<Entity> = {}): Entity => ({
  id,
  name: id,
  description: `${id} fixture`,
  material: "wood",
  movable: true,
  weight: 1,
  capacity: 10,
  reach: 1,
  location: location(0),
  parent: null,
  properties: {},
  ...overrides,
});
const actor = (id: Actor["id"], overrides: Partial<Actor> = {}): Actor => ({
  id,
  location: location(0),
  holding: null,
  carrying: [],
  riding: null,
  capabilities: id === "keeper" ? ["rail-only", "no-jump", "no-stairs", "max-weight:1"] : ["weight:1"],
  ...overrides,
});
function world(entities: Entity[], actors: Actor[] = [actor("hero"), actor("keeper")]): WorldState {
  return {
    stageId: 7,
    segmentId: "fixture",
    tick: 3,
    attempt: 2,
    entities: Object.fromEntries(entities.map((item) => [item.id, item])),
    actors: Object.fromEntries(actors.map((item) => [item.id, item])),
    visible: entities.map((item) => item.id),
    facts: [],
  };
}
const action = (verb: PhysicalAction["verb"], target: string, rest: Partial<PhysicalAction> = {}): PhysicalAction => ({
  kind: "action", actor: "hero", verb, target, ...rest,
});

describe("deterministic campaign physics", () => {
  it("rejects unknown, unreachable, and immovable references as free clarification", () => {
    const state = world([
      entity("far", { location: location(4), reach: 1, properties: { slot: "small" } }),
      entity("statue", { movable: false }),
    ]);
    expect(validateAction(state, action("take", "missing")).outcome).toBe("clarification");
    expect(validateAction(state, action("take", "far")).outcome).toBe("clarification");
    expect(validateAction(state, action("push", "statue", { destination: "far" })).outcome).toBe("clarification");
    const result = executePhysicalAction(state, action("take", "far"));
    expect(result.outcome).toBe("clarification");
    expect(result.world).toBe(state);
  });

  it("keeps one parent, supports reclaim, and prevents containment cycles", () => {
    const token = entity("token", { properties: { slot: "small" } });
    const tray = entity("tray", { capacity: 3, properties: { slot: "large" } });
    let state = world([token, tray]);
    state = executePhysicalAction(state, action("take", "token")).world;
    expect(state.actors.hero.carrying).toEqual(["token"]);
    expect(state.entities.token.parent).toBe("hero");
    state = executePhysicalAction(state, action("place", "token", { destination: "tray" })).world;
    expect(state.actors.hero.carrying).toEqual([]);
    expect(state.entities.token.parent).toBe("tray");
    state = executePhysicalAction(state, action("take", "token")).world;
    expect(state.entities.token.parent).toBe("hero");
    expect(state.actors.hero.carrying).toEqual(["token"]);

    state.entities.tray.parent = "token";
    expect(validateAction(state, action("place", "token", { destination: "tray" })).outcome).toBe("clarification");
  });

  it("keeps an explicit target unique and permits reachable grasp-and-place", () => {
    const left = entity("left-box", { properties: { slot: "large" } });
    const right = entity("right-box", { properties: { slot: "large" } });
    const water = entity("water-mark", { movable: false, capacity: 2 });
    const state = world([left, right, water]);
    const result = executePhysicalAction(state, action("place", "left-box", { destination: "water-mark" }));
    expect(result.outcome).toBe("done");
    expect(result.world.entities["left-box"].parent).toBe("water-mark");
    expect(result.world.entities["right-box"].parent).toBeNull();
    expect(result.world.actors.hero.carrying).toEqual([]);
  });

  it("carries and releases the same finite object at the actor location", () => {
    const key = entity("key", { properties: { slot: "small" } });
    let state = world([key]);
    state = executePhysicalAction(state, action("take", "key")).world;
    state.actors.hero.location = location(2);
    const released = executePhysicalAction(state, action("release", "key"));
    expect(released.world.actors.hero.carrying).toEqual([]);
    expect(released.world.entities.key.parent).toBeNull();
    expect(released.world.entities.key.location).toEqual(location(2));
  });

  it("enforces one large and two small public inventory slots", () => {
    const state = world([
      entity("large-a", { properties: { slot: "large" } }),
      entity("large-b", { properties: { slot: "large" } }),
      entity("small-a", { properties: { slot: "small" } }),
      entity("small-b", { properties: { slot: "small" } }),
      entity("small-c", { properties: { slot: "small" } }),
    ]);
    let next = executePhysicalAction(state, action("take", "large-a")).world;
    expect(validateAction(next, action("take", "large-b")).outcome).toBe("clarification");
    next = executePhysicalAction(next, action("take", "small-a")).world;
    next = executePhysicalAction(next, action("take", "small-b")).world;
    expect(validateAction(next, action("take", "small-c")).outcome).toBe("clarification");
    expect(next.actors.hero.carrying).toEqual(["large-a", "small-a", "small-b"]);
  });

  it("executes overload as an observable physical failure", () => {
    const weight = entity("weight", { weight: 3, properties: { slot: "large" } });
    const raft = entity("raft", { capacity: 2, properties: { boardable: true } });
    let state = world([weight, raft]);
    state = executePhysicalAction(state, action("take", "weight")).world;
    const result = executePhysicalAction(state, action("place", "weight", { destination: "raft" }));
    expect(result.outcome).toBe("failure");
    expect(result.world.entities.weight.parent).toBe("raft");
    expect(result.world.entities.raft.properties).toMatchObject({ overloaded: true, tipped: true });
  });

  it("releases a held device and its explicit effect when that actor moves", () => {
    const curtain = entity("curtain", { movable: false, properties: { open: false } });
    const handle = entity("handle", { movable: false, properties: {
      holdable: true,
      holdEffectEntity: "curtain",
      holdEffectProperty: "open",
      holdEffectValue: true,
      releaseEffectValue: false,
    } });
    const waypoint = entity("waypoint", { movable: false, location: location(3) });
    let state = world([curtain, handle, waypoint]);
    state = executePhysicalAction(state, action("hold", "handle")).world;
    expect(state.actors.hero.holding).toBe("handle");
    expect(state.entities.curtain.properties.open).toBe(true);
    state = executePhysicalAction(state, action("move", "waypoint")).world;
    expect(state.actors.hero.holding).toBeNull();
    expect(state.entities.handle.properties.held).toBe(false);
    expect(state.entities.curtain.properties.open).toBe(false);
  });

  it("uses an explicit rope and its public length for a real two-target relation", () => {
    const boatA = entity("boat-a", { properties: { tiePoint: true } });
    const boatB = entity("boat-b", { location: location(2), reach: 2, properties: { tiePoint: true } });
    const shortRope = entity("short-rope", { material: "cloth", reach: 1, properties: { tool: "rope", slot: "small" } });
    const longRope = entity("long-rope", { material: "cloth", reach: 3, properties: { tool: "rope", slot: "small" } });
    let state = world([boatA, boatB, shortRope, longRope]);
    expect(validateAction(state, action("tie", "boat-a", { destination: "boat-b", instrument: "short-rope" })).outcome).toBe("clarification");
    const tied = executePhysicalAction(state, action("tie", "boat-a", { destination: "boat-b", instrument: "long-rope" }));
    expect(tied.outcome).toBe("done");
    expect(tied.world.entities["boat-a"].properties).toMatchObject({ tiedTo: "boat-b", tiedWith: "long-rope" });
    expect(tied.world.entities["boat-b"].properties).toMatchObject({ tiedTo: "boat-a", tiedWith: "long-rope" });
    expect(tied.world.entities["long-rope"].properties.connects).toBe("boat-a|boat-b");
    state = tied.world;
    state.entities["boat-b"].location = location(0);
    const moved = executePhysicalAction(state, action("push", "boat-a", { destination: "boat-b" }));
    expect(moved.world.entities["boat-a"].location).toEqual(moved.world.entities["boat-b"].location);
  });

  it("uses explicit tongs only for their declared reach", () => {
    const handle = entity("hot-handle", { movable: false, location: location(3), properties: { holdable: true } });
    const tongs = entity("tongs", { reach: 3, properties: { tool: "tongs", slot: "large" } });
    const state = world([handle, tongs]);
    expect(validateAction(state, action("hold", "hot-handle")).outcome).toBe("clarification");
    const held = executePhysicalAction(state, action("hold", "hot-handle", { instrument: "tongs" }));
    expect(held.outcome).toBe("done");
    expect(held.world.entities["hot-handle"].properties.heldWith).toBe("tongs");
    expect(validateAction(state, action("open", "hot-handle", { instrument: "tongs" })).outcome).toBe("clarification");
  });

  it("keeps keeper movement on rails and applies public jump, stair, and weight limits", () => {
    const rail = entity("rail-stop", { location: location(2), properties: { rail: true } });
    const floor = entity("floor-stop", { location: location(2) });
    const stairs = entity("stairs", { properties: { rail: true, stairs: true, climbable: true } });
    const light = entity("light", { weight: 1, properties: { slot: "small" } });
    const heavy = entity("heavy", { weight: 2, properties: { slot: "small" } });
    const state = world([rail, floor, stairs, light, heavy]);
    const keeper = { actor: "keeper" as const };
    expect(validateAction(state, action("move", "rail-stop", keeper)).outcome).toBe("valid");
    expect(validateAction(state, action("move", "floor-stop", keeper)).outcome).toBe("clarification");
    expect(validateAction(state, action("jump", "rail-stop", keeper)).outcome).toBe("clarification");
    expect(validateAction(state, action("climb", "stairs", keeper)).outcome).toBe("clarification");
    expect(validateAction(state, action("take", "light", keeper)).outcome).toBe("valid");
    expect(validateAction(state, action("take", "heavy", keeper)).outcome).toBe("clarification");
  });

  it("boards, dismounts, and climbs using capacity rather than solution ids", () => {
    const raft = entity("raft", { capacity: 1, properties: { boardable: true } });
    const platform = entity("platform", { capacity: 1, location: location(1), properties: { climbable: true, stable: true } });
    let state = world([raft, platform]);
    state = executePhysicalAction(state, action("board", "raft")).world;
    expect(state.actors.hero.riding).toBe("raft");
    state = executePhysicalAction(state, action("dismount", "raft", { destination: "platform" })).world;
    expect(state.actors.hero.riding).toBeNull();
    expect(state.actors.hero.location).toEqual(platform.location);
    const climbed = executePhysicalAction(state, action("climb", "platform"));
    expect(climbed.outcome).toBe("done");
    expect(climbed.world.actors.hero.riding).toBe("platform");
  });

  it("records only actual properties of a visible target in the current attempt", () => {
    const signal = entity("signal", { properties: { route: "left", lit: true } });
    const state = world([signal]);
    state.facts.push({ entity: "signal", property: "route", value: "old", attempt: 1, tick: 1 });
    const observed = executePhysicalAction(state, action("observe", "signal"));
    expect(observed.outcome).toBe("done");
    expect(observed.world.facts).toEqual(expect.arrayContaining([
      { entity: "signal", property: "route", value: "left", attempt: 2, tick: 3 },
      { entity: "signal", property: "lit", value: true, attempt: 2, tick: 3 },
    ]));
    expect(observed.world.facts.some((fact) => fact.property === "solution" || fact.property === "weight")).toBe(false);

    const hidden = world([signal]);
    hidden.visible = [];
    const rejected = executePhysicalAction(hidden, action("remember", "signal"));
    expect(rejected.outcome).toBe("clarification");
    expect(rejected.world.facts).toEqual([]);
  });
});


it("counts what the rider carries against the vessel capacity", () => {
  let state = world([entity("weight", { weight: 1, properties: { slot: "small" } }), entity("boat", { capacity: 1, properties: { boardable: true } })], [actor("hero")]);
  state = executePhysicalAction(state, action("take", "weight")).world;
  const boarded = executePhysicalAction(state, action("board", "boat"));
  expect(boarded.outcome).toBe("failure");
  expect(boarded.world.entities.boat.properties.overloaded).toBe(true);
});
it("counts liquid mass when a filled container is placed on a support", () => {
  const state = world([entity("barrel", { weight: 1, properties: { slot: "large", amount: 2, fluidDensity: 1 } }), entity("shelf", { capacity: 2 })], [actor("hero")]);
  expect(executePhysicalAction(state, action("place", "barrel", { destination: "shelf" })).outcome).toBe("failure");
});
it("does not silently give two actors ownership of a one-holder device", () => {
  let state = world([entity("handle", { properties: { holdable: true } })]);
  state = executePhysicalAction(state, action("hold", "handle")).world;
  expect(validateAction(state, action("hold", "handle", { actor: "keeper" })).outcome).toBe("clarification");
  expect(state.actors.keeper.holding).toBeNull();
});

it("keeps nested cargo beside its carrier through take, boarding, and vessel motion", () => {
  let state = world([
    entity("tray", { location: location(1), properties: { slot: "large" } }),
    entity("bread", { location: location(1), parent: "tray", properties: { slot: "small" } }),
    entity("boat", { location: location(1), properties: { boardable: true } }),
    entity("bank", { location: location(4) }),
  ], [actor("hero")]);
  state = executePhysicalAction(state, action("take", "tray")).world;
  expect(state.entities.bread.location).toEqual(location(0));
  state = executePhysicalAction(state, action("board", "boat")).world;
  expect(state.entities.tray.location).toEqual(location(1));
  expect(state.entities.bread.location).toEqual(location(1));
  state = executePhysicalAction(state, action("move", "bank")).world;
  expect(state.entities.bread.location).toEqual(location(4));
  expect(state.entities.bread.parent).toBe("tray");
});

it("counts carried cargo when climbing and cannot push another actor's inventory", () => {
  let state = world([
    entity("load", { properties: { slot: "small" } }),
    entity("step", { capacity: 1, properties: { climbable: true, stable: true } }),
  ]);
  state = executePhysicalAction(state, action("take", "load")).world;
  expect(executePhysicalAction(state, action("climb", "step")).outcome).toBe("failure");
  expect(executePhysicalAction(state, action("push", "load", { actor: "keeper", destination: "step" })).outcome).toBe("clarification");
  state = executePhysicalAction(state, action("push", "load", { destination: "step" })).world;
  expect(state.actors.hero.carrying).toEqual([]);
  expect(state.entities.load.parent).toBeNull();
});

it("keeps a fixed anchor still and freely allows only positions inside the public rope length", () => {
  let state = world([
    entity("crate", { reach: 3, properties: { tiePoint: true, slot: "large" } }),
    entity("anchor", { movable: false, location: location(2), reach: 3, properties: { tiePoint: true, fixed: true } }),
    entity("rope", { material: "cloth", reach: 5, properties: { tool: "rope", ropeLength: 2, slot: "small" } }),
    entity("near", { movable: false, location: location(1), reach: 5 }),
    entity("far", { movable: false, location: location(5), reach: 5 }),
  ], [actor("hero")]);
  state = executePhysicalAction(state, action("tie", "crate", { destination: "anchor", instrument: "rope" })).world;

  const near = executePhysicalAction(state, action("push", "crate", { destination: "near" }));
  expect(near.outcome).toBe("done");
  expect(near.world.entities.crate.location).toEqual(location(1));
  expect(near.world.entities.anchor.location).toEqual(location(2));

  const far = executePhysicalAction(state, action("push", "crate", { destination: "far" }));
  expect(far.outcome).toBe("clarification");
  expect(far.world).toBe(state);
  expect(far.world.entities.crate.location).toEqual(location(0));
  expect(far.world.entities.anchor.location).toEqual(location(2));
});

it("keeps riders and nested cargo together during stepped movement and stops at a taut fixed rope", () => {
  let state = world([
    entity("boat", { properties: { tiePoint: true, boardable: true } }),
    entity("anchor", { movable: false, properties: { tiePoint: true, fixed: true } }),
    entity("rope", { material: "cloth", reach: 5, properties: { tool: "rope", ropeLength: 2 } }),
    entity("crate", { parent: "boat" }),
    entity("fruit", { parent: "crate" }),
    entity("letter", { parent: "hero", weight: 0, properties: { equipment: true } }),
    entity("far", { movable: false, location: location(4) }),
    entity("other-room", { location: location(0, 0, "elsewhere") }),
  ], [actor("hero", { riding: "boat", carrying: ["letter"] })]);
  state = executePhysicalAction(state, action("tie", "boat", { destination: "anchor", instrument: "rope" })).world;
  for (const x of [1, 2]) {
    const step = executePhysicalAction(state, action("move", "far"), { movementStep: 1 });
    expect(step.outcome).toBe("progress");
    state = step.world;
    expect(state.actors.hero.location).toEqual(location(x));
    expect(state.actors.hero.riding).toBe("boat");
    for (const id of ["boat", "crate", "fruit", "letter"]) expect(state.entities[id].location).toEqual(location(x));
    expect(state.entities.far.location).toEqual(location(4));
  }
  const blocked = executePhysicalAction(state, action("move", "far"), { movementStep: 1 });
  expect(blocked.outcome).toBe("clarification");
  expect(blocked.world).toBe(state);
  expect(blocked.world.entities.anchor.location).toEqual(location(0));
  expect(executePhysicalAction(state, action("move", "other-room"), { movementStep: 1 }).outcome).toBe("clarification");
});

it("pulls a movable tethered object only when taut and preserves its riders and nested cargo", () => {
  const keeper = actor("keeper", { location: location(2), riding: "boat-b", carrying: ["parcel"] });
  let state = world([
    entity("boat-a", { reach: 3, properties: { tiePoint: true } }),
    entity("boat-b", { location: location(2), reach: 3, properties: { tiePoint: true } }),
    entity("rope", { material: "cloth", reach: 5, properties: { tool: "rope", ropeLength: 2, slot: "small" } }),
    entity("crate", { location: location(2), parent: "boat-b" }),
    entity("fruit", { location: location(2), parent: "crate" }),
    entity("parcel", { location: location(2), parent: "keeper", properties: { slot: "small" } }),
    entity("far", { movable: false, location: location(10), reach: 10 }),
  ], [actor("hero"), keeper]);
  state = executePhysicalAction(state, action("tie", "boat-a", { destination: "boat-b", instrument: "rope" })).world;
  const moved = executePhysicalAction(state, action("push", "boat-a", { destination: "far" }));
  expect(moved.outcome).toBe("done");
  expect(moved.world.entities["boat-a"].location).toEqual(location(10));
  expect(moved.world.entities["boat-b"].location).toEqual(location(8));
  expect(moved.world.entities.crate.location).toEqual(location(8));
  expect(moved.world.entities.fruit.location).toEqual(location(8));
  expect(moved.world.actors.keeper.location).toEqual(location(8));
  expect(moved.world.entities.parcel.location).toEqual(location(8));
  expect(Math.hypot(
    moved.world.entities["boat-a"].location.x - moved.world.entities["boat-b"].location.x,
    moved.world.entities["boat-a"].location.y - moved.world.entities["boat-b"].location.y,
  )).toBe(2);
});

it("never teleports another actor's inventory through a tether", () => {
  let state = world([
    entity("cart", { reach: 3, properties: { tiePoint: true } }),
    entity("weight", { location: location(1), reach: 3, properties: { tiePoint: true, slot: "small" } }),
    entity("rope", { material: "cloth", reach: 2, properties: { tool: "rope", ropeLength: 1, slot: "small" } }),
    entity("far", { movable: false, location: location(6), reach: 6 }),
  ], [actor("hero"), actor("keeper", { location: location(1) })]);
  state = executePhysicalAction(state, action("tie", "cart", { destination: "weight", instrument: "rope" })).world;
  state.entities.weight.parent = "keeper";
  state.actors.keeper.carrying = ["weight"];

  const moved = executePhysicalAction(state, action("push", "cart", { destination: "far" }));
  expect(moved.outcome).toBe("clarification");
  expect(moved.world).toBe(state);
  expect(moved.world.entities.cart.location).toEqual(location(0));
  expect(moved.world.entities.weight.location).toEqual(location(1));
  expect(moved.world.actors.keeper.location).toEqual(location(1));
  expect(moved.world.actors.keeper.carrying).toEqual(["weight"]);
});

it("cannot silently take another actor's rope or retie their carried endpoint", () => {
  const state = world([
    entity("post", { properties: { tiePoint: true } }),
    entity("weight", { parent: "keeper", properties: { tiePoint: true, slot: "small" } }),
    entity("rope", { parent: "keeper", material: "cloth", reach: 2, properties: { tool: "rope", ropeLength: 2, slot: "small" } }),
  ], [actor("hero"), actor("keeper", { carrying: ["weight", "rope"] })]);
  const validation = validateAction(state, action("tie", "post", { destination: "weight", instrument: "rope" }));
  expect(validation.outcome).toBe("clarification");
  const result = executePhysicalAction(state, action("tie", "post", { destination: "weight", instrument: "rope" }));
  expect(result.outcome).toBe("clarification");
  expect(result.world).toBe(state);
  expect(state.entities.rope.parent).toBe("keeper");
  expect(state.actors.keeper.carrying).toEqual(["weight", "rope"]);
});

it("carries the delivery letter as worn equipment without consuming puzzle inventory slots", () => {
  let state = makeWorld(6, "room", [
    entity("key", { properties: { slot: "small" } }),
    entity("mirror", { properties: { slot: "small" } }),
    entity("lantern", { properties: { slot: "large" } }),
    entity("door", { location: location(4) }),
  ]);
  for (const id of ["key", "mirror", "lantern"]) {
    const taken = executePhysicalAction(state, action("take", id));
    expect(taken.outcome).toBe("done");
    state = taken.world;
  }
  expect(state.actors.hero.carrying).toEqual(["letter", "key", "mirror", "lantern"]);
  expect(executePhysicalAction(state, action("release", "letter")).outcome).toBe("clarification");
  state = executePhysicalAction(state, action("move", "door")).world;
  expect(state.entities.letter.parent).toBe("hero");
  expect(state.entities.letter.location).toEqual(state.actors.hero.location);
  expect(state.entities.letter.properties.equipment).toBe(true);
});

it("uses an empty hand for a third small object regardless of object identity or pickup order", () => {
  for (const order of [["key", "mirror-a", "mirror-b"], ["mirror-a", "mirror-b", "key"]]) {
    let state = world([
      ...["key", "mirror-a", "mirror-b", "extra"].map((id) => entity(id, { properties: { slot: "small" } })),
      entity("lantern", { properties: { slot: "large" } }),
    ]);
    for (const id of order) {
      const taken = executePhysicalAction(state, action("take", id));
      expect(taken.outcome).toBe("done");
      state = taken.world;
    }
    expect(executePhysicalAction(state, action("take", "extra")).outcome).toBe("clarification");
    expect(executePhysicalAction(state, action("take", "lantern")).outcome).toBe("clarification");
    state = executePhysicalAction(state, action("release", order[2])).world;
    expect(executePhysicalAction(state, action("take", "lantern")).outcome).toBe("done");
  }
});
