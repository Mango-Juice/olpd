import { describe, expect, it } from "vitest";
import { FORGE_PUBLIC_CATALOG, FORGE_STAGE } from "./fixtures/campaign-worlds/forge";
import type { SegmentDefinition } from "../src/campaign/level";
import type { PhysicalAction, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function segment(id: string): SegmentDefinition {
  const found = FORGE_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing segment ${id}`);
  return found;
}

function execute(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  let current = state;
  for (let boundary = 0; boundary < 20; boundary += 1) {
    const result = definition.execute?.(current, physicalAction);
    if (!result) throw new Error(`${definition.id} has no executor`);
    if (result.outcome === "done") return result.world;
    expect(result.outcome, result.reason).toBe("progress");
    expect(definition.id).toBe("04-4");
    expect(["move", "jump", "duck"]).toContain(physicalAction.verb);
    current = advance(definition, result.world);
  }
  throw new Error(`${definition.id} did not finish ${physicalAction.verb}:${physicalAction.target}`);
}

function advance(definition: SegmentDefinition, state: WorldState, count = 1): WorldState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    const environment = definition.advance(next);
    expect(environment.failure).toBeUndefined();
    next = environment.world;
  }
  return next;
}

function act(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  return advance(definition, execute(definition, state, physicalAction));
}

function run(definition: SegmentDefinition, state: WorldState, actions: readonly PhysicalAction[]): WorldState {
  return actions.reduce((current, physicalAction) => act(definition, current, physicalAction), state);
}


describe("wind forge public contract", () => {
  it("exports all five encounters, isolated practice, one optional story, and observable finite state", () => {
    expect(FORGE_STAGE.id).toBe(4);
    expect(FORGE_STAGE.segments.map((item) => item.id)).toEqual(["04-1", "04-2", "04-3", "04-4", "04-5"]);
    expect(FORGE_STAGE.practice.id).toBe("04-practice");
    expect(FORGE_STAGE.story).toMatchObject({ afterSegment: "04-5", object: "04-5-handprints" });
    expect(Object.keys(FORGE_PUBLIC_CATALOG)).toEqual(["04-practice", "04-1", "04-2", "04-3", "04-4", "04-5"]);

    for (const definition of [FORGE_STAGE.practice, ...FORGE_STAGE.segments]) {
      const initial = definition.enter(null);
      expect(FORGE_PUBLIC_CATALOG[definition.id].map((item) => item.id)).toEqual(initial.visible);
      expect(new Set(initial.visible).size).toBe(initial.visible.length);
      expect(Object.values(initial.entities).every((item) => item.description.length > 0 && item.reach >= 0 && item.capacity >= 0)).toBe(true);
      expect(Object.values(initial.entities).some((item) =>
        Object.keys(item.properties).some((name) => /solution|actionId|commandSequence/i.test(name)),
      )).toBe(false);
    }

    const cooling = segment("04-3").enter(null);
    expect(cooling.entities["04-3-damper"].properties).toMatchObject({ open: true, cutoffState: "heat-on", handleVisible: true });
    expect(cooling.entities["04-3-grille"].properties).toMatchObject({
      passiveCooling: true,
      requiresHeatCutoff: true,
      visibleFunction: "cools-when-damper-closed",
    });
  });

  it("keeps practice state independent and preserves a selected route after observation movement", () => {
    const definition = FORGE_STAGE.practice;
    const fresh = definition.enter(null);
    let state = act(definition, fresh, action("turn", "forge-practice-splitter"));
    state = act(definition, state, action("move", "forge-practice-view"));
    expect(state.entities["forge-practice-splitter"].properties.route).toBe("east");
    expect(state.entities["forge-practice-west"].properties.fluttering).toBe(false);
    expect(state.entities["forge-practice-east"].properties.fluttering).toBe(true);
    expect(definition.enter(null)).toEqual(fresh);
  });
});

describe("continuous wind-forge StageRun", () => {

  it("cannot bypass gates or hazards by targeting another entity at or beyond the same coordinate", () => {
    const first = segment("04-1");
    expect(first.execute?.(first.enter(null), action("move", "04-1-door"))?.outcome).toBe("blocked");

    const second = segment("04-2");
    expect(second.execute?.(second.enter(null), action("move", "04-2-door"))?.outcome).toBe("blocked");

    const fourth = segment("04-4");
    for (const target of ["04-4-pin", "04-4-bridge-end", "04-4-net", "04-4-exit"]) {
      let state = fourth.enter(null);
      let outcome = "progress";
      for (let boundary = 0; boundary < 10 && outcome === "progress"; boundary += 1) {
        const result = fourth.execute?.(state, action("move", target));
        if (!result) throw new Error("04-4 has no executor");
        outcome = result.outcome;
        state = outcome === "progress" ? fourth.advance(result.world).world : result.world;
      }
      expect(outcome).toBe("failure");
      expect(state.actors.hero.location.x).toBe(5);
    }

    const fifth = segment("04-5");
    expect(fifth.execute?.(fifth.enter(null), action("move", "04-5-exit-anchor"))?.outcome).toBe("clarification");
  });
});

describe("04-1 opened furnace and cross-room state", () => {
  it("latches only a full physical pull, opens the supply, and retains that actual entity in the next room", () => {
    const definition = segment("04-1");
    const initial = definition.enter(null);
    const partial = advance(definition, execute(definition, initial, action("pull", "04-1-lever", { destination: "04-1-latch", amount: 0.5 })));
    expect(partial.entities["04-1-lever"].properties.pullFraction).toBe(0);
    expect(partial.entities["forge-furnace"].properties.open).toBe(false);

    let state = act(definition, initial, action("pull", "04-1-lever", { destination: "04-1-latch", amount: 1 }));
    expect(state.entities["forge-furnace"].properties).toMatchObject({ open: true, latched: true, suppliesWind: true, latchMark: "moon-fixed" });
    state = act(definition, state, action("move", "04-1-exit"));
    expect(definition.complete(state)).toBe(true);

    const next = segment("04-2").enter(state);
    expect(next.entities["forge-furnace"]).toEqual(state.entities["forge-furnace"]);
    expect(next.entities["04-1-lever"]).toEqual(state.entities["04-1-lever"]);
    expect(next.visible).not.toContain("04-1-lever");
    expect(next.entities["04-2-inlet"].properties.flowing).toBe(true);
    expect(next.actors.hero.location.region).toBe("04-2");
    expect(segment("04-2").execute?.(next, action("move", "04-1-start"))?.outcome).toBe("clarification");
  });

  it("does not advance time during physical execution itself", () => {
    const definition = segment("04-1");
    const initial = definition.enter(null);
    const executed = execute(definition, initial, action("pull", "04-1-lever", { destination: "04-1-latch" }));
    expect(executed.tick).toBe(initial.tick);
    expect(definition.advance(executed).world.tick).toBe(initial.tick + 1);
  });
});

describe("04-2 hammer transfer", () => {
  function stamp(definition: SegmentDefinition): WorldState {
    let state = act(definition, definition.enter(null), action("turn", "04-2-splitter"));
    state = advance(definition, state, 2);
    expect(state.entities["04-2-plate"].properties).toMatchObject({ stampHits: 3, starStamp: "complete" });
    return state;
  }

  it("supports stopping the hammer and using the main path", () => {
    const definition = segment("04-2");
    let state = stamp(definition);
    state = act(definition, state, action("turn", "04-2-splitter"));
    state = run(definition, state, [
      action("move", "04-2-anvil"),
      action("take", "04-2-plate"),
      action("move", "04-2-pedestal"),
      action("place", "04-2-plate", { destination: "04-2-pedestal" }),
      action("move", "04-2-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["04-2-hammer"].properties.powered).toBe(false);
    expect(state.entities["04-2-splitter"].properties.route).toBe("bypass");
  });

  it("keeps the hammer running while extracting with the tongs through the service route", () => {
    const definition = segment("04-2");
    let state = stamp(definition);
    state = run(definition, state, [
      action("hold", "04-2-plate", { instrument: "04-2-tongs" }),
      action("pull", "04-2-plate", { destination: "04-2-side-rail" }),
      action("move", "04-2-service"),
      action("take", "04-2-plate"),
      action("move", "04-2-pedestal"),
      action("place", "04-2-plate", { destination: "04-2-pedestal" }),
      action("move", "04-2-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["04-2-hammer"].properties.powered).toBe(true);
    expect(state.entities["04-2-plate"].properties.transportRoute).toBe("service");
  });

  it("fails from the actual partial stamp and live hammer range", () => {
    const definition = segment("04-2");
    expect(definition.execute?.(definition.enter(null), action("move", "04-2-exit"))?.outcome).toBe("blocked");
    let partial = act(definition, definition.enter(null), action("turn", "04-2-splitter"));
    partial = advance(definition, partial);
    expect(partial.entities["04-2-plate"].properties.stampHits).toBe(2);
    const wrongKey = definition.execute?.(partial, action("place", "04-2-plate", { destination: "04-2-pedestal" }));
    expect(wrongKey?.outcome).toBe("failure");
    expect(wrongKey?.reason).toContain("반쪽 문양");
    expect(definition.execute?.(partial, action("move", "04-2-anvil"))?.outcome).toBe("failure");
  });
});

describe("04-3 thermal contraction", () => {
  function finish(definition: SegmentDefinition, state: WorldState): WorldState {
    state = run(definition, state, [
      action("take", "04-3-key"),
      action("move", "04-3-lock"),
      action("place", "04-3-key", { destination: "04-3-lock" }),
      action("move", "04-3-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    return state;
  }

  it("actively cools and shrinks the key with the cold-air route", () => {
    const definition = segment("04-3");
    let state = act(definition, definition.enter(null), action("turn", "04-3-cooling-valve"));
    state = advance(definition, state, 2);
    expect(state.entities["04-3-key"].properties).toMatchObject({
      temperature: 0,
      heatState: "cool",
      width: 1,
      moonMark: true,
      coolingMethod: "cold-nozzle",
    });
    state = finish(definition, state);
    expect(state.entities["04-3-cooling-valve"].properties.route).toBe("cold-nozzle");
  });

  it("passively cools only after the visible cutoff damper closes", () => {
    const definition = segment("04-3");
    let state = run(definition, definition.enter(null), [
      action("hold", "04-3-key", { instrument: "04-3-tongs" }),
      action("pull", "04-3-key", { destination: "04-3-grille" }),
    ]);
    expect(state.entities["04-3-key"].properties.temperature).toBe(3);
    state = act(definition, state, action("close", "04-3-damper"));
    state = advance(definition, state, 2);
    expect(state.entities["04-3-key"].properties).toMatchObject({ temperature: 0, coolingMethod: "passive-grille", width: 1 });
    expect(state.entities["04-3-damper"].properties.cutoffState).toBe("heat-cut-off");
    state = act(definition, state, action("move", "04-3-grille"));
    finish(definition, state);
  });

  it("executes physical burn and too-wide failures instead of treating them as interpretation errors", () => {
    const definition = segment("04-3");
    const initial = definition.enter(null);
    expect(definition.execute?.(initial, action("move", "04-3-exit"))?.outcome).toBe("blocked");
    const burn = definition.execute?.(initial, action("take", "04-3-key"));
    expect(burn?.outcome).toBe("failure");
    expect(burn?.reason).toContain("화상");

    const held = execute(definition, initial, action("hold", "04-3-key", { instrument: "04-3-tongs" }));
    const jammed = definition.execute?.(held, action("place", "04-3-key", { destination: "04-3-lock" }));
    expect(jammed?.outcome).toBe("failure");
    expect(jammed?.world.entities["04-3-key"].properties.jammedOutline).toBe("too-wide");
  });
});

describe("04-4 persistent pressure and bridge", () => {
  it("persists the pressure room, routing room, bridge approach, and bridge edge instead of teleporting", () => {
    const definition = segment("04-4");
    let state = definition.enter(null);
    const toApproach = action("move", "04-4-approach");
    const routingBoundary = definition.execute?.(state, toApproach);
    expect(routingBoundary?.outcome).toBe("progress");
    expect(routingBoundary?.world.actors.hero.location.x).toBe(3);
    expect(JSON.parse(JSON.stringify(routingBoundary?.world))).toEqual(routingBoundary?.world);
    state = definition.advance(routingBoundary!.world).world;
    const approachBoundary = definition.execute?.(state, toApproach);
    expect(approachBoundary?.outcome).toBe("done");
    expect(approachBoundary?.world.actors.hero.location.x).toBe(5);

    state = act(definition, definition.enter(null), action("turn", "04-4-pressure", { amount: 1 }));
    state = execute(definition, state, toApproach);
    state = act(definition, state, action("open", "04-4-vent"));
    const ontoBridge = definition.execute?.(state, action("move", "04-4-exit"));
    expect(ontoBridge?.outcome).toBe("progress");
    expect(ontoBridge?.world.actors.hero.location.x).toBe(7);
    const restored = JSON.parse(JSON.stringify(ontoBridge!.world)) as WorldState;
    expect(definition.execute?.(restored, action("move", "04-4-exit"))?.outcome).toBe("done");
  });

  it("releases the pin at sufficient pressure, then lowers the cause with the local vent", () => {
    const definition = segment("04-4");
    let state = act(definition, definition.enter(null), action("turn", "04-4-pressure", { amount: 1 }));
    expect(state.entities["04-4-main-pipe"].properties).toMatchObject({
      through: "04-4-splitter",
      zonePath: "upstream-pressure-room|routing-room|bridge-room",
    });
    expect(state.entities["04-4-splitter"].properties).toMatchObject({
      route: "bridge",
      connectedFrom: "04-4-main-pipe",
      connectedTo: "04-4-pin|04-4-bridge",
      zone: "routing-room",
    });
    expect(state.entities["04-4-pin"].properties.released).toBe(true);
    expect(state.entities["04-4-bridge"].properties.stability).toBe("shaking");
    state = act(definition, state, action("move", "04-4-approach"));
    expect(definition.execute?.(state, action("turn", "04-4-pressure"))?.outcome).toBe("clarification");
    state = run(definition, state, [
      action("open", "04-4-vent"),
      action("move", "04-4-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["04-4-pressure"].properties.pressure).toBe(1);
    expect(state.entities["04-4-main-pipe"].properties.effectivePressure).toBe(0);
    expect(state.entities["04-4-bridge"].properties.stability).toBe("wind-lowered");
  });

  it("leaves excessive wind running but mechanically fixes the bridge with a real chain relation", () => {
    const definition = segment("04-4");
    let state = act(definition, definition.enter(null), action("turn", "04-4-pressure", { amount: 2 }));
    state = run(definition, state, [
      action("move", "04-4-approach"),
      action("tie", "04-4-bridge-end", { destination: "04-4-anvil-weight", instrument: "04-4-chain" }),
      action("move", "04-4-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["04-4-main-pipe"].properties.effectivePressure).toBe(2);
    expect(state.entities["04-4-bridge"].properties.stability).toBe("chain-fixed");
    expect(state.entities["04-4-bridge-end"].properties.tiedTo).toBe("04-4-anvil-weight");
  });

  it("cannot teleport past an unextended or unstable bridge and resumes deterministically", () => {
    const definition = segment("04-4");
    const initial = definition.enter(null);
    let approach = definition.execute?.(initial, action("move", "04-4-exit"));
    expect(approach?.outcome).toBe("progress");
    approach = definition.execute?.(definition.advance(approach!.world).world, action("move", "04-4-exit"));
    expect(approach?.outcome).toBe("progress");
    expect(definition.execute?.(definition.advance(approach!.world).world, action("move", "04-4-exit"))?.outcome).toBe("failure");
    const windy = act(definition, initial, action("turn", "04-4-pressure", { amount: 2 }));
    let windyApproach = definition.execute?.(windy, action("move", "04-4-exit"));
    windyApproach = definition.execute?.(definition.advance(windyApproach!.world).world, action("move", "04-4-exit"));
    expect(definition.execute?.(definition.advance(windyApproach!.world).world, action("move", "04-4-exit"))?.outcome).toBe("failure");

    const restored = JSON.parse(JSON.stringify(windy)) as WorldState;
    expect(definition.advance(restored)).toEqual(definition.advance(windy));
  });
});

describe("04-5 moon-wind bell", () => {
  function stampAndCool(definition: SegmentDefinition, state: WorldState): WorldState {
    state = act(definition, state, action("turn", "04-5-selector"));
    state = advance(definition, state, 2);
    expect(state.entities["04-5-strip"].properties).toMatchObject({ stampHits: 3, form: "bell", moonStamp: "complete" });
    state = act(definition, state, action("turn", "04-5-selector"));
    state = advance(definition, state, 2);
    expect(state.entities["04-5-strip"].properties).toMatchObject({ temperature: 0, cooled: true, shape: "rigid" });
    return state;
  }

  function liftAndFinish(definition: SegmentDefinition, state: WorldState): WorldState {
    if (state.actors.hero.location.x !== state.entities["04-5-carrier"].location.x) {
      state = act(definition, state, action("move", "04-5-carrier"));
    }
    state = act(definition, state, action("board", "04-5-carrier"));
    state = act(definition, state, action("turn", "04-5-selector"));
    expect(state.entities["04-5-carrier"].properties.level).toBe("exit");
    state = run(definition, state, [
      action("tie", "04-5-carrier-end", { destination: "04-5-exit-anchor", instrument: "04-5-hook-chain" }),
      action("dismount", "04-5-carrier", { destination: "04-5-exit" }),
      action("take", "04-5-strip"),
      action("place", "04-5-strip", { destination: "04-5-arch" }),
    ]);
    expect(definition.complete(state)).toBe(true);
    return state;
  }

  it("finishes at the fixed anvil, preserves the result, then transports one cooled bell", () => {
    const definition = segment("04-5");
    let state = act(definition, definition.enter(null), action("move", "04-5-selector"));
    state = stampAndCool(definition, state);
    state = run(definition, state, [
      action("take", "04-5-strip"),
      action("move", "04-5-carrier"),
      action("place", "04-5-strip", { destination: "04-5-carrier" }),
    ]);
    state = liftAndFinish(definition, state);
    expect(state.entities["04-5-strip"].properties.formedAt).toBe("fixed-anvil");
    expect(state.entities["04-5-hammer"].properties.station).toBe("fixed");
  });

  it("moves the frame and tools to the carrier work station before forming the bell", () => {
    const definition = segment("04-5");
    let state = run(definition, definition.enter(null), [
      action("take", "04-5-frame"),
      action("move", "04-5-carrier"),
      action("place", "04-5-frame", { destination: "04-5-carrier" }),
      action("move", "04-5-fixed-anvil"),
      action("hold", "04-5-strip", { instrument: "04-5-tongs" }),
      action("pull", "04-5-strip", { destination: "04-5-frame" }),
      action("turn", "04-5-hammer"),
    ]);
    state = stampAndCool(definition, state);
    state = act(definition, state, action("turn", "04-5-hammer"));
    state = liftAndFinish(definition, state);
    expect(state.entities["04-5-strip"].properties.formedAt).toBe("carrier-station");
    expect(state.entities["04-5-frame"].properties.lockedToCarrier).toBe(true);
    expect(state.entities["04-5-hammer"].properties.station).toBe("safe");
  });

  it("physically dents an uncooled bell on lift and sags a cooled bell when reheated", () => {
    const definition = segment("04-5");
    expect(definition.execute?.(definition.enter(null), action("move", "04-5-exit"))?.outcome).toBe("clarification");
    let early = run(definition, definition.enter(null), [
      action("take", "04-5-frame"),
      action("move", "04-5-carrier"),
      action("place", "04-5-frame", { destination: "04-5-carrier" }),
      action("move", "04-5-fixed-anvil"),
      action("hold", "04-5-strip", { instrument: "04-5-tongs" }),
      action("pull", "04-5-strip", { destination: "04-5-frame" }),
    ]);
    const lift = definition.execute?.(early, action("turn", "04-5-selector", { amount: 3 }));
    expect(lift?.outcome).toBe("done");
    const dented = definition.advance(lift!.world);
    expect(dented.failure).toContain("찌그러졌어요");
    expect(dented.world.entities["04-5-strip"].properties.shape).toBe("dented");

    let cooled = act(definition, definition.enter(null), action("move", "04-5-selector"));
    cooled = stampAndCool(definition, cooled);
    const opened = execute(definition, cooled, action("open", "04-5-heater-damper"));
    const sagged = definition.advance(opened);
    expect(sagged.failure).toContain("다시 예열");
    expect(sagged.world.entities["04-5-strip"].properties).toMatchObject({ shape: "sagging", moonStamp: "drooped" });
  });

  it("replays the exact same saved physical state deterministically", () => {
    const definition = segment("04-5");
    let state = act(definition, definition.enter(null), action("move", "04-5-selector"));
    state = act(definition, state, action("turn", "04-5-selector"));
    const restored = JSON.parse(JSON.stringify(state)) as WorldState;
    expect(definition.advance(restored)).toEqual(definition.advance(state));
  });
});
