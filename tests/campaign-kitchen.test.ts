import { describe, expect, it } from "vitest";
import { KITCHEN_PUBLIC_CATALOG, KITCHEN_STAGE } from "./fixtures/campaign-worlds/kitchen";
import { stageDynamics } from "../src/campaign/level";
import type { EnvironmentStep } from "../src/campaign/run";
import { acknowledgePresentation, advanceStage, createStageRun, departStage } from "../src/campaign/run";
import type { SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import type { InstructionProgram, PhysicalAction, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<PhysicalAction> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function segment(id: string): SegmentDefinition {
  const found = KITCHEN_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing segment ${id}`);
  return found;
}

function execute(definition: SegmentDefinition, state: WorldState, physicalAction: PhysicalAction): WorldState {
  const result = definition.execute?.(state, physicalAction);
  if (!result) throw new Error(`${definition.id} has no executor`);
  expect(result.outcome, result.reason).toBe("done");
  return result.world;
}

function advance(definition: SegmentDefinition, state: WorldState, count = 1): WorldState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    const step: EnvironmentStep = definition.advance(next);
    expect(step.failure).toBeUndefined();
    next = step.world;
  }
  return next;
}

function executeProgram(definition: SegmentDefinition, state: WorldState, program: readonly PhysicalAction[]): WorldState {
  return program.reduce((current, physicalAction) => execute(definition, current, physicalAction), state);
}

describe("clockwork kitchen stage definition", () => {
  it("exports five encounters, a separate practice, story, and finite public catalogs", () => {
    expect(KITCHEN_STAGE.id).toBe(3);
    expect(KITCHEN_STAGE.segments.map((item) => item.id)).toEqual(["03-1", "03-2", "03-3", "03-4", "03-5"]);
    expect(KITCHEN_STAGE.practice.id).toBe("03-practice");
    expect(KITCHEN_STAGE.story).toMatchObject({ afterSegment: "03-3", object: "03-3-napkin" });
    expect(Object.keys(KITCHEN_PUBLIC_CATALOG)).toEqual(["03-practice", "03-1", "03-2", "03-3", "03-4", "03-5"]);

    for (const definition of [KITCHEN_STAGE.practice, ...KITCHEN_STAGE.segments]) {
      const initial = definition.enter(null);
      const publicIds = KITCHEN_PUBLIC_CATALOG[definition.id].map((item) => item.id);
      expect(publicIds).toEqual(initial.visible);
      expect(new Set(publicIds).size).toBe(publicIds.length);
      expect(Object.values(initial.entities).every((item) => item.description.length > 0 && item.reach >= 0 && item.capacity >= 0)).toBe(true);
      expect(Object.values(initial.entities).every((item) => typeof item.properties.kind === "string")).toBe(true);
      expect(Object.values(initial.entities).some((item) => "solution" in item.properties || "actionId" in item.properties)).toBe(false);
    }
  });

  it("keeps practice cyclic and permits the cupboard only at the visible left-hook event", () => {
    const definition = KITCHEN_STAGE.practice;
    const initial = definition.enter(null);
    const blocked = definition.execute?.(initial, action("move", "practice-exit"));
    expect(blocked?.outcome).toBe("blocked");
    const opened = advance(definition, initial, 2);
    expect(opened.entities["practice-pendulum"].properties.phase).toBe("left");
    expect(opened.entities["practice-door"].properties.open).toBe(true);
    const crossed = execute(definition, opened, action("move", "practice-exit"));
    expect(definition.complete(crossed)).toBe(true);
    const closedBehind = definition.advance(crossed).world;
    expect(closedBehind.entities["practice-door"].properties.open).toBe(false);
    expect(definition.complete(closedBehind)).toBe(true);
    expect(advance(definition, opened, 2).entities["practice-door"].properties.open).toBe(false);
  });

  it("03-1 has only the safe wait pathway and replays the same cycle from the same snapshot", () => {
    const definition = segment("03-1");
    const initial = definition.enter(null);
    const early = definition.execute?.(initial, action("move", "03-1-exit"));
    expect(early?.outcome).toBe("failure");
    expect(early?.world.entities.letter.properties.dry).toBe(false);
    expect(definition.execute?.(initial, action("move", "03-1-pressure-dial"))?.outcome).toBe("failure");

    const first = definition.advance(initial);
    const replay = definition.advance(structuredClone(initial));
    expect(replay).toEqual(first);
    const safe = advance(definition, initial, 2);
    expect(safe.entities["03-1-steam-pipe"].properties.active).toBe(false);
    const crossed = execute(definition, safe, action("move", "03-1-passage"));
    expect(definition.complete(crossed)).toBe(true);
  });

  it("runs a real wait-then-action program without consuming a tick for an already-satisfied wait", () => {
    const definition = segment("03-1");
    const program: InstructionProgram = {
      version: 2,
      id: "steam-safe-crossing",
      text: "김이 멎을 때까지 기다린 뒤 통로를 지나가.",
      model: "fixture",
      scope: { stageId: 3, region: "03-1" },
      guard: false,
      body: {
        kind: "sequence",
        children: [
          { kind: "wait", until: { kind: "property", entity: "03-1-steam-pipe", property: "active", comparison: "eq", value: false, source: "visible" } },
          action("move", "03-1-passage"),
        ],
      },
    };
    let run = createStageRun("kitchen-runtime", definition.enter(null));
    run.notebook = writeProgram(run.notebook, program);
    run = departStage(run);
    for (let step = 0; step < 8 && !run.clearedSegments.includes("03-1"); step += 1) run = advanceStage(acknowledgePresentation(run), stageDynamics(KITCHEN_STAGE));
    expect(run.clearedSegments).toContain("03-1");
    expect(run.world.segmentId).toBe("03-2");
    expect(run.events.some((item) => item.target === "03-1-steam-pipe" && item.outcome === "observed")).toBe(true);
  });

  it("03-2 supports away-event crossing and stop-slot service routing with distinct causes", () => {
    const definition = segment("03-2");
    const initial = definition.enter(null);
    const struck = definition.execute?.(initial, action("push", "03-2-tray", { destination: "03-2-exit-stand" }));
    expect(struck?.outcome).toBe("failure");
    expect(struck?.world.entities["03-2-tray"].properties.struck).toBe(true);
    expect(definition.execute?.(initial, action("push", "03-2-tray", { destination: "03-2-service-lane" }))?.outcome).toBe("clarification");

    let routeA = advance(definition, initial, 2);
    routeA = execute(definition, routeA, action("push", "03-2-tray", { destination: "03-2-exit-stand" }));
    expect(definition.complete(routeA)).toBe(true);
    expect(routeA.entities["03-2-tray"].properties.route).toBe("central-exit");
    expect(routeA.entities["03-2-claw"].properties.stopped).toBe(false);

    let routeB = definition.enter(null);
    routeB = executeProgram(definition, routeB, [
      action("push", "03-2-tray", { destination: "03-2-stop-slot" }),
      action("pull", "03-2-tray", { destination: "03-2-side-chute" }),
      action("push", "03-2-tray", { destination: "03-2-service-lane" }),
      action("push", "03-2-tray", { destination: "03-2-exit-stand" }),
    ]);
    expect(definition.complete(routeB)).toBe(true);
    expect(routeB.entities["03-2-tray"].properties.route).toBe("service-exit");
    expect(routeB.tick).toBe(0);
  });

  it("starts every encounter cycle from its local phase regardless of the global stage tick", () => {
    const first = segment("03-1").enter(null);
    first.tick = 37;
    first.segmentStartedAt = 0;
    const entered = stageDynamics(KITCHEN_STAGE).nextSegment(first);
    expect(entered?.segmentId).toBe("03-2");
    expect(entered?.tick).toBe(37);
    expect(entered?.segmentStartedAt).toBe(37);
    if (!entered) throw new Error("03-2 entry missing");
    const resumed = JSON.parse(JSON.stringify(entered)) as WorldState;
    const fromLateEntry = segment("03-2").advance(entered).world;
    const fromSerializedResume = segment("03-2").advance(resumed).world;
    const fromFreshEntry = segment("03-2").advance(segment("03-2").enter(null)).world;
    expect(fromLateEntry.entities["03-2-claw"].properties.phase).toBe(fromFreshEntry.entities["03-2-claw"].properties.phase);
    expect(fromSerializedResume).toEqual(fromLateEntry);
  });

  it("03-3 preserves platform size by lamp cutoff or faster rack cooling and fails late growth", () => {
    const definition = segment("03-3");
    let routeA = advance(definition, definition.enter(null), 2);
    routeA = execute(definition, routeA, action("turn", "03-3-lamp"));
    routeA = advance(definition, routeA, 2);
    routeA = execute(definition, routeA, action("move", "03-3-exit-ledge"));
    expect(definition.complete(routeA)).toBe(true);
    expect(routeA.entities["03-3-dough"].properties.cooledAt).toBe("none");

    let routeB = advance(definition, definition.enter(null), 2);
    routeB = execute(definition, routeB, action("pull", "03-3-dough", { destination: "03-3-cooling-rack" }));
    routeB = advance(definition, routeB);
    routeB = execute(definition, routeB, action("move", "03-3-exit-ledge"));
    expect(definition.complete(routeB)).toBe(true);
    expect(routeB.entities["03-3-dough"].properties.cooledAt).toBe("rack");
    expect(routeB.tick).toBeLessThan(routeA.tick);

    const softFailure = definition.execute?.(advance(definition, definition.enter(null)), action("move", "03-3-exit-ledge"));
    expect(softFailure?.outcome).toBe("failure");
    expect(softFailure?.world.entities["03-3-dough"].properties.silhouette).toBe("collapsed");
    let overheated = definition.enter(null);
    overheated = advance(definition, overheated, 3);
    const burst = definition.advance(overheated);
    expect(burst.failure).toContain("과팽창");
  });

  it("03-4 tracks plate identity and fills the star on moving and LEFT-fill stopped pathways", () => {
    const definition = segment("03-4");
    const wrong = definition.execute?.(definition.enter(null), action("push", "03-4-moon-plate", { destination: "03-4-scale" }));
    expect(wrong?.outcome).toBe("failure");
    expect(wrong?.world.entities["03-4-scale"].properties.rejectedIdentity).toBe("moon");

    let routeA = advance(definition, definition.enter(null));
    expect(routeA.entities["03-4-star-plate"].properties).toMatchObject({ amount: 1, position: "center" });
    routeA = execute(definition, routeA, action("push", "03-4-star-plate", { destination: "03-4-scale" }));
    expect(definition.complete(routeA)).toBe(true);
    expect(routeA.entities["03-4-belt"].properties.running).toBe(true);

    let routeB = definition.enter(null);
    routeB = execute(definition, routeB, action("push", "03-4-spatula", { destination: "03-4-gear" }));
    expect(routeB.entities["03-4-gear"].properties.stoppedAt).toBe("left-fill");
    routeB = advance(definition, routeB);
    expect(routeB.entities["03-4-star-plate"].properties).toMatchObject({ amount: 1, position: "left-fill" });
    routeB = execute(definition, routeB, action("push", "03-4-star-plate", { destination: "03-4-scale" }));
    routeB = execute(definition, routeB, action("take", "03-4-spatula"));
    routeB = advance(definition, routeB);
    expect(definition.complete(routeB)).toBe(true);
    expect(routeB.entities["03-4-belt"].properties.running).toBe(true);
    expect(routeB.entities["03-4-moon-plate"].parent).toBe("03-4-recovery");

    const overflow = definition.advance(routeB);
    expect(overflow.failure).toBeUndefined();
  });

  it("03-5 completes by the cyclic table or the visible latch and manual service path", () => {
    const definition = segment("03-5");
    const steaming = definition.advance(definition.enter(null));
    expect(steaming.world.entities["03-5-steam"].properties.active).toBe(true);
    const wet = definition.execute?.(steaming.world, action("move", "03-5-door"));
    expect(wet?.reason).toContain("김 배출");
    expect(wet?.world.entities.letter.properties.dry).toBe(false);
    expect(definition.execute?.(definition.enter(null), action("push", "03-5-plate", { destination: "03-5-exit-face" }))?.outcome).toBe("blocked");
    expect(definition.execute?.(definition.enter(null), action("take", "03-5-plate"))?.outcome).toBe("clarification");

    let routeA = definition.enter(null);
    routeA = execute(definition, routeA, action("pull", "03-5-bread", { destination: "03-5-cooling-rack" }));
    routeA = advance(definition, routeA, 2);
    routeA = executeProgram(definition, routeA, [
      action("take", "03-5-bread"),
      action("move", "03-5-wait-b"),
      action("place", "03-5-bread", { destination: "03-5-plate" }),
    ]);
    routeA = advance(definition, routeA, 3);
    const leftBehind = structuredClone(routeA);
    leftBehind.actors.hero.location = { ...leftBehind.entities["03-5-door"].location };
    expect(definition.complete(leftBehind)).toBe(false);
    expect(definition.execute?.(routeA, action("move", "03-5-door"))?.outcome).toBe("failure");
    routeA = executeProgram(definition, routeA, [
      action("move", "03-5-wait-c"),
      action("take", "03-5-plate"),
    ]);
    routeA = advance(definition, routeA, 3);
    expect(routeA.entities["03-5-plate"].parent).toBe("hero");
    expect(routeA.entities["03-5-plate"].location.x).toBe(4);
    expect(routeA.entities["03-5-bread"].location.x).toBe(4);
    routeA = execute(definition, routeA, action("move", "03-5-door"));
    expect(definition.complete(routeA)).toBe(true);
    expect(routeA.entities["03-5-table"].properties.locked).toBe(false);
    expect(routeA.entities["03-5-plate"].location.x).toBe(5);
    expect(routeA.entities["03-5-bread"].location.x).toBe(5);

    let routeB = definition.enter(null);
    routeB = execute(definition, routeB, action("pull", "03-5-bread", { destination: "03-5-cooling-rack" }));
    routeB = advance(definition, routeB, 2);
    routeB = executeProgram(definition, routeB, [
      action("take", "03-5-bread"),
      action("place", "03-5-bread", { destination: "03-5-manual-tray" }),
      action("push", "03-5-manual-tray", { destination: "03-5-service-lane" }),
    ]);
    routeB = advance(definition, routeB, 3);
    routeB = executeProgram(definition, routeB, [
      action("move", "03-5-wait-c"),
      action("turn", "03-5-table-latch"),
      action("push", "03-5-manual-tray", { destination: "03-5-exit-face" }),
      action("take", "03-5-bread"),
      action("place", "03-5-bread", { destination: "03-5-plate" }),
      action("take", "03-5-plate"),
      action("move", "03-5-door"),
    ]);
    expect(definition.complete(routeB)).toBe(true);
    expect(routeB.entities["03-5-table"].properties.locked).toBe(true);
    expect(routeB.entities["03-5-table-latch"].properties.visibleState).toBe("lowered");
    expect(routeB.entities["03-5-manual-tray"].properties.route).toBe("service-exit");
    const released = execute(definition, routeB, action("turn", "03-5-table-latch"));
    expect(released.entities["03-5-table"].properties.locked).toBe(false);
    expect(released.entities["03-5-table-latch"].properties.armed).toBe(false);
  });
});
