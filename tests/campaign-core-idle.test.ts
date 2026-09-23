import { describe, expect, it } from "vitest";
import { stageDynamics, type SegmentDefinition } from "../src/campaign/level";
import { acknowledgePresentation, advanceStage, createStageRun, departStage, writeStageProgram } from "../src/campaign/run";
import { FORGE_STAGE } from "./fixtures/campaign-worlds/forge";
import { GARDEN_STAGE } from "./fixtures/campaign-worlds/garden";
import { KITCHEN_STAGE } from "./fixtures/campaign-worlds/kitchen";
import { RAIN_STAGE } from "./fixtures/campaign-worlds/rain";
import { STOREHOUSE_STAGE } from "./fixtures/campaign-worlds/storehouse";
import { THEATRE_STAGE } from "./fixtures/campaign-worlds/theatre";
import type { PhysicalAction, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function segment(stage: { segments: readonly SegmentDefinition[] }, id: string): SegmentDefinition {
  const found = stage.segments.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing segment ${id}`);
  return found;
}

function step(definition: SegmentDefinition, state: WorldState, physical: PhysicalAction): WorldState {
  const result = definition.execute?.(state, physical);
  if (!result) throw new Error(`${definition.id} has no executor`);
  expect(result.outcome, result.reason).toBe("done");
  const environment = definition.advance(result.world);
  expect(environment.failure).toBeUndefined();
  return environment.world;
}

describe("historical route metadata and explicit movement in core chapters 2-7", () => {
  it("records deterministic exits only after interaction choices and excludes rafts, periodic hazards, and two-actor exits", () => {
    expect(RAIN_STAGE.segments.filter((item) => item.idleAction).map((item) => item.id)).toEqual([]);
    expect(KITCHEN_STAGE.segments.filter((item) => item.idleAction).map((item) => item.id)).toEqual(["03-3"]);
    expect(FORGE_STAGE.segments.filter((item) => item.idleAction).map((item) => item.id)).toEqual(["04-1", "04-2", "04-3", "04-4"]);
    expect(GARDEN_STAGE.segments.filter((item) => item.idleAction).map((item) => item.id)).toEqual(["05-1", "05-2", "05-3", "05-4", "05-5"]);
    expect(STOREHOUSE_STAGE.segments.filter((item) => item.idleAction).map((item) => item.id)).toEqual(["06-1", "06-2", "06-3", "06-4", "06-5"]);
    expect(THEATRE_STAGE.segments.filter((item) => item.idleAction).map((item) => item.id)).toEqual([]);

    for (const stage of [KITCHEN_STAGE, FORGE_STAGE, GARDEN_STAGE, STOREHOUSE_STAGE]) {
      for (const definition of stage.segments.filter((item) => item.idleAction)) {
        expect(definition.idleAction?.(definition.enter(null)), definition.id).toBeNull();
      }
    }

    const periodic = segment(KITCHEN_STAGE, "03-1");
    let steamStopped = periodic.enter(null);
    steamStopped = periodic.advance(periodic.advance(steamStopped).world).world;
    expect(steamStopped.entities["03-1-steam-pipe"].properties.active).toBe(false);
    expect(periodic.idleAction).toBeUndefined();
  });

  it("walks the hardened dough route only after growth and cooling are complete", () => {
    const definition = segment(KITCHEN_STAGE, "03-3");
    let state = definition.enter(null);
    state = definition.advance(definition.advance(state).world).world;
    state = step(definition, state, action("turn", "03-3-lamp"));
    state = definition.advance(state).world;
    expect(state.entities["03-3-dough"].properties).toMatchObject({ size: 2, firmness: "hard" });
    const idle = definition.idleAction?.(state);
    expect(idle).toEqual(action("move", "03-3-exit-ledge"));
    expect(definition.complete(definition.execute!(state, idle!).world)).toBe(true);
  });

  it("uses the required 04-1 persistent latch before offering the one open exit", () => {
    const definition = segment(FORGE_STAGE, "04-1");
    let state = definition.enter(null);
    expect(definition.idleAction?.(state)).toBeNull();
    state = step(definition, state, action("pull", "04-1-lever", { destination: "04-1-latch", amount: 1 }));
    expect(state.entities["04-1-door"].properties.open).toBe(true);
    const idle = definition.idleAction?.(state);
    expect(idle).toEqual(action("move", "04-1-exit"));
    expect(definition.complete(definition.execute!(state, idle!).world)).toBe(true);
  });

  it("requires an explicit move across the already-stabilized 04-4 bridge", () => {
    const definition = segment(FORGE_STAGE, "04-4");
    const world = definition.enter(null);
    world.entities["04-4-pin"].properties.released = true;
    world.entities["04-4-bridge"].properties.extended = true;
    world.entities["04-4-bridge"].properties.stability = "wind-lowered";
    world.entities["04-4-bridge"].properties.safeToCross = true;
    const stationary = advanceStage(departStage(createStageRun("forge-stationary-bridge", world)), stageDynamics(FORGE_STAGE));
    expect(stationary.phase).toBe("blocked");
    expect(stationary.world).toEqual(world);
    expect(stationary.notebook.deaths).toBe(0);

    let run = createStageRun("forge-explicit-bridge", world);
    run = writeStageProgram(run, { version: 2, id: "cross-bridge", text: "안전해진 다리를 건너 출구로 가", model: "fixture", scope: { stageId: 4, region: "04-4" }, guard: false, body: action("move", "04-4-exit") });
    run = departStage(run);
    for (let boundary = 0; boundary < 8 && run.world.segmentId === "04-4"; boundary += 1) {
      run = advanceStage(acknowledgePresentation(run), stageDynamics(FORGE_STAGE));
    }
    expect(run.clearedSegments).toContain("04-4");
    expect(run.world.segmentId).toBe("04-5");
    expect(run.notebook.deaths).toBe(0);
    const moves = run.events.filter((event) => event.segmentId === "04-4" && event.actor === "hero");
    expect(moves.length).toBeGreaterThan(1);
    expect(moves.every((event) => event.instructionId === "cross-bridge" && event.target === "04-4-exit" && event.outcome === "safe")).toBe(true);
  });

  it("waits for a real garden support and both storehouse gates before walking", () => {
    const garden = segment(GARDEN_STAGE, "05-1");
    let gardenState = step(garden, garden.enter(null), action("push", "05-1-pot", { destination: "05-1-step-slot" }));
    const gardenIdle = garden.idleAction?.(gardenState);
    expect(gardenIdle).toEqual(action("move", "05-1-exit"));
    expect(garden.complete(garden.execute!(gardenState, gardenIdle!).world)).toBe(true);

    const storehouse = segment(STOREHOUSE_STAGE, "06-1");
    let storehouseState = storehouse.enter(null);
    for (const physical of [
      action("take", "06-1-key"), action("move", "06-1-lock-a"),
      action("place", "06-1-key", { destination: "06-1-lock-a" }), action("turn", "06-1-key"), action("take", "06-1-key"),
      action("move", "06-1-lock-b"), action("place", "06-1-key", { destination: "06-1-lock-b" }), action("turn", "06-1-key"),
    ]) storehouseState = step(storehouse, storehouseState, physical);
    const storehouseIdle = storehouse.idleAction?.(storehouseState);
    expect(storehouseIdle).toEqual(action("move", "06-1-exit"));
    expect(storehouse.complete(storehouse.execute!(storehouseState, storehouseIdle!).world)).toBe(true);
  });
});
