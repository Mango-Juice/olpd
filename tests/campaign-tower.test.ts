import { describe, expect, it } from "vitest";
import { stageDynamics, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { acknowledgePresentation, advanceStage, createStageRun, departStage } from "../src/campaign/run";
import { TOWER_STAGE } from "./fixtures/campaign-worlds/tower";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const action = (
  actor: "hero" | "keeper",
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor, verb, target, ...rest });

function segment(id: string): SegmentDefinition {
  const found = TOWER_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing tower segment ${id}`);
  return found;
}

function act(definition: SegmentDefinition, state: WorldState, input: PhysicalAction): WorldState {
  for (let step = 0; step < 24; step += 1) {
    const result = definition.execute?.(state, input);
    if (!result) throw new Error(`${definition.id} has no executor`);
    expect(["done", "progress"], result.reason).toContain(result.outcome);
    state = definition.advance(result.world).world;
    if (result.outcome === "done") return state;
  }
  throw new Error(`${input.actor}:${input.verb}:${input.target} did not finish`);
}

function play(definition: SegmentDefinition, actions: PhysicalAction[], start = definition.enter(null)): WorldState {
  return actions.reduce((state, input) => act(definition, state, input), start);
}

function waitFor(definition: SegmentDefinition, state: WorldState, predicate: (world: WorldState) => boolean): WorldState {
  for (let step = 0; step < 24 && !predicate(state); step += 1) state = definition.advance(state).world;
  expect(predicate(state)).toBe(true);
  return state;
}

describe("inner bell tower public contract", () => {
  it("exports only the five original core ids, separate practice, story after the real finale, and valid cold starts", () => {
    expect(TOWER_STAGE).toMatchObject({ id: 9, title: "종탑의 안쪽" });
    expect(TOWER_STAGE.segments.map((item) => item.id)).toEqual(["09-1", "09-2", "09-3", "09-4", "09-5"]);
    expect(TOWER_STAGE.practice.id).toBe("09-practice");
    expect(TOWER_STAGE.story).toMatchObject({ afterSegment: "09-5", object: "09-5-reminiscence" });

    for (const definition of [TOWER_STAGE.practice, ...TOWER_STAGE.segments]) {
      const world = definition.enter(null);
      expect(world.stageId).toBe(9);
      expect(world.segmentId).toBe(definition.id);
      expect(world.entities.letter.parent).toBe("hero");
      expect(world.actors.hero.carrying).toContain("letter");
      expect(new Set(world.visible).size).toBe(world.visible.length);
      expect(Object.values(world.entities).some((item) => Object.keys(item.properties).some((key) => /solution|actionId|successFlag/i.test(key)))).toBe(false);
    }
  });
});

describe("tower documented physical alternatives", () => {
  it("09-1 accepts actual wooden support and one measured vessel of water", () => {
    const definition = segment("09-1");
    const support = play(definition, [
      action("hero", "take", "09-1-support"),
      action("hero", "place", "09-1-support", { destination: "09-1-shaft-socket" }),
      action("hero", "move", "09-1-exit"),
    ]);
    expect(definition.complete(support)).toBe(true);
    expect(support.entities["09-1-shaft"].properties.support).toBe("09-1-support");

    const float = play(definition, [
      action("hero", "pour", "09-1-water", { destination: "09-1-tank", amount: 1 }),
      action("hero", "move", "09-1-exit"),
    ]);
    expect(definition.complete(float)).toBe(true);
    expect(float.entities["09-1-water"].properties.amount).toBe(0);
    expect(float.entities["09-1-tank"].properties.amount).toBe(1);
    expect(float.entities["09-1-shaft"].properties.support).toBe("09-1-float");
  });

  it("09-2 keeps the public still window long enough to walk and also accepts cooled diversion", () => {
    const definition = segment("09-2");
    let timed = waitFor(definition, definition.enter(null), (world) => world.entities["09-2-corridor"].properties.wind === "still");
    timed = act(definition, timed, action("hero", "move", "09-2-exit"));
    expect(definition.complete(timed)).toBe(true);
    expect(timed.entities["09-2-diverter"].properties.route).toBe("corridor");

    const diverted = play(definition, [
      action("hero", "pour", "09-2-coolant", { destination: "09-2-diverter", amount: 1 }),
      action("hero", "turn", "09-2-diverter"),
      action("hero", "move", "09-2-exit"),
    ]);
    expect(definition.complete(diverted)).toBe(true);
    expect(diverted.entities["09-2-corridor"].properties.wind).toBe("still");
    expect(diverted.entities["09-2-upper-pipe"].properties.flowing).toBe(true);
  });

  it("09-3 recovers the one door support through the moon winch or star weight and hook", () => {
    const definition = segment("09-3");
    let premature = act(definition, definition.enter(null), action("hero", "take", "09-3-support"));
    const approach = definition.execute?.(premature, action("hero", "move", "09-3-inside"));
    expect(approach?.outcome).toBe("progress");
    const closed = definition.execute?.(definition.advance(approach!.world).world, action("hero", "move", "09-3-inside"));
    expect(closed?.outcome).toBe("blocked");

    const moon = play(definition, [
      action("hero", "climb", "09-3-moon-path"), action("hero", "move", "09-3-moon-winch"),
      action("hero", "turn", "09-3-moon-winch"),
      action("hero", "take", "09-3-support"),
      action("hero", "place", "09-3-support", { destination: "09-3-bell-socket" }),
      action("hero", "move", "09-3-exit"),
    ]);
    expect(definition.complete(moon)).toBe(true);
    expect(moon.entities["09-3-support"].properties.route).toBe("moon-winch");

    const star = play(definition, [
      action("hero", "jump", "09-3-star-spike"), action("hero", "move", "09-3-inside"),
      action("hero", "take", "09-3-weight"),
      action("hero", "place", "09-3-weight", { destination: "09-3-door-handle" }),
      action("hero", "turn", "09-3-floor-hook"),
      action("hero", "take", "09-3-support"),
      action("hero", "place", "09-3-support", { destination: "09-3-bell-socket" }),
      action("hero", "take", "09-3-weight"),
      action("hero", "move", "09-3-exit"),
    ]);
    expect(definition.complete(star)).toBe(true);
    expect(star.entities["09-3-support"].properties.route).toBe("star-hook");
    expect(star.entities["09-3-weight"].parent).toBe("hero");
  });

  it("09-4 observes a public entity relation, closes the shutter, and swaps hero/keeper roles", () => {
    const definition = segment("09-4");
    let observed = act(definition, definition.enter(null), action("hero", "observe", "09-4-sample"));
    expect(observed.facts).toContainEqual(expect.objectContaining({ entity: "09-4-sample", property: "connectedTo", value: "09-4-triangle-cord" }));
    expect(observed.visible).not.toContain("09-4-sample");
    expect(observed.entities["09-4-shutter"].properties.open).toBe(false);
    expect(definition.execute?.(observed, action("hero", "pull", "09-4-triangle-cord"))?.outcome).toBe("clarification");
    const leaked = definition.execute?.(definition.enter(null), action("hero", "move", "09-4-sample", { references: { target: { entity: "09-4-sample", property: "connectedTo", source: "visible" } } }));
    expect(leaked?.outcome).toBe("clarification");

    let sameHolder = play(definition, [action("hero", "move", "09-4-handle"), action("hero", "hold", "09-4-handle")]);
    expect(definition.execute?.(sameHolder, action("hero", "pull", "09-4-triangle-cord"))?.outcome).toBe("clarification");

    const staleStroke = play(definition, [
      action("hero", "move", "09-4-triangle-cord"), action("hero", "pull", "09-4-triangle-cord"),
      action("hero", "move", "09-4-handle"), action("hero", "hold", "09-4-handle"),
    ]);
    expect(staleStroke.entities["09-4-bell"].properties.rung).toBe(false);

    let wrongCord = play(definition, [action("hero", "take", "09-4-weight"), action("hero", "place", "09-4-weight", { destination: "09-4-handle-socket" }), action("hero", "move", "09-4-circle-cord")]);
    wrongCord = act(definition, wrongCord, action("hero", "pull", "09-4-circle-cord"));
    expect(wrongCord.entities["09-4-circle-cord"].properties.connectedTo).toBe("09-4-empty-axis");
    expect(wrongCord.entities["09-4-bell"].properties.rung).toBe(false);

    const keeperHolds = play(definition, [
      action("keeper", "move", "09-4-handle"), action("keeper", "hold", "09-4-handle"),
      action("hero", "move", "09-4-triangle-cord"), action("hero", "pull", "09-4-triangle-cord"),
      action("hero", "move", "09-4-lock-panel"), action("hero", "turn", "09-4-lock-panel"),
      action("hero", "move", "09-4-handle-socket"), action("hero", "take", "09-4-weight"),
      action("hero", "move", "09-4-hero-exit"), action("keeper", "move", "09-4-keeper-exit"),
    ]);
    expect(definition.complete(keeperHolds)).toBe(true);

    const heroHolds = play(definition, [
      action("hero", "move", "09-4-handle"), action("hero", "hold", "09-4-handle"),
      action("keeper", "move", "09-4-triangle-cord"), action("keeper", "pull", "09-4-triangle-cord"),
      action("keeper", "move", "09-4-lock-panel"), action("keeper", "turn", "09-4-lock-panel"),
      action("keeper", "move", "09-4-keeper-exit"), action("hero", "move", "09-4-hero-exit"),
    ]);
    expect(definition.complete(heroHolds)).toBe(true);
    expect(heroHolds.entities["09-4-lock-panel"].properties.locked).toBe(true);
  });

  it("09-4 also supports the documented weight route and resolves the observed cord relation through StageRun", () => {
    const prepare: ProgramNode = { kind: "sequence", children: [
      action("hero", "take", "09-4-weight"), action("hero", "move", "09-4-handle-socket"), action("hero", "place", "09-4-weight", { destination: "09-4-handle-socket" }),
      action("hero", "observe", "09-4-sample"),
    ] };
    const body: ProgramNode = { kind: "sequence", children: [
      action("hero", "move", "09-4-sample", { references: { target: { entity: "09-4-sample", property: "connectedTo", source: "remembered" } } }),
      action("hero", "pull", "09-4-sample", { references: { target: { entity: "09-4-sample", property: "connectedTo", source: "remembered" } } }),
      action("hero", "move", "09-4-lock-panel"), action("hero", "turn", "09-4-lock-panel"),
      action("hero", "move", "09-4-handle-socket"), action("hero", "take", "09-4-weight"),
      action("hero", "move", "09-4-hero-exit"), action("keeper", "move", "09-4-keeper-exit"),
    ] };
    const program: InstructionProgram = { version: 2, id: "tower-observed-weight", text: "추를 걸고 연결을 관측한 뒤 종줄로 연결축을 고정해 둘이 나간다", model: "typed-regression", scope: { stageId: 9, region: "09-4" }, guard: false, body: {
      kind: "sequence", children: [...prepare.children, ...body.children],
    } };
    let run = createStageRun("tower-observed-weight", segment("09-4").enter(null));
    run = { ...run, notebook: writeProgram(run.notebook, program) };
    run = departStage(run);
    for (let step = 0; step < 120 && run.world.segmentId === "09-4"; step += 1) {
      run = advanceStage(acknowledgePresentation(run), stageDynamics(TOWER_STAGE));
      expect(run.phase, `${run.statusReason ?? "tower run stopped"} / ${JSON.stringify(run.events.slice(-3))}`).not.toBe("blocked");
    }
    expect(run.world.segmentId).toBe("09-5");
    expect(run.clearedSegments).toContain("09-4");
    expect(run.world.entities["09-4-lock-panel"].properties.locked).toBe(true);
    expect(run.world.entities["09-4-weight"].parent).toBe("hero");
  });

  it("09-5 reuses prior resource IDs and rings through timed/keeper or diverted/weight routes", () => {
    const definition = segment("09-5");
    let mistranslated = act(definition, definition.enter(null), action("hero", "pour", "09-5-coolant", { destination: "09-5-wind-control", amount: 1 }));
    expect(definition.execute?.(mistranslated, action("hero", "turn", "09-5-drive"))?.outcome).toBe("clarification");
    mistranslated = play(definition, [action("hero", "turn", "09-5-wind-control")], mistranslated);
    mistranslated = act(definition, mistranslated, action("hero", "move", "09-5-lower-landing"));
    expect(definition.execute?.(mistranslated, action("hero", "take", "09-3-support"))?.outcome).toBe("blocked");
    let sameHolder = play(definition, [action("hero", "move", "09-4-handle"), action("hero", "hold", "09-4-handle")], mistranslated);
    expect(definition.execute?.(sameHolder, action("hero", "pull", "09-4-triangle-cord"))?.outcome).toBe("clarification");

    let timed = waitFor(definition, definition.enter(null), (world) => world.entities["09-5-wind-control"].properties.cooled === false && world.tick % 9 >= 3);
    timed = play(definition, [
      action("hero", "move", "09-5-lower-landing"),
      action("hero", "turn", "09-5-wind-control"),
      action("hero", "climb", "09-5-moon-path"), action("hero", "turn", "09-5-moon-winch"),
      action("hero", "move", "09-3-support"), action("hero", "take", "09-3-support"), action("hero", "place", "09-3-support", { destination: "09-5-axis-socket" }),
      action("keeper", "move", "09-4-handle"), action("keeper", "hold", "09-4-handle"),
      action("hero", "move", "09-4-triangle-cord"), action("hero", "pull", "09-4-triangle-cord"), action("hero", "move", "09-5-exit"), action("keeper", "move", "09-5-exit"),
    ], timed);
    expect(definition.complete(timed)).toBe(true);
    expect(timed.entities["09-5-bell"].properties.rung).toBe(true);

    const diverted = play(definition, [
      action("hero", "pour", "09-5-coolant", { destination: "09-5-wind-control", amount: 1 }), action("hero", "turn", "09-5-wind-control"),
      action("hero", "move", "09-5-lower-landing"), action("hero", "jump", "09-5-star-spike"),
      action("hero", "take", "09-3-weight"), action("hero", "place", "09-3-weight", { destination: "09-5-door-handle" }), action("hero", "turn", "09-5-floor-hook"),
      action("hero", "move", "09-3-support"), action("hero", "take", "09-3-support"), action("hero", "place", "09-3-support", { destination: "09-5-axis-socket" }),
      action("hero", "take", "09-3-weight"), action("hero", "place", "09-3-weight", { destination: "09-5-handle-socket" }),
      action("hero", "move", "09-4-triangle-cord"), action("hero", "pull", "09-4-triangle-cord"), action("hero", "move", "09-5-exit"), action("keeper", "move", "09-5-exit"),
    ]);
    expect(definition.complete(diverted)).toBe(true);
    expect(diverted.entities["09-3-weight"].parent).toBe("09-5-handle-socket");
  });
});

describe("tower causal continuity", () => {
  it("carries recovered object identity and route evidence into the finale without spawning replacements", () => {
    const recovery = segment("09-3");
    const recovered = play(recovery, [
      action("hero", "climb", "09-3-moon-path"), action("hero", "move", "09-3-moon-winch"), action("hero", "turn", "09-3-moon-winch"),
      action("hero", "take", "09-3-support"), action("hero", "place", "09-3-support", { destination: "09-3-bell-socket" }), action("hero", "move", "09-3-exit"),
    ]);
    const connection = segment("09-4").enter(recovered);
    const finale = segment("09-5").enter(connection);
    expect(finale.entities["09-3-support"].properties.route).toBe("moon-winch");
    expect(finale.entities["09-3-support"].material).toBe("stone");
    expect(finale.entities["09-3-weight"].material).toBe("metal");
    expect(finale.visible).toContain("09-3-support");
    expect(Object.keys(finale.entities).filter((id) => id.includes("support") && finale.entities[id].properties.slot === "large")).toEqual(expect.arrayContaining(["09-3-support"]));
    expect(finale.entities["09-5-support"]).toBeUndefined();
  });
});
