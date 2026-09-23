import { describe, expect, it } from "vitest";
import type { SegmentDefinition } from "../src/campaign/level";
import { GARDEN_PUBLIC_CATALOG, GARDEN_STAGE } from "./fixtures/campaign-worlds/garden";
import type { PhysicalAction, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function segment(id: string): SegmentDefinition {
  const found = GARDEN_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing segment ${id}`);
  return found;
}

function execute(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  const physical = definition.execute?.(state, physicalAction);
  if (!physical) throw new Error(`${definition.id} has no executor`);
  expect(physical.outcome, physical.reason).toBe("done");
  return physical.world;
}

function advance(definition: SegmentDefinition, state: WorldState): WorldState {
  const environment = definition.advance(state);
  expect(environment.failure).toBeUndefined();
  return environment.world;
}

function act(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  return advance(definition, execute(definition, state, physicalAction));
}

function run(definition: SegmentDefinition, state: WorldState, actions: readonly PhysicalAction[]): WorldState {
  return actions.reduce((current, physicalAction) => act(definition, current, physicalAction), state);
}


function localSeedRoute(definition: SegmentDefinition, state: WorldState): WorldState {
  return run(definition, state, [
    action("move", "05-5-to-normal"),
    action("move", "05-5-normal-pot"),
    action("push", "05-5-normal-pot", { destination: "05-5-normal-slot" }),
    action("climb", "05-5-normal-pot"),
    action("take", "05-5-sun-seed"),
    action("move", "05-5-back-normal"),
    action("place", "05-5-sun-seed", { destination: "05-5-sun-slot" }),

    action("move", "05-5-to-left"),
    action("move", "05-5-left-carrier"),
    action("push", "05-5-left-carrier", { destination: "05-5-left-harvest" }),
    action("take", "05-5-leaf-seed"),
    action("move", "05-5-back-left"),
    action("place", "05-5-leaf-seed", { destination: "05-5-leaf-slot" }),

    action("move", "05-5-to-inverted"),
    action("move", "05-5-inverted-vine"),
    action("climb", "05-5-inverted-vine"),
    action("take", "05-5-moon-seed"),
    action("move", "05-5-back-inverted"),
    action("place", "05-5-moon-seed", { destination: "05-5-moon-slot" }),

    action("move", "05-5-to-right"),
    action("move", "05-5-right-pot"),
    action("push", "05-5-right-pot", { destination: "05-5-right-pot-slot" }),
    action("climb", "05-5-right-lift"),
    action("take", "05-5-drop-seed"),
    action("move", "05-5-back-right"),
    action("place", "05-5-drop-seed", { destination: "05-5-drop-slot" }),
    action("move", "05-5-exit"),
  ]);
}

describe("inverted garden public contract", () => {
  it("exports five encounters, isolated practice, one story, and rendering labels without solution flags", () => {
    expect(GARDEN_STAGE).toMatchObject({ id: 5, title: "뒤집힌 정원" });
    expect(GARDEN_STAGE.segments.map((item) => item.id)).toEqual(["05-1", "05-2", "05-3", "05-4", "05-5"]);
    expect(GARDEN_STAGE.practice.id).toBe("05-practice");
    expect(GARDEN_STAGE.story).toEqual({
      afterSegment: "05-5",
      object: "05-5-mural",
      text: "화분은 거꾸로 자라도, 곁에 있던 자리는 그대로다.",
    });
    expect(Object.keys(GARDEN_PUBLIC_CATALOG)).toEqual(["05-practice", "05-1", "05-2", "05-3", "05-4", "05-5"]);

    for (const definition of [GARDEN_STAGE.practice, ...GARDEN_STAGE.segments]) {
      const initial = definition.enter(null);
      const publicItems = GARDEN_PUBLIC_CATALOG[definition.id];
      expect(publicItems.map((item) => item.id)).toEqual(initial.visible);
      expect(publicItems.every((item) => item.kind && item.publicLabel && item.description)).toBe(true);
      expect(Object.values(initial.entities).every((item) =>
        typeof item.properties.kind === "string" && typeof item.properties.publicLabel === "string" && item.description.length > 0,
      )).toBe(true);
      expect(Object.values(initial.entities).some((item) => /\b(?:up|down|left|right|normal|sun|leaf|moon|drop)\b/i.test(item.description))).toBe(false);
      expect(Object.values(initial.entities).some((item) =>
        Object.keys(item.properties).some((key) => /solution|hidden|actionId|commandSequence/i.test(key)),
      )).toBe(false);
    }
  });

  it("keeps room gravity fixed in public properties and flips only the crossing actor", () => {
    const definition = GARDEN_STAGE.practice;
    const initial = definition.enter(null);
    const lowerPot = structuredClone(initial.entities["05-practice-down-pot"].location);
    const upperPot = structuredClone(initial.entities["05-practice-up-pot"].location);
    const crossed = act(definition, initial, action("move", "05-practice-boundary"));
    expect(crossed.actors.hero.location.region).toBe("05-practice-up");
    expect(crossed.actors.hero.capabilities).toContain("gravity:up");
    expect(crossed.entities["05-practice-down-room"].properties).toMatchObject({ gravity: "down", fixedGravity: true });
    expect(crossed.entities["05-practice-up-room"].properties).toMatchObject({ gravity: "up", fixedGravity: true });
    expect(crossed.entities["05-practice-down-pot"].location).toEqual(lowerPot);
    expect(crossed.entities["05-practice-up-pot"].location).toEqual(upperPot);
    expect(definition.enter(null)).toEqual(initial);
  });
});

describe("05-1 rail affordance", () => {
  it("clarifies lifting and unreachable pushes, then moves a fixed pot one reachable tile without teleporting it", () => {
    const definition = segment("05-1");
    const initial = definition.enter(null);
    const lift = definition.execute?.(initial, action("take", "05-1-pot"));
    expect(lift?.outcome).toBe("clarification");
    expect(lift?.reason).toContain("고정 고리");

    const far = structuredClone(initial);
    far.actors.hero.location.x = -1;
    far.entities.letter.location.x = -1;
    const unreachable = definition.execute?.(far, action("push", "05-1-pot", { destination: "05-1-step-slot" }));
    expect(unreachable?.outcome).toBe("clarification");
    expect(unreachable?.world).toEqual(far);

    let state = act(definition, initial, action("push", "05-1-pot", { destination: "05-1-step-slot" }));
    expect(state.entities["05-1-pot"].parent).toBe("05-1-step-slot");
    expect(state.entities["05-1-pot"].location).toEqual(state.entities["05-1-step-slot"].location);
    expect(state.entities["05-1-pot"].properties.railFixed).toBe(true);
    expect(state.actors.hero.location.x).toBe(1);
    expect(state.entities.letter.location).toEqual(state.actors.hero.location);
    state = act(definition, state, action("move", "05-1-exit"));
    expect(definition.complete(state)).toBe(true);
  });

  it("treats a legal place phrase as the same rail slide and rejects placing a pot off its rail", () => {
    const definition = segment("05-2");
    const initial = definition.enter(null);
    const offRail = definition.execute?.(initial, action("place", "05-2-lower-pot", { destination: "05-2-lower-room" }));
    expect(offRail?.outcome).toBe("clarification");
    expect(offRail?.world.entities["05-2-lower-pot"].location.x).toBe(1);
    expect(offRail?.world.entities["05-2-lower-pot"].parent).toBeNull();

    const placed = definition.execute?.(initial, action("place", "05-2-lower-pot", { destination: "05-2-pressure-plate" }));
    expect(placed?.outcome, placed?.reason).toBe("done");
    expect(placed?.world.entities["05-2-lower-pot"].parent).toBe("05-2-pressure-plate");
    expect(placed?.world.actors.hero.location.x).toBe(1);
    expect(placed?.world.entities.letter.location).toEqual(placed?.world.actors.hero.location);
  });

  it("cannot push a rail pot while riding it and releases a held device when a push moves the actor", () => {
    const definition = segment("05-1");
    let riding = act(definition, definition.enter(null), action("move", "05-1-pot"));
    riding = act(definition, riding, action("climb", "05-1-pot"));
    const rejected = definition.execute?.(riding, action("push", "05-1-pot", { destination: "05-1-step-slot" }));
    expect(rejected?.outcome).toBe("clarification");
    expect(rejected?.world.actors.hero.riding).toBe("05-1-pot");
    expect(rejected?.world.entities["05-1-pot"].location.x).toBe(1);

    const holding = definition.enter(null);
    holding.actors.hero.holding = "05-1-start";
    Object.assign(holding.entities["05-1-start"].properties, {
      held: true,
      heldBy: "hero",
      holdEffectEntity: "05-1-start",
      holdEffectProperty: "testLatch",
      holdEffectValue: true,
      releaseEffectValue: false,
      testLatch: true,
    });
    const pushed = definition.execute?.(holding, action("push", "05-1-pot", { destination: "05-1-step-slot" }));
    expect(pushed?.outcome, pushed?.reason).toBe("done");
    expect(pushed?.world.actors.hero.holding).toBeNull();
    expect(pushed?.world.entities["05-1-start"].properties).toMatchObject({ held: false, heldBy: "", testLatch: false });
    expect(pushed?.world.entities.letter.location).toEqual(pushed?.world.actors.hero.location);
  });

  it("blocks a direct path at the actual threshold rather than accepting a distant exit target", () => {
    const definition = segment("05-1");
    const result = definition.execute?.(definition.enter(null), action("move", "05-1-exit"));
    expect(result?.outcome).toBe("blocked");
    expect(result?.reason).toContain("덩굴턱");
  });
});

describe("05-2 scoped gravity rooms", () => {
  function openLower(definition: SegmentDefinition): WorldState {
    return run(definition, definition.enter(null), [
      action("move", "05-2-lower-pot"),
      action("push", "05-2-lower-pot", { destination: "05-2-pressure-plate" }),
      action("move", "05-2-boundary"),
    ]);
  }

  it("supports the upper rail-pot route while the lower pot remains the real door parent", () => {
    const definition = segment("05-2");
    let state = openLower(definition);
    expect(state.actors.hero.location.region).toBe("05-2-upper");
    expect(state.entities["05-2-lower-pot"].parent).toBe("05-2-pressure-plate");
    expect(state.entities["05-2-door"].properties.open).toBe(true);
    state = run(definition, state, [
      action("move", "05-2-upper-pot"),
      action("push", "05-2-upper-pot", { destination: "05-2-upper-slot" }),
      action("climb", "05-2-upper-pot"),
      action("take", "05-2-seed-bag"),
      action("move", "05-2-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["05-2-upper-pot"].parent).toBe("05-2-upper-slot");
  });

  it("supports the physically different side-vine route without moving the upper pot", () => {
    const definition = segment("05-2");
    let state = openLower(definition);
    state = run(definition, state, [
      action("move", "05-2-side-vine"),
      action("climb", "05-2-side-vine"),
      action("take", "05-2-seed-bag"),
      action("move", "05-2-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["05-2-upper-pot"].parent).toBeNull();
    expect(state.entities["05-2-upper-pot"].location.x).toBe(1);
    expect(state.entities["05-2-side-vine"].location.x).toBe(2);
  });

  it("rejects cross-room object targeting as clarification and leaves both rooms unchanged", () => {
    const definition = segment("05-2");
    const initial = definition.enter(null);
    const result = definition.execute?.(initial, action("move", "05-2-upper-pot"));
    expect(result?.outcome).toBe("clarification");
    expect(result?.world).toEqual(initial);
  });

  it("moves worn equipment through boundaries and releases an established hold", () => {
    const definition = segment("05-2");
    let state = definition.enter(null);
    state = execute(definition, state, action("place", "05-2-lower-pot", { destination: "05-2-pressure-plate" }));
    state.entities["05-2-door"].properties.held = true;
    state.entities["05-2-door"].properties.heldBy = "hero";
    state.entities["05-2-door"].properties.holdEffectEntity = "05-2-door";
    state.entities["05-2-door"].properties.holdEffectProperty = "testLatch";
    state.entities["05-2-door"].properties.releaseEffectValue = false;
    state.entities["05-2-door"].properties.testLatch = true;
    state.actors.hero.holding = "05-2-door";
    const crossed = definition.execute?.(state, action("move", "05-2-boundary"));
    expect(crossed?.outcome, crossed?.reason).toBe("done");
    expect(crossed?.world.actors.hero.holding).toBeNull();
    expect(crossed?.world.entities["05-2-door"].properties).toMatchObject({ held: false, heldBy: "", testLatch: false });
    expect(crossed?.world.entities.letter.location).toEqual(crossed?.world.actors.hero.location);
    expect(crossed?.world.entities.letter.location.region).toBe("05-2-upper");
  });

  it("keeps carried equipment colocated after multiple one-tile rail pushes", () => {
    const definition = segment("05-3");
    let state = act(definition, definition.enter(null), action("push", "05-3-empty-a", { destination: "05-3-small-a" }));
    expect(state.entities.letter.location).toEqual(state.actors.hero.location);
    state = act(definition, state, action("move", "05-3-empty-b"));
    state = act(definition, state, action("push", "05-3-empty-b", { destination: "05-3-small-b" }));
    expect(state.entities.letter.location).toEqual(state.actors.hero.location);
    expect(state.entities["05-3-empty-a"].parent).toBe("05-3-small-a");
    expect(state.entities["05-3-empty-b"].parent).toBe("05-3-small-b");
  });

  it("does not let a distant high-shelf target bypass both published access routes", () => {
    const definition = segment("05-2");
    let state = openLower(definition);
    state = act(definition, state, action("move", "05-2-seed-bag"));
    const result = definition.execute?.(state, action("take", "05-2-seed-bag"));
    expect(result?.outcome).toBe("clarification");
    expect(result?.world.actors.hero.carrying).not.toContain("05-2-seed-bag");
  });
});

describe("05-3 load capacity and alternatives", () => {
  it("breaks the actual capacity-2 grate under the unreinforced load-3 pot", () => {
    const definition = segment("05-3");
    let state = act(definition, definition.enter(null), action("move", "05-3-heavy-pot"));
    const broken = definition.execute?.(state, action("push", "05-3-heavy-pot", { destination: "05-3-large-stand" }));
    expect(broken?.outcome).toBe("failure");
    expect(broken?.reason).toContain("하중 3");
    expect(broken?.reason).toContain("허용 2");
    expect(broken?.world.entities["05-3-grate"].properties).toMatchObject({ broken: true, observedLoad: 3 });
  });

  it("raises real grate capacity with the plate, then uses the heavy parent relationship", () => {
    const definition = segment("05-3");
    let state = run(definition, definition.enter(null), [
      action("move", "05-3-plate"),
      action("push", "05-3-plate", { destination: "05-3-grate" }),
      action("move", "05-3-heavy-pot"),
      action("push", "05-3-heavy-pot", { destination: "05-3-large-stand" }),
      action("move", "05-3-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["05-3-plate"].parent).toBe("05-3-grate");
    expect(state.entities["05-3-grate"].properties).toMatchObject({ reinforced: true, capacity: 4 });
    expect(state.entities["05-3-heavy-pot"].parent).toBe("05-3-large-stand");
    expect(state.entities["05-3-balance"].properties.reading).toBe(3);
  });

  it("opens by two independent empty-pot parents and never touches the heavy route", () => {
    const definition = segment("05-3");
    const state = run(definition, definition.enter(null), [
      action("move", "05-3-empty-a"),
      action("push", "05-3-empty-a", { destination: "05-3-small-a" }),
      action("move", "05-3-empty-b"),
      action("push", "05-3-empty-b", { destination: "05-3-small-b" }),
      action("move", "05-3-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["05-3-empty-a"].parent).toBe("05-3-small-a");
    expect(state.entities["05-3-empty-b"].parent).toBe("05-3-small-b");
    expect(state.entities["05-3-heavy-pot"].parent).toBeNull();
    expect(state.entities["05-3-balance"].properties.reading).toBe(2);
  });
});

describe("05-4 cover and climb alternatives", () => {
  function openAndCross(definition: SegmentDefinition): WorldState {
    return run(definition, definition.enter(null), [
      action("move", "05-4-door-pot"),
      action("push", "05-4-door-pot", { destination: "05-4-door-slot" }),
      action("move", "05-4-boundary"),
    ]);
  }

  it("locks the cover with the right pot before choosing the flat floor", () => {
    const definition = segment("05-4");
    const state = run(definition, openAndCross(definition), [
      action("move", "05-4-cover-pot"),
      action("push", "05-4-cover-pot", { destination: "05-4-cover-slot" }),
      action("move", "05-4-floor-path"),
      action("move", "05-4-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["05-4-cover-pot"].parent).toBe("05-4-cover-slot");
    expect(state.entities["05-4-cover"].properties).toMatchObject({ position: "covered", locked: true });
    expect(state.entities["05-4-route"].properties.selected).toBe("floor");
  });

  it("climbs the side vine with the cover untouched and keeps the vine fixed", () => {
    const definition = segment("05-4");
    const state = run(definition, openAndCross(definition), [
      action("move", "05-4-vine"),
      action("climb", "05-4-vine"),
      action("move", "05-4-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["05-4-cover-pot"].parent).toBeNull();
    expect(state.entities["05-4-cover"].properties.locked).toBe(false);
    expect(state.entities["05-4-route"].properties.selected).toBe("vine");
    expect(state.entities["05-4-vine"].location.x).toBe(2);
  });

  it("physically fails on the exposed floor and records the contact state", () => {
    const definition = segment("05-4");
    const state = openAndCross(definition);
    const struck = definition.execute?.(state, action("move", "05-4-floor-path"));
    expect(struck?.outcome).toBe("failure");
    expect(struck?.world.entities["05-4-spikes"].properties.contact).toBe(true);
  });
});

describe("05-5 four local devices and rotating-ladder alternative", () => {
  it("uses each room-local device, one seed at a time, and validates the four real matching parents", () => {
    const definition = segment("05-5");
    const state = localSeedRoute(definition, definition.enter(null));
    expect(definition.complete(state)).toBe(true);
    for (const shape of ["sun", "leaf", "moon", "drop"]) {
      expect(state.entities[`05-5-${shape}-seed`].parent).toBe(`05-5-${shape}-slot`);
    }
    expect(state.entities["05-5-pedestal"].properties.placed).toBe(4);
    expect(state.entities["05-5-thorn-pot"].properties.passageBlocked).not.toBe(true);
    expect(state.actors.hero.carrying.filter((id) => state.entities[id].properties.kind === "season-seed")).toEqual([]);
  });

  it("uses the rotating ladder for normal and left rooms while leaving both local rail devices untouched", () => {
    const definition = segment("05-5");
    let state = run(definition, definition.enter(null), [
      action("move", "05-5-to-normal"),
      action("move", "05-5-normal-ladder-end"),
      action("climb", "05-5-normal-ladder-end"),
      action("take", "05-5-sun-seed"),
      action("move", "05-5-back-normal"),
      action("place", "05-5-sun-seed", { destination: "05-5-sun-slot" }),
      action("turn", "05-5-ladder"),
      action("move", "05-5-to-left"),
      action("move", "05-5-left-ladder-end"),
      action("climb", "05-5-left-ladder-end"),
      action("take", "05-5-leaf-seed"),
      action("move", "05-5-back-left"),
      action("place", "05-5-leaf-seed", { destination: "05-5-leaf-slot" }),
    ]);
    expect(state.entities["05-5-normal-pot"].parent).toBeNull();
    expect(state.entities["05-5-left-carrier"].parent).toBeNull();
    expect(state.entities["05-5-ladder"].properties.connectedRegion).toBe("05-5-left");
    expect(state.entities["05-5-sun-seed"].parent).toBe("05-5-sun-slot");
    expect(state.entities["05-5-leaf-seed"].parent).toBe("05-5-leaf-slot");
  });

  it("clarifies one-hand overflow and shape mismatch without mutating either seed", () => {
    const definition = segment("05-5");
    let state = run(definition, definition.enter(null), [
      action("move", "05-5-to-normal"),
      action("move", "05-5-normal-ladder-end"),
      action("climb", "05-5-normal-ladder-end"),
      action("take", "05-5-sun-seed"),
      action("move", "05-5-back-normal"),
    ]);
    const mismatch = definition.execute?.(state, action("place", "05-5-sun-seed", { destination: "05-5-leaf-slot" }));
    expect(mismatch?.outcome).toBe("clarification");
    expect(mismatch?.world.actors.hero.carrying).toContain("05-5-sun-seed");
    expect(mismatch?.world.entities["05-5-sun-seed"].parent).toBe("hero");

    state.actors.hero.location.region = "05-5-left";
    state.actors.hero.location.x = 2;
    state.entities["05-5-leaf-seed"].parent = "05-5-left-carrier";
    const overflow = definition.execute?.(state, action("take", "05-5-leaf-seed"));
    expect(overflow?.outcome).toBe("clarification");
    expect(overflow?.reason).toContain("손 1/1");
  });

  it("requires an actually climbed local device or connected ladder, not only a remote seed target", () => {
    const definition = segment("05-5");
    let state = act(definition, definition.enter(null), action("move", "05-5-to-normal"));
    state = act(definition, state, action("move", "05-5-sun-seed"));
    const result = definition.execute?.(state, action("take", "05-5-sun-seed"));
    expect(result?.outcome).toBe("clarification");
    expect(result?.world.entities["05-5-sun-seed"].parent).toBeNull();
  });

  it("moves a carried seed, worn letter, and nested seed cargo together through a return boundary", () => {
    const definition = segment("05-5");
    let state = run(definition, definition.enter(null), [
      action("move", "05-5-to-normal"),
      action("move", "05-5-normal-ladder-end"),
      action("climb", "05-5-normal-ladder-end"),
      action("take", "05-5-sun-seed"),
    ]);
    state.entities["test-seed-tag"] = {
      ...structuredClone(state.entities.letter),
      id: "test-seed-tag",
      name: "씨앗 표찰",
      description: "씨앗에 매달린 시험 표찰입니다.",
      parent: "05-5-sun-seed",
      location: { ...state.entities["05-5-sun-seed"].location },
      properties: { kind: "tag", publicLabel: "씨앗 표찰" },
    };
    const crossed = definition.execute?.(state, action("move", "05-5-back-normal"));
    expect(crossed?.outcome, crossed?.reason).toBe("done");
    const heroLocation = crossed!.world.actors.hero.location;
    expect(crossed!.world.entities.letter.location).toEqual(heroLocation);
    expect(crossed!.world.entities["05-5-sun-seed"].location).toEqual(heroLocation);
    expect(crossed!.world.entities["test-seed-tag"].location).toEqual(heroLocation);
    expect(heroLocation.region).toBe("05-5-central");
  });
});
