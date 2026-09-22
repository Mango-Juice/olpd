import { describe, expect, it } from "vitest";
import { stageDynamics, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { createCursor, stepProgram } from "../src/campaign/program";
import { formatEntityFacts } from "../src/campaign/presentation";
import { advanceStage, createStageRun, departStage } from "../src/campaign/run";
import { FOG_STAGE } from "../src/campaign/stages/fog";
import type { InstructionProgram, PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const action = (
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });

function segment(id: string): SegmentDefinition {
  const found = FOG_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing segment ${id}`);
  return found;
}

function execute(definition: SegmentDefinition, world: WorldState, physicalAction: PhysicalAction): WorldState {
  let current = world;
  let cursor = createCursor();
  for (let count = 0; count < 20; count += 1) {
    if (!definition.execute) throw new Error(`${definition.id} has no executor`);
    const step = stepProgram(current, physicalAction, cursor, definition.execute);
    if (step.outcome === "progress") {
      current = definition.advance(step.world).world;
      cursor = step.cursor;
      continue;
    }
    expect(step.outcome, step.reason ?? undefined).toBe("done");
    return step.world;
  }
  throw new Error(`${definition.id} action did not finish`);
}

function run(definition: SegmentDefinition, actions: readonly PhysicalAction[]): WorldState {
  return actions.reduce((world, physicalAction) => execute(definition, world, physicalAction), definition.enter(null));
}

function rememberedTarget(owner: string): Pick<PhysicalAction, "references"> {
  return { references: { target: { entity: owner, property: "connectedTo", source: "remembered" } } };
}

function providerProgram(id: string, region: string, body: ProgramNode): InstructionProgram {
  return { version: 2, id, text: segment(region).hints[2], model: "provider-shaped-regression", scope: { stageId: 8, region }, guard: false, body };
}

function replayProviderShape(region: string, body: ProgramNode): ReturnType<typeof createStageRun> {
  let stageRun = createStageRun(`fog-provider-${region}`, segment(region).enter(null));
  stageRun = { ...stageRun, notebook: writeProgram(stageRun.notebook, providerProgram(`hint-${region}`, region, body)) };
  stageRun = departStage(stageRun);
  const dynamics = stageDynamics(FOG_STAGE);
  for (let step = 0; step < 128 && !stageRun.clearedSegments.includes(region); step += 1) {
    stageRun = advanceStage(stageRun, dynamics);
    expect(stageRun.phase, stageRun.statusReason ?? undefined).not.toBe("failed");
    expect(stageRun.phase, stageRun.statusReason ?? undefined).not.toBe("blocked");
  }
  return stageRun;
}

describe("fog signal yard public contract", () => {
  it("keeps the five original core IDs stable while documenting the +3 display offset", () => {
    expect(FOG_STAGE).toMatchObject({ id: 8, title: "안개 신호장" });
    expect(FOG_STAGE.segments.map((item) => item.id)).toEqual(["08-1", "08-2", "08-3", "08-4", "08-5"]);
    expect(FOG_STAGE.segments.map((item) => item.description)).toEqual([
      expect.stringContaining("8-4"), expect.stringContaining("8-5"), expect.stringContaining("8-6"),
      expect.stringContaining("8-7"), expect.stringContaining("8-8"),
    ]);
    expect(FOG_STAGE.story).toMatchObject({ afterSegment: "08-5", object: "08-5-story-ticket" });
  });

  it("offers one complete tested A-route sentence as the final hint for every core puzzle", () => {
    const finalHints = FOG_STAGE.segments.map((item) => item.hints[2]);
    expect(finalHints).toEqual([
      expect.stringMatching(/살펴본 뒤.+안전선.+확인한 밸브.+출구/u),
      expect.stringMatching(/살펴본 뒤.+관찰한 연결 대상인 손잡이.+양동이 물.+부표 길 출구/u),
      expect.stringMatching(/시계를 살펴보고.+낮은 종.+건너편/u),
      expect.stringMatching(/절개도로.+확인한 위쪽 쇠사슬 승강로.+출구/u),
      expect.stringMatching(/관측창으로.+확인한 손잡이.+낮은 종.+출발 종/u),
    ]);
    for (const hint of finalHints) expect(hint).not.toMatch(/거나|또는|중 하나/u);
  });

  it("publishes ID-valued observation relations whose geometry agrees with the actual devices", () => {
    const expected = [
      ["08-1", "08-1-triangle-observation", "08-1-square-valve"],
      ["08-2", "08-2-signal-observation", "08-2-center-supply"],
      ["08-4", "08-4-route-observation", "08-4-upper-lift"],
      ["08-5", "08-5-boiler-observation", "08-5-square-signal"],
    ] as const;
    for (const [id, owner, target] of expected) {
      const world = segment(id).enter(null);
      expect(world.visible).toContain(owner);
      expect(world.entities[owner].properties.connectedTo).toBe(target);
      expect(world.entities[target]).toBeDefined();
      expect(world.entities[owner].location.region).toBe(world.entities[target].location.region);
      expect(formatEntityFacts(world, world.entities[owner]).join(" ")).toContain(world.entities[target].name);
    }
  });

  it("publishes the audible bell state without exposing an immutable cycle description as a condition", () => {
    for (const [id, clock] of [["08-3", "08-3-clock"], ["08-5", "08-5-low-bell"]] as const) {
      const world = segment(id).enter(null);
      expect(world.entities[clock].properties).toMatchObject({ lowBell: false, highBell: true });
      expect(world.entities[clock].properties).not.toHaveProperty("cycle");
      expect(world.entities[clock].properties).not.toHaveProperty("orientation");
      const shown = formatEntityFacts(world, world.entities[clock]).join(" ");
      expect(shown).toContain("낮은 종 울림");
      expect(shown).not.toContain("clockPhase");
    }
  });
});

describe("same-attempt observation references and fog", () => {
  it("observes and resolves the connected valve later in the same line after the source is hidden", () => {
    const definition = segment("08-1");
    const sequence = {
      kind: "sequence" as const,
      children: [
        action("observe", "08-1-triangle-observation"),
        action("move", "08-1-valve-bank"),
        action("pull", "08-1-triangle-observation", rememberedTarget("08-1-triangle-observation")),
        action("move", "08-1-exit"),
      ],
    };
    let world = definition.enter(null);
    let cursor = createCursor();
    for (let count = 0; count < 12 && cursor.status !== "done"; count += 1) {
      const step = stepProgram(world, sequence, cursor, definition.execute!);
      expect(step.outcome, step.reason ?? "sequence stopped").not.toBe("clarification");
      expect(step.outcome, step.reason ?? "sequence stopped").not.toBe("blocked");
      world = step.world;
      cursor = step.cursor;
    }
    expect(cursor.status).toBe("done");
    expect(world.visible).not.toContain("08-1-triangle-observation");
    expect(world.facts).toContainEqual(expect.objectContaining({
      entity: "08-1-triangle-observation", property: "connectedTo", value: "08-1-square-valve", attempt: 1,
    }));
    expect(definition.complete(world)).toBe(true);
  });

  it("does not reuse a previous-attempt relation and still permits a directly named known valve", () => {
    const definition = segment("08-1");
    let world = execute(definition, definition.enter(null), action("observe", "08-1-triangle-observation"));
    world.attempt = 2;
    world = execute(definition, world, action("move", "08-1-circle-valve"));
    const unresolved = stepProgram(world, action("pull", "08-1-triangle-observation", rememberedTarget("08-1-triangle-observation")), createCursor(), definition.execute!);
    expect(unresolved.outcome).toBe("clarification");
    expect(unresolved.world.entities["08-1-door"].properties.open).toBe(false);

    const direct = definition.execute!(world, action("pull", "08-1-square-valve"));
    expect(direct.outcome).toBe("done");
    expect(direct.world.entities["08-1-door"].properties.open).toBe(true);
  });

  it("hides every relation scope in fog and restores it only after physically returning to its lookout", () => {
    const cases = [
      ["08-1", "08-1-triangle-observation", "08-1-fog-line"],
      ["08-2", "08-2-signal-observation", "08-2-fog-line"],
      ["08-4", "08-4-route-observation", "08-4-fog-line"],
      ["08-5", "08-5-boiler-observation", "08-5-fog-line"],
    ] as const;
    for (const [id, owner, fogLine] of cases) {
      const definition = segment(id);
      let world = definition.enter(null);
      world = execute(definition, world, action("observe", owner));
      world = execute(definition, world, action("move", fogLine));
      expect(world.visible, id).not.toContain(owner);
      world = execute(definition, world, action("move", owner));
      expect(world.visible, id).toContain(owner);
    }
  });

  it("changes the remembered route only after a fresh post-turn observation", () => {
    const definition = segment("08-4");
    let world = definition.enter(null);
    world = execute(definition, world, action("observe", "08-4-route-observation"));
    expect(world.facts.at(-1)?.attempt).toBe(1);
    world = execute(definition, world, action("turn", "08-4-wind-lever"));
    expect(world.entities["08-4-route-observation"].properties.connectedTo).toBe("08-4-lower-cartway");
    expect([...world.facts].reverse().find((fact) => fact.property === "connectedTo")?.value).toBe("08-4-upper-lift");
    world = execute(definition, world, action("observe", "08-4-route-observation"));
    const referenced = stepProgram(world, action("move", "08-4-route-observation", rememberedTarget("08-4-route-observation")), createCursor(), definition.execute!);
    expect(referenced.outcome).toBe("done");
    expect(referenced.world.actors.hero.location).toEqual(referenced.world.entities["08-4-lower-cartway"].location);
  });
});

describe("two physical routes and misroutes", () => {
  it("08-1 leaves a wrong valve harmlessly reset and opens only through the physically connected valve", () => {
    const definition = segment("08-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("move", "08-1-triangle-valve"));
    world = execute(definition, world, action("pull", "08-1-triangle-valve"));
    expect(world.entities["08-1-triangle-valve"].properties).toMatchObject({ open: false, strokes: 0 });
    expect(world.entities["08-1-door"].properties.open).toBe(false);
    world = execute(definition, world, action("move", "08-1-square-valve"));
    world = execute(definition, world, action("pull", "08-1-square-valve"));
    world = execute(definition, world, action("move", "08-1-exit"));
    expect(definition.complete(world)).toBe(true);
  });

  it("08-2 opens either the buoy door or the wheel door from the same finite water", () => {
    const definition = segment("08-2");
    const tank = run(definition, [
      action("observe", "08-2-signal-observation"), action("move", "08-2-supply-bank"),
      action("pull", "08-2-signal-observation", rememberedTarget("08-2-signal-observation")),
      action("move", "08-2-y-junction"), action("take", "08-2-bucket"),
      action("pour", "08-2-bucket", { destination: "08-2-inlet" }), action("move", "08-2-left-exit"),
    ]);
    expect(definition.complete(tank)).toBe(true);
    expect(tank.entities["08-2-tank"].properties.level).toBe(1);
    expect(tank.entities["08-2-wheel"].properties.strokes).toBe(0);

    const wheel = run(definition, [
      action("move", "08-2-center-supply"), action("pull", "08-2-center-supply"),
      action("move", "08-2-y-junction"), action("turn", "08-2-y-junction"), action("take", "08-2-bucket"),
      action("pour", "08-2-bucket", { destination: "08-2-inlet" }), action("move", "08-2-right-exit"),
    ]);
    expect(definition.complete(wheel)).toBe(true);
    expect(wheel.entities["08-2-wheel"].properties.strokes).toBe(1);
    expect(wheel.entities["08-2-tank"].properties.level).toBe(0);
  });

  it("08-3 crosses on a low-bell window or after cooling and physically wedging the piston", () => {
    const definition = segment("08-3");
    let timed = definition.enter(null);
    for (let beat = 0; beat < 6; beat += 1) timed = definition.advance(timed).world;
    expect(timed.entities["08-3-clock"].properties).toMatchObject({ lowBell: true, highBell: false });
    timed = execute(definition, timed, action("move", "08-3-exit"));
    expect(definition.complete(timed)).toBe(true);

    const fixed = run(definition, [
      action("take", "08-3-jug"), action("take", "08-3-wedge"), action("move", "08-3-wedge-socket"),
      action("pour", "08-3-jug", { destination: "08-3-axle" }),
      action("place", "08-3-wedge", { destination: "08-3-wedge-socket" }), action("move", "08-3-exit"),
    ]);
    expect(fixed.entities["08-3-piston"].properties.locked).toBe(true);
    expect(fixed.entities["08-3-passage"].properties.safe).toBe(true);
    expect(definition.complete(fixed)).toBe(true);
  });

  it("08-4 supports the east upper route and west low route with different movement", () => {
    const definition = segment("08-4");
    const upper = run(definition, [
      action("observe", "08-4-route-observation"),
      action("move", "08-4-route-observation", rememberedTarget("08-4-route-observation")),
      action("climb", "08-4-upper-exit"),
    ]);
    expect(definition.complete(upper)).toBe(true);

    const lower = run(definition, [
      action("turn", "08-4-wind-lever"), action("move", "08-4-lower-cartway"), action("duck", "08-4-lower-exit"),
    ]);
    expect(definition.complete(lower)).toBe(true);
    expect(lower.entities["08-4-upper-lift"].properties.open).toBe(false);
    expect(lower.entities["08-4-lower-cartway"].properties.open).toBe(true);
  });

  it("08-5 spends observable pressure for either low-bell north or keeper-held south", () => {
    const definition = segment("08-5");
    let north = definition.enter(null);
    north = execute(definition, north, action("observe", "08-5-boiler-observation"));
    north = execute(definition, north, action("move", "08-5-fog-line"));
    north = execute(definition, north, action("pull", "08-5-boiler-observation", rememberedTarget("08-5-boiler-observation")));
    for (let beat = 0; beat < 6; beat += 1) north = definition.advance(north).world;
    expect(north.entities["08-5-low-bell"].properties.safe).toBe(true);
    north = execute(definition, north, action("move", "08-5-north-exit"));
    north = execute(definition, north, action("pull", "08-5-departure-bell"));
    expect(definition.complete(north)).toBe(true);

    let south = definition.enter(null);
    south = execute(definition, south, action("turn", "08-5-route-selector"));
    south = execute(definition, south, action("move", "08-5-fog-line"));
    south = execute(definition, south, action("pull", "08-5-square-signal"));
    south = execute(definition, south, { ...action("move", "08-5-counterweight"), actor: "keeper" });
    south = execute(definition, south, { ...action("hold", "08-5-counterweight"), actor: "keeper" });
    south = execute(definition, south, action("move", "08-5-south-exit"));
    south = execute(definition, south, action("pull", "08-5-departure-bell"));
    expect(definition.complete(south)).toBe(true);
    expect(south.entities["08-5-south-water"].properties.level).toBe(1);
    expect(south.entities["08-5-south-door"].properties.open).toBe(true);
  });

  it("recovers one wrong finale signal through the physical safety tank", () => {
    const definition = segment("08-5");
    let world = definition.enter(null);
    world = execute(definition, world, action("move", "08-5-fog-line"));
    world = execute(definition, world, action("pull", "08-5-triangle-signal"));
    expect(world.entities["08-5-pressure-gauge"].properties).toMatchObject({ remaining: 1, pressure: 0 });
    expect(world.entities["08-5-recovery"].properties.pressure).toBe(1);
    world = execute(definition, world, action("pull", "08-5-recovery"));
    expect(world.entities["08-5-pressure-gauge"].properties.remaining).toBe(2);
    expect(world.entities["08-5-recovery"].properties.pressure).toBe(0);
  });
});

describe("stage dynamics retry boundary", () => {
  it("replays provider-shaped 08-3 and 08-5 ASTs against the live timed physics", () => {
    const timed = replayProviderShape("08-3", {
      kind: "sequence",
      children: [
        action("observe", "08-3-clock"),
        { kind: "wait", until: { kind: "property", entity: "08-3-clock", property: "lowBell", comparison: "eq", value: true, source: "visible" } },
        action("move", "08-3-exit"),
      ],
    });
    expect(timed.clearedSegments).toContain("08-3");

    const finale = replayProviderShape("08-5", {
      kind: "sequence",
      children: [
        action("observe", "08-5-boiler-observation"),
        action("move", "08-5-fog-line"),
        action("pull", "08-5-boiler-observation", rememberedTarget("08-5-boiler-observation")),
        { kind: "wait", until: { kind: "property", entity: "08-5-low-bell", property: "lowBell", comparison: "eq", value: true, source: "visible" } },
        action("move", "08-5-north-exit"),
        action("pull", "08-5-departure-bell"),
      ],
    });
    expect(finale.clearedSegments).toContain("08-5");
    expect(finale.phase).toBe("cleared");
  });

  it("keeps prior facts as history but makes their remembered relation unknown in a new attempt", () => {
    const definition = segment("08-1");
    const dynamics = stageDynamics(FOG_STAGE);
    let first = definition.enter(null);
    first = execute(definition, first, action("observe", "08-1-triangle-observation"));
    const retry = definition.enter(null);
    retry.attempt = 2;
    retry.facts = first.facts;
    const stale = stepProgram(retry, action("pull", "08-1-triangle-observation", rememberedTarget("08-1-triangle-observation")), createCursor(), dynamics.execute);
    expect(stale.outcome).toBe("clarification");
    expect(retry.facts.some((fact) => fact.attempt === 1 && fact.property === "connectedTo")).toBe(true);
  });

  it("opts into idle movement only for a unique permanently clear path", () => {
    const dynamics = stageDynamics(FOG_STAGE);

    const valve = segment("08-1");
    const opened = run(valve, [action("move", "08-1-valve-bank"), action("pull", "08-1-square-valve")]);
    expect(valve.idleAction?.(opened)).toEqual(action("move", "08-1-exit"));
    let valveRun = departStage(createStageRun("fog-idle-valve", opened));
    valveRun = advanceStage(valveRun, dynamics);
    expect(valveRun.clearedSegments).toContain("08-1");
    expect(valveRun.world.segmentId).toBe("08-2");

    const water = segment("08-2");
    const routed = run(water, [
      action("move", "08-2-center-supply"), action("pull", "08-2-center-supply"),
      action("move", "08-2-y-junction"), action("take", "08-2-bucket"),
      action("pour", "08-2-bucket", { destination: "08-2-inlet" }),
    ]);
    expect(water.idleAction?.(routed)).toEqual(action("move", "08-2-left-exit"));
    const rerouted = execute(water, routed, action("turn", "08-2-y-junction"));
    expect(rerouted.entities["08-2-left-door"].properties.open).toBe(true);
    expect(rerouted.entities["08-2-right-door"].properties.open).toBe(false);

    const piston = segment("08-3");
    const periodic = piston.enter(null);
    expect(piston.idleAction?.(periodic)).toBeNull();
    const fixed = run(piston, [
      action("take", "08-3-jug"), action("take", "08-3-wedge"), action("move", "08-3-wedge-socket"),
      action("pour", "08-3-jug", { destination: "08-3-axle" }),
      action("place", "08-3-wedge", { destination: "08-3-wedge-socket" }),
    ]);
    expect(piston.idleAction?.(fixed)).toEqual(action("move", "08-3-exit"));

    expect(segment("08-4").idleAction).toBeUndefined();
    expect(segment("08-5").idleAction).toBeUndefined();
  });
});
