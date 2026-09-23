import { describe, expect, it } from "vitest";
import { STOREHOUSE_PUBLIC_CATALOG, STOREHOUSE_STAGE } from "./fixtures/campaign-worlds/storehouse";
import { stageDynamics, type SegmentDefinition } from "../src/campaign/level";
import { acknowledgePresentation, advanceStage, createStageRun, departStage, writeStageProgram, type StageRun } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function segment(id: string): SegmentDefinition {
  const found = STOREHOUSE_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing segment ${id}`);
  return found;
}

function execute(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  const step = definition.execute?.(state, physicalAction);
  if (!step) throw new Error(`${definition.id} has no executor`);
  expect(step.outcome, step.reason).toBe("done");
  return step.world;
}

function act(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  const executed = execute(definition, state, physicalAction);
  const advanced = definition.advance(executed);
  expect(advanced.failure).toBeUndefined();
  return advanced.world;
}

function run(definition: SegmentDefinition, state: WorldState, actions: readonly PhysicalAction[]): WorldState {
  return actions.reduce((current, physicalAction) => act(definition, current, physicalAction), state);
}

function assertUniquePossession(state: WorldState): void {
  const carried = new Set(state.actors.hero.carrying);
  expect(carried.size).toBe(state.actors.hero.carrying.length);
  for (const item of Object.values(state.entities)) {
    if (item.parent === "hero") expect(carried.has(item.id), `${item.id} missing from carrying`).toBe(true);
    if (carried.has(item.id)) {
      expect(item.parent).toBe("hero");
      expect(item.location).toEqual(state.actors.hero.location);
    }
  }
}

function saved(runState: StageRun): StageRun {
  const restored = parseStageRun(JSON.parse(JSON.stringify(runState)));
  expect(restored).not.toBeNull();
  assertUniquePossession(restored!.world);
  return restored!;
}

function instruction(id: string, region: string, children: ProgramNode[]): InstructionProgram {
  return {
    version: 2,
    id,
    text: `${region} 공개 물리 절차`,
    model: "typed-regression",
    scope: { stageId: 6, region },
    guard: false,
    body: { kind: "sequence", children },
  };
}


function openLowerDoor(definition: SegmentDefinition, state: WorldState): WorldState {
  return run(definition, state, [
    action("take", "06-5-counterweight"),
    action("place", "06-5-counterweight", { destination: "06-5-drive-socket" }),
    action("take", "06-5-key"),
    action("move", "06-5-lower-lock"),
    action("place", "06-5-key", { destination: "06-5-lower-lock" }),
    action("turn", "06-5-key"),
    action("take", "06-5-key"),
    action("move", "06-5-start"),
    action("release", "06-5-key"),
  ]);
}

function finishUpperInventory(definition: SegmentDefinition, state: WorldState): WorldState {
  state = run(definition, state, [
    action("move", "06-5-lamp-slot-a"),
    action("place", "06-5-mirror-a", { destination: "06-5-mirror-slot-a" }),
    action("place", "06-5-mirror-b", { destination: "06-5-mirror-slot-b" }),
    action("move", "06-5-upper-shelf"),
    action("take", "06-5-lantern-a"),
    action("move", "06-5-lamp-slot-a"),
    action("place", "06-5-lantern-a", { destination: "06-5-lamp-slot-a" }),
    action("move", "06-5-upper-shelf"),
    action("take", "06-5-lantern-b"),
    action("move", "06-5-lamp-slot-b"),
    action("place", "06-5-lantern-b", { destination: "06-5-lamp-slot-b" }),
    action("move", "06-5-exit-locker"),
    action("place", "06-5-key", { destination: "06-5-exit-locker" }),
    action("turn", "06-5-key"),
    action("move", "06-5-exit"),
  ]);
  expect(definition.complete(state)).toBe(true);
  return state;
}

describe("lantern storehouse public contract", () => {
  it("exports isolated practice, all five encounters, story, public affordances, and visible finite inventory", () => {
    expect(STOREHOUSE_STAGE).toMatchObject({ id: 6, title: "등불 보관소" });
    expect(STOREHOUSE_STAGE.segments.map((item) => item.id)).toEqual(["06-1", "06-2", "06-3", "06-4", "06-5"]);
    expect(STOREHOUSE_STAGE.practice.id).toBe("06-practice");
    expect(STOREHOUSE_STAGE.story).toMatchObject({ afterSegment: "06-4", object: "06-4-teacups" });
    expect(Object.keys(STOREHOUSE_PUBLIC_CATALOG)).toEqual(["06-practice", "06-1", "06-2", "06-3", "06-4", "06-5"]);

    for (const definition of [STOREHOUSE_STAGE.practice, ...STOREHOUSE_STAGE.segments]) {
      const initial = definition.enter(null);
      expect(STOREHOUSE_PUBLIC_CATALOG[definition.id].map((item) => item.id)).toEqual(initial.visible);
      expect(new Set(initial.visible).size).toBe(initial.visible.length);
      expect(Object.values(initial.entities).every((item) => typeof item.properties.kind === "string" && item.reach >= 0)).toBe(true);
      expect(Object.values(initial.entities).some((item) => Object.keys(item.properties).some((name) => /solution|actionId|successFlag/i.test(name)))).toBe(false);
      assertUniquePossession(initial);
    }

    const final = segment("06-5").enter(null);
    expect(final.entities["06-5-stock"].properties).toMatchObject({ lanterns: 2, mirrors: 2, brassKeys: 1, counterweights: 1 });
    expect(final.entities["06-5-elevator"].properties).toMatchObject({ loadMarks: "2/2", braked: true, level: "lower" });
    expect(final.entities["06-5-drive-socket"].properties.connectedTo).toBe("elevator|cargo-basket");
  });

  it("keeps practice independent and proves key recovery from an actual lock parent", () => {
    const definition = STOREHOUSE_STAGE.practice;
    const fresh = definition.enter(null);
    let state = run(definition, fresh, [
      action("take", "06-practice-key"),
      action("move", "06-practice-lock"),
      action("place", "06-practice-key", { destination: "06-practice-lock" }),
      action("turn", "06-practice-key"),
      action("take", "06-practice-key"),
      action("move", "06-practice-return"),
      action("place", "06-practice-key", { destination: "06-practice-return" }),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(state.entities["06-practice-key"].parent).toBe("06-practice-return");
    expect(definition.enter(null)).toEqual(fresh);
  });
});

describe("finite resource alternatives and recovery", () => {
  it("06-1 reuses one key and cannot cross either closed physical gate", () => {
    const definition = segment("06-1");
    expect(definition.execute?.(definition.enter(null), action("move", "06-1-exit"))?.outcome).toBe("blocked");
    let state = run(definition, definition.enter(null), [
      action("take", "06-1-key"), action("move", "06-1-lock-a"), action("place", "06-1-key", { destination: "06-1-lock-a" }), action("turn", "06-1-key"),
      action("take", "06-1-key"), action("move", "06-1-lock-b"), action("place", "06-1-key", { destination: "06-1-lock-b" }), action("turn", "06-1-key"), action("move", "06-1-exit"),
    ]);
    expect(definition.complete(state)).toBe(true);
    expect(Object.values(state.entities).filter((item) => item.properties.tool === "brass-key")).toHaveLength(1);
    expect(state.entities["06-1-key"].parent).toBe("06-1-lock-b");
  });

  it("06-2 supports a carried light route and a physically different wall-hook relay", () => {
    const definition = segment("06-2");
    let carried = run(definition, definition.enter(null), [
      action("take", "06-2-lantern-a"), action("move", "06-2-sensor-a"), action("move", "06-2-sensor-b"), action("move", "06-2-sensor-c"),
      action("move", "06-2-pedestal"), action("place", "06-2-lantern-a", { destination: "06-2-pedestal" }), action("move", "06-2-exit"),
    ]);
    expect(definition.complete(carried)).toBe(true);
    expect(carried.entities["06-2-lantern-a"].properties.usedWallHook).not.toBe(true);

    let relay = run(definition, definition.enter(null), [
      action("take", "06-2-lantern-a"), action("move", "06-2-hook-a"), action("place", "06-2-lantern-a", { destination: "06-2-hook-a" }),
      action("move", "06-2-start"), action("take", "06-2-lantern-b"), action("move", "06-2-hook-b"), action("place", "06-2-lantern-b", { destination: "06-2-hook-b" }),
      action("move", "06-2-hook-a"), action("take", "06-2-lantern-a"), action("move", "06-2-hook-c"), action("place", "06-2-lantern-a", { destination: "06-2-hook-c" }),
      action("move", "06-2-hook-b"), action("take", "06-2-lantern-b"), action("move", "06-2-pedestal"), action("place", "06-2-lantern-b", { destination: "06-2-pedestal" }), action("move", "06-2-exit"),
    ]);
    expect(definition.complete(relay)).toBe(true);
    expect(relay.entities["06-2-lantern-a"].properties.usedWallHook).toBe(true);
    expect(relay.entities["06-2-lantern-b"].properties.usedWallHook).toBe(true);
  });

  it("06-3 uses either the one-item basket or two footway trips without creating a fourth item", () => {
    const definition = segment("06-3");
    let basket = run(definition, definition.enter(null), [
      action("take", "06-3-rope-loop"), action("place", "06-3-rope-loop", { destination: "06-3-basket" }), action("turn", "06-3-basket-winch"),
      action("take", "06-3-striker"), action("take", "06-3-lens"), action("move", "06-3-destination"), action("place", "06-3-lens", { destination: "06-3-lens-slot" }),
      action("place", "06-3-striker", { destination: "06-3-ignition-slot" }), action("turn", "06-3-striker"), action("take", "06-3-rope-loop"),
      action("place", "06-3-rope-loop", { destination: "06-3-rope-handle" }), action("turn", "06-3-rope-loop"), action("move", "06-3-exit"),
    ]);
    expect(definition.complete(basket)).toBe(true);
    expect(basket.entities["06-3-rope-loop"].location.x).toBe(7);

    let trips = run(definition, definition.enter(null), [
      action("take", "06-3-striker"), action("take", "06-3-lens"), action("move", "06-3-destination"),
      action("place", "06-3-lens", { destination: "06-3-lens-slot" }), action("place", "06-3-striker", { destination: "06-3-ignition-slot" }), action("turn", "06-3-striker"),
      action("move", "06-3-start"), action("take", "06-3-rope-loop"), action("move", "06-3-destination"), action("place", "06-3-rope-loop", { destination: "06-3-rope-handle" }), action("turn", "06-3-rope-loop"), action("move", "06-3-exit"),
    ]);
    expect(definition.complete(trips)).toBe(true);
    expect(trips.entities["06-3-basket"].properties.level).toBe("start");
    expect(Object.values(trips.entities).filter((item) => ["striker", "lens", "rope-loop"].includes(String(item.properties.tool)))).toHaveLength(3);
  });

  it("keeps publicly impossible inventory requests as free clarification with no world mutation", () => {
    const definition = segment("06-3");
    let state = run(definition, definition.enter(null), [
      action("take", "06-3-rope-loop"),
      action("place", "06-3-rope-loop", { destination: "06-3-basket" }),
      action("take", "06-3-lens"),
    ]);
    const before = structuredClone(state);
    const fullBasket = definition.execute?.(state, action("place", "06-3-lens", { destination: "06-3-basket" }));
    expect(fullBasket?.outcome).toBe("clarification");
    expect(fullBasket?.world).toEqual(before);

    const final = segment("06-5");
    let occupiedHand = run(final, final.enter(null), [
      action("take", "06-5-lantern-a"),
      action("take", "06-5-mirror-a"),
      action("take", "06-5-mirror-b"),
    ]);
    const thirdSmall = final.execute?.(occupiedHand, action("take", "06-5-key"));
    expect(thirdSmall?.outcome).toBe("clarification");

    let freeHand = run(final, final.enter(null), [
      action("take", "06-5-mirror-a"),
      action("take", "06-5-mirror-b"),
      action("take", "06-5-key"),
    ]);
    expect(freeHand.actors.hero.carrying).toEqual(expect.arrayContaining(["letter", "06-5-mirror-a", "06-5-mirror-b", "06-5-key"]));
    expect(freeHand.entities["06-5-inventory"].properties).toMatchObject({
      hand: "06-5-key",
      hooks: "06-5-mirror-a|06-5-mirror-b",
      handUsed: true,
      hooksUsed: 2,
    });
  });

  it("06-4 allows full recovery or leaving one real mirror in the shadow-bridge slot", () => {
    const definition = segment("06-4");
    const prefix = [
      action("take", "06-4-lantern"), action("move", "06-4-light-pedestal"), action("place", "06-4-lantern", { destination: "06-4-light-pedestal" }), action("move", "06-4-light-chest"), action("open", "06-4-light-chest"),
      action("take", "06-4-lantern"), action("move", "06-4-start"), action("take", "06-4-mirror-a"), action("move", "06-4-shadow-slot"), action("place", "06-4-mirror-a", { destination: "06-4-shadow-slot" }), action("move", "06-4-shadow-chest"), action("open", "06-4-shadow-chest"),
    ];
    let recovered = run(definition, definition.enter(null), [
      ...prefix, action("take", "06-4-mirror-a"), action("move", "06-4-alarm-pedestal"), action("place", "06-4-lantern", { destination: "06-4-alarm-pedestal" }),
      action("move", "06-4-alarm-slot"), action("place", "06-4-mirror-a", { destination: "06-4-alarm-slot" }), action("move", "06-4-alarm-chest"), action("open", "06-4-alarm-chest"), action("move", "06-4-exit"),
    ]);
    expect(definition.complete(recovered)).toBe(true);
    expect(recovered.entities["06-4-shadow-bridge"].properties.visible).toBe(false);

    let shortcut = run(definition, definition.enter(null), [
      ...prefix, action("move", "06-4-alarm-pedestal"), action("place", "06-4-lantern", { destination: "06-4-alarm-pedestal" }), action("move", "06-4-start"),
      action("take", "06-4-mirror-b"), action("move", "06-4-alarm-slot"), action("place", "06-4-mirror-b", { destination: "06-4-alarm-slot" }), action("move", "06-4-alarm-chest"), action("open", "06-4-alarm-chest"), action("move", "06-4-exit"),
    ]);
    expect(definition.complete(shortcut)).toBe(true);
    expect(shortcut.entities["06-4-mirror-a"].parent).toBe("06-4-shadow-slot");

    const alarmed = act(definition, act(definition, shortcut, action("move", "06-4-alarm-slot")), action("turn", "06-4-mirror-b"));
    expect(alarmed.entities["06-4-beam-map"].properties.path).toBe("lantern>mirror>alarm-eye");
    expect(alarmed.entities["06-4-alarm-shutter"].properties.open).toBe(false);
  });

  it("06-5 transports the same finite load by elevator or cargo winch and requires simultaneous beam parents", () => {
    const definition = segment("06-5");
    let elevator = openLowerDoor(definition, definition.enter(null));
    for (const lantern of ["06-5-lantern-a", "06-5-lantern-b"]) {
      elevator = run(definition, elevator, [
        action("take", lantern), action("move", "06-5-elevator"), action("place", lantern, { destination: "06-5-elevator" }), action("board", "06-5-elevator"),
        action("turn", "06-5-elevator-lever"), action("dismount", "06-5-elevator", { destination: "06-5-upper-dock" }), action("take", lantern), action("place", lantern, { destination: "06-5-upper-shelf" }),
        action("board", "06-5-elevator"), action("turn", "06-5-elevator-lever"), action("dismount", "06-5-elevator", { destination: "06-5-lower-dock" }), action("move", "06-5-start"),
      ]);
    }
    elevator = run(definition, elevator, [
      action("take", "06-5-mirror-a"), action("take", "06-5-mirror-b"), action("take", "06-5-key"), action("move", "06-5-elevator"), action("board", "06-5-elevator"),
      action("turn", "06-5-elevator-lever"), action("dismount", "06-5-elevator", { destination: "06-5-upper-dock" }),
    ]);
    elevator = finishUpperInventory(definition, elevator);
    expect(elevator.entities["06-5-lantern-a"].properties.transportRoute).toBe("elevator");

    let winch = openLowerDoor(definition, definition.enter(null));
    for (const lantern of ["06-5-lantern-a", "06-5-lantern-b"]) {
      winch = run(definition, winch, [
        action("take", lantern), action("move", "06-5-cargo-basket"), action("place", lantern, { destination: "06-5-cargo-basket" }), action("turn", "06-5-lower-winch"),
      ]);
      if (lantern === "06-5-lantern-a") winch = act(definition, winch, action("turn", "06-5-lower-winch"));
      winch = act(definition, winch, action("move", "06-5-start"));
    }
    winch = run(definition, winch, [
      action("take", "06-5-mirror-a"), action("take", "06-5-mirror-b"), action("take", "06-5-key"), action("move", "06-5-elevator"), action("board", "06-5-elevator"),
      action("turn", "06-5-elevator-lever"), action("dismount", "06-5-elevator", { destination: "06-5-upper-dock" }),
    ]);
    winch = finishUpperInventory(definition, winch);
    expect(winch.entities["06-5-lantern-a"].properties.transportRoute).toBe("cargo-winch");
    expect(winch.entities["06-5-lantern-b"].properties.transportRoute).toBe("cargo-winch");
    expect(winch.entities["06-5-beam-map"].properties.path).toContain("receiver-a");
  });

  it("stops a visible elevator overcapacity plan without granting a free edit", () => {
    const definition = segment("06-5");
    let runState = createStageRun("storehouse-overload", definition.enter(null));
    runState = writeStageProgram(runState, instruction("overload", "06-5", [
        action("take", "06-5-counterweight"), action("place", "06-5-counterweight", { destination: "06-5-drive-socket" }),
        action("take", "06-5-key"), action("move", "06-5-lower-lock"), action("place", "06-5-key", { destination: "06-5-lower-lock" }), action("turn", "06-5-key"),
        action("move", "06-5-start"), action("take", "06-5-lantern-a"), action("move", "06-5-elevator"), action("place", "06-5-lantern-a", { destination: "06-5-elevator" }),
        action("move", "06-5-start"), action("take", "06-5-lantern-b"), action("move", "06-5-elevator"), action("place", "06-5-lantern-b", { destination: "06-5-elevator" }), action("board", "06-5-elevator"),
      ]));
    runState = departStage(runState);
    for (let step = 0; step < 40 && (runState.phase === "running" || runState.phase === "waiting"); step += 1) runState = advanceStage(acknowledgePresentation(runState), stageDynamics(STOREHOUSE_STAGE));
    expect(runState.world.attempt).toBe(1);
    expect(runState.phase).toBe("blocked");
    expect(runState.notebook).toMatchObject({ deaths: 0, canWrite: false, canDelete: false });
    expect(runState.events.at(-1)?.outcome).toBe("clarification");
    expect(runState.world.entities["06-5-counterweight"].parent).toBe("06-5-drive-socket");
    expect(runState.world.entities["06-5-lantern-a"].parent).toBe("06-5-elevator");
    expect(runState.world.entities["06-5-lantern-b"].parent).toBe("06-5-elevator");
    expect(runState.world.entities["06-5-elevator"].properties).toMatchObject({ level: "lower", braked: true });
    expect(saved(runState)).toEqual(runState);
  });

  it("keeps a real closing-shutter collision visible and grants one post-death write", () => {
    const definition = segment("06-2");
    let runState = createStageRun("storehouse-shutter", definition.enter(null));
    runState = writeStageProgram(runState, instruction("shutter-failure", "06-2", [
        action("take", "06-2-lantern-a"), action("move", "06-2-hook-a"), action("place", "06-2-lantern-a", { destination: "06-2-hook-a" }),
        action("move", "06-2-start"), action("take", "06-2-lantern-b"), action("move", "06-2-hook-b"), action("place", "06-2-lantern-b", { destination: "06-2-hook-b" }),
        action("move", "06-2-hook-a"), action("take", "06-2-lantern-a"), action("move", "06-2-hook-c"), action("place", "06-2-lantern-a", { destination: "06-2-hook-c" }),
        action("move", "06-2-hook-b"), action("take", "06-2-lantern-b"), action("move", "06-2-sensor-c"),
        action("move", "06-2-start"),
      ]));
    runState = departStage(runState);
    for (let step = 0; step < 20 && (runState.phase === "running" || runState.phase === "waiting"); step += 1) runState = advanceStage(acknowledgePresentation(runState), stageDynamics(STOREHOUSE_STAGE));
    expect(runState.world.attempt).toBe(1);
    expect(runState.phase).toBe("failed");
    expect(runState.notebook).toMatchObject({ deaths: 1, canWrite: true, canDelete: true });
    expect(runState.events.some((event) => event.outcome === "failure" && event.reason.includes("셔터"))).toBe(true);
  });
});
