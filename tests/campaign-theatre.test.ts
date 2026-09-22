import { describe, expect, it } from "vitest";
import { stageDynamics, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { advanceStage, createStageRun, departStage, type StageRun } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import { THEATRE_PUBLIC_CATALOG, THEATRE_STAGE } from "../src/campaign/stages/theatre";
import type { InstructionProgram, PhysicalAction, Predicate, ProgramNode, WorldState } from "../src/campaign/types";

const action = (
  actor: "hero" | "keeper",
  verb: PhysicalAction["verb"],
  target: string,
  rest: Partial<Omit<PhysicalAction, "kind" | "actor" | "verb" | "target">> = {},
): PhysicalAction => ({ kind: "action", actor, verb, target, ...rest });

const property = (entity: string, name: string, value: string | number | boolean, comparison: "eq" | "gte" = "eq"): Predicate => ({
  kind: "property", entity, property: name, comparison, value, source: "visible",
});

const sequence = (...children: ProgramNode[]): ProgramNode => ({ kind: "sequence", children });
const parallel = (...children: ProgramNode[]): ProgramNode => ({ kind: "parallel", children });
const wait = (until: Predicate): ProgramNode => ({ kind: "wait", until });
const holdUntil = (actor: "hero" | "keeper", target: string, condition: Predicate): ProgramNode => ({
  kind: "until", condition, body: action(actor, "hold", target),
});

function segment(id: string): SegmentDefinition {
  const found = THEATRE_STAGE.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing theatre segment ${id}`);
  return found;
}

function literal(id: string, region: string, body: ProgramNode): InstructionProgram {
  return { version: 2, id, text: `${region} 두 주체 공개 물리 절차`, model: "typed-regression", scope: { stageId: 7, region }, guard: false, body };
}

function restored(run: StageRun): StageRun {
  const parsed = parseStageRun(JSON.parse(JSON.stringify(run)));
  expect(parsed).not.toBeNull();
  expect(parsed!.world.actors.hero.carrying).toContain("letter");
  expect(parsed!.world.entities.letter.parent).toBe("hero");
  expect(parsed!.world.actors.keeper).toBeDefined();
  return parsed!;
}

interface Played { run: StageRun; completed: WorldState | null; boundaries: WorldState[] }

function playLiteral(region: string, body: ProgramNode, limit = 240): Played {
  const definition = segment(region);
  let run = createStageRun(`theatre-${region}-${Math.random()}`, definition.enter(null));
  run = { ...run, notebook: writeProgram(run.notebook, literal(`line-${region}`, region, body)) };
  run = restored(departStage(run));
  const dynamics = stageDynamics(THEATRE_STAGE);
  const nextSegment = dynamics.nextSegment;
  let completed: WorldState | null = null;
  dynamics.nextSegment = (world) => {
    completed = structuredClone(world);
    return nextSegment(world);
  };
  const boundaries: WorldState[] = [structuredClone(run.world)];
  for (let step = 0; step < limit && !completed && (run.phase === "running" || run.phase === "waiting"); step += 1) {
    run = restored(advanceStage(run, dynamics));
    boundaries.push(structuredClone(run.world));
    expect(run.phase, run.statusReason ?? "theatre run stopped").not.toBe("blocked");
  }
  expect(completed, `${region} did not complete: ${run.phase} ${run.statusReason ?? ""}`).not.toBeNull();
  return { run, completed, boundaries };
}

function executeFully(definition: SegmentDefinition, state: WorldState, physical: PhysicalAction): WorldState {
  for (let step = 0; step < 32; step += 1) {
    const result = definition.execute?.(state, physical);
    if (!result) throw new Error(`${definition.id} has no executor`);
    expect(["done", "progress"], result.reason).toContain(result.outcome);
    state = definition.advance(result.world).world;
    if (result.outcome === "done") return state;
  }
  throw new Error(`${physical.target} movement did not finish`);
}

describe("counterweight theatre public contract", () => {
  it("exports isolated practice, all five scenes, optional story, and readable physical affordances", () => {
    expect(THEATRE_STAGE).toMatchObject({ id: 7, title: "평형 인형극장" });
    expect(THEATRE_STAGE.segments.map((item) => item.id)).toEqual(["07-1", "07-2", "07-3", "07-4", "07-5"]);
    expect(THEATRE_STAGE.practice.id).toBe("07-practice");
    expect(THEATRE_STAGE.story).toMatchObject({ afterSegment: "07-4", object: "07-4-shadow-play" });
    expect(Object.keys(THEATRE_PUBLIC_CATALOG)).toEqual(["07-practice", "07-1", "07-2", "07-3", "07-4", "07-5"]);

    for (const definition of [THEATRE_STAGE.practice, ...THEATRE_STAGE.segments]) {
      const initial = definition.enter(null);
      expect(Object.keys(initial.actors).sort()).toEqual(["hero", "keeper"]);
      expect(initial.actors.keeper.capabilities).toEqual(expect.arrayContaining(["rail-only", "no-jump", "no-stairs", "max-weight:0.5"]));
      expect(THEATRE_PUBLIC_CATALOG[definition.id].map((item) => item.id)).toEqual(initial.visible);
      expect(THEATRE_PUBLIC_CATALOG[definition.id].every((item) => item.kind.length > 0 && item.capacity >= 0 && item.reach >= 0)).toBe(true);
      expect(Object.values(initial.entities).some((item) => Object.keys(item.properties).some((name) => /solution|actionId|successFlag|completedFlag/i.test(name)))).toBe(false);
      expect(initial.entities.letter.properties.equipment).toBe(true);
    }

    const intro = segment("07-1").enter(null);
    expect(intro.entities["07-1-ability"].properties).toMatchObject({ keeperTravelCells: 3, heroTravelCells: 5, curtainCloseBeats: 3 });
    expect(THEATRE_PUBLIC_CATALOG["07-5"].find((item) => item.id === "07-5-curtain")?.properties).toContain("causalControls");
  });

  it("keeps the wedge's physical parent distinct from a hand-held spring handle", () => {
    const definition = THEATRE_STAGE.practice;
    let world = definition.enter(null);
    world = executeFully(definition, world, action("hero", "take", "07-practice-wedge"));
    world = executeFully(definition, world, action("hero", "move", "07-practice-handle"));
    world = executeFully(definition, world, action("hero", "hold", "07-practice-handle"));
    world = executeFully(definition, world, action("hero", "place", "07-practice-wedge", { destination: "07-practice-socket" }));
    world = executeFully(definition, world, action("hero", "release", "07-practice-handle"));
    expect(world.actors.hero.holding).toBeNull();
    expect(world.entities["07-practice-wedge"].parent).toBe("07-practice-socket");
    expect(world.entities["07-practice-door"].properties).toMatchObject({ open: true, wedged: true, support: "07-practice-wedge" });
    world = executeFully(definition, world, action("hero", "take", "07-practice-wedge"));
    world = executeFully(definition, world, action("hero", "move", "07-practice-return"));
    world = executeFully(definition, world, action("hero", "release", "07-practice-wedge"));
    expect(world.entities["07-practice-door"].properties.open).toBe(false);
    expect(definition.complete(world)).toBe(true);
  });
});

describe("literal two-actor programs through StageRun", () => {
  it("07-1 persists each one-cell boundary, waits for the three-cell keeper route, and closes in three beats", () => {
    const played = playLiteral("07-1", parallel(
      sequence(
        action("keeper", "move", "07-1-curtain-handle"),
        holdUntil("keeper", "07-1-curtain-handle", property("07-1-arrival", "heroArrived", true)),
        action("keeper", "move", "07-1-keeper-exit"),
      ),
      sequence(action("hero", "move", "07-1-arrival"), action("hero", "move", "07-1-hero-exit")),
    ));
    const worlds = played.boundaries.filter((world) => world.segmentId === "07-1");
    expect(worlds.some((world) => world.actors.keeper.location.x === 1 && world.actors.hero.location.x === 1)).toBe(true);
    expect(worlds.some((world) => world.actors.keeper.location.x === 2 && world.actors.hero.location.x === 2)).toBe(true);
    expect(worlds.some((world) => world.entities["07-1-curtain"].properties.closingBeatsRemaining === 2)).toBe(true);
    expect(worlds.some((world) => world.entities["07-1-curtain"].properties.closingBeatsRemaining === 1)).toBe(true);
    expect(played.completed!.entities["07-1-curtain"].properties.closingBeatsRemaining).toBe(0);
    expect(bothActorsExited(played.completed!, "07-1-hero-exit", "07-1-keeper-exit")).toBe(true);
    expect(played.run.world.segmentId).toBe("07-2");
    expect(played.run.world.entities["07-1-curtain"]).toBeDefined();
    expect(played.run.world.visible).not.toContain("07-1-curtain");
  });

  it("07-2 accepts two physically distinct lift routes and only completes after the real weight is returned", () => {
    const routeA = playLiteral("07-2", sequence(
      action("keeper", "take", "07-2-weight"), action("keeper", "move", "07-2-left-stand"), action("keeper", "place", "07-2-weight", { destination: "07-2-left-stand" }),
      action("hero", "move", "07-2-balcony"), action("hero", "turn", "07-2-lock"),
      action("keeper", "take", "07-2-weight"), action("keeper", "move", "07-2-return"), action("keeper", "place", "07-2-weight", { destination: "07-2-return" }),
      action("hero", "move", "07-2-hero-exit"), action("keeper", "move", "07-2-keeper-exit"),
    )).completed!;
    expect(routeA.entities["07-2-axis"].properties.lockedPosition).toBe("right-high");
    expect(routeA.entities["07-2-balcony"].properties.accessRoute).toBe("right-platform");
    expect(routeA.entities["07-2-weight"].parent).toBe("07-2-return");

    const routeB = playLiteral("07-2", sequence(
      action("hero", "climb", "07-2-side-ladder"), action("hero", "turn", "07-2-signal"),
      action("keeper", "take", "07-2-weight"), action("keeper", "move", "07-2-right-stand"), action("keeper", "place", "07-2-weight", { destination: "07-2-right-stand" }),
      action("hero", "turn", "07-2-lock"), action("keeper", "take", "07-2-weight"), action("keeper", "move", "07-2-return"), action("keeper", "place", "07-2-weight", { destination: "07-2-return" }),
      action("hero", "move", "07-2-hero-exit"), action("keeper", "move", "07-2-keeper-exit"),
    )).completed!;
    expect(routeB.entities["07-2-axis"].properties.lockedPosition).toBe("left-high");
    expect(routeB.entities["07-2-balcony"].properties.accessRoute).toBe("side-ladder");
    expect(routeB.entities["07-2-signal"].properties.on).toBe(true);
  });

  it("07-3 assigns hold and lock roles both ways and records rail versus rope paths", () => {
    const routeA = playLiteral("07-3", parallel(
      sequence(holdUntil("hero", "07-3-pressure", property("07-3-lock", "locked", true)), action("hero", "move", "07-3-hero-exit")),
      sequence(action("keeper", "move", "07-3-far-rail"), action("keeper", "turn", "07-3-lock"), action("keeper", "move", "07-3-keeper-exit")),
    )).completed!;
    expect(routeA.entities["07-3-lock"].properties.lockedBy).toBe("keeper");
    expect(routeA.entities["07-3-bridge"].properties).toMatchObject({ extended: true, support: "latch", route: "keeper-rail" });

    const routeB = playLiteral("07-3", parallel(
      sequence(holdUntil("keeper", "07-3-pressure", property("07-3-lock", "locked", true)), action("keeper", "move", "07-3-keeper-exit")),
      sequence(action("hero", "climb", "07-3-ceiling-rope"), action("hero", "turn", "07-3-lock"), action("hero", "move", "07-3-hero-exit")),
    )).completed!;
    expect(routeB.entities["07-3-lock"].properties.lockedBy).toBe("hero");
    expect(routeB.entities["07-3-bridge"].properties.route).toBe("ceiling-rope");
  });

  it("07-4 supports a fixed keeper role or a no-gap handoff with different cart paths", () => {
    const routeA = playLiteral("07-4", parallel(
      sequence(holdUntil("keeper", "07-4-windbreak", property("07-4-door", "open", true)), action("keeper", "move", "07-4-keeper-exit")),
      sequence(action("hero", "push", "07-4-cart", { destination: "07-4-center" }), action("hero", "move", "07-4-crank"), action("hero", "turn", "07-4-crank"), action("hero", "turn", "07-4-crank"), action("hero", "move", "07-4-hero-exit")),
    )).completed!;
    expect(routeA.entities["07-4-cart"].properties.route).toBe("hero-push");
    expect(routeA.entities["07-4-windbreak"].properties.handoffs).toBe(0);

    const routeB = playLiteral("07-4", sequence(
      action("hero", "hold", "07-4-windbreak"),
      parallel(
        sequence(wait(property("07-4-windbreak", "handoffs", 1, "gte")), action("hero", "release", "07-4-windbreak"), action("hero", "move", "07-4-crank"), action("hero", "turn", "07-4-crank"), action("hero", "turn", "07-4-crank"), action("hero", "move", "07-4-hero-exit")),
        sequence(action("keeper", "pull", "07-4-cart", { destination: "07-4-center" }), holdUntil("keeper", "07-4-windbreak", property("07-4-door", "open", true)), action("keeper", "move", "07-4-keeper-exit")),
      ),
    )).completed!;
    expect(routeB.entities["07-4-cart"].properties.route).toBe("rail-rope");
    expect(routeB.entities["07-4-windbreak"].properties.handoffs).toBe(1);
    expect(routeB.entities["07-4-lamp"].properties.snuffed).toBe(false);
  });

  it("07-5 keeps both weight-allocation routes finite and requires latch, 2/2 return, and both exits", () => {
    const routeA = playLiteral("07-5", sequence(
      action("keeper", "take", "07-5-left-weight"), action("keeper", "move", "07-5-left-stand"), action("keeper", "place", "07-5-left-weight", { destination: "07-5-left-stand" }),
      parallel(
        sequence(holdUntil("keeper", "07-5-moon-handle", property("07-5-latch", "locked", true)), action("keeper", "take", "07-5-left-weight"), action("keeper", "move", "07-5-return-home"), action("keeper", "place", "07-5-left-weight", { destination: "07-5-return-home" }), action("keeper", "move", "07-5-start"), action("keeper", "take", "07-5-right-weight"), action("keeper", "move", "07-5-return-home"), action("keeper", "place", "07-5-right-weight", { destination: "07-5-return-home" }), action("keeper", "move", "07-5-keeper-exit")),
        sequence(action("hero", "move", "07-5-inner"), action("hero", "turn", "07-5-crank"), action("hero", "turn", "07-5-crank"), action("hero", "turn", "07-5-crank"), wait(property("07-5-curtain", "open", true)), action("hero", "move", "07-5-hero-exit")),
      ),
    )).completed!;
    expect(routeA.entities["07-5-bridge"].properties.lockedAlignment).toBe("left");
    expect(routeA.entities["07-5-return-home"].properties.returned).toBe(2);
    expect(routeA.actors.keeper.holding).toBeNull();

    const routeB = playLiteral("07-5", sequence(
      action("hero", "take", "07-5-right-weight"), action("hero", "move", "07-5-right-stand"), action("hero", "place", "07-5-right-weight", { destination: "07-5-right-stand" }),
      parallel(
        sequence(holdUntil("keeper", "07-5-moon-handle", property("07-5-latch", "locked", true)), action("keeper", "take", "07-5-left-weight"), action("keeper", "move", "07-5-return-home"), action("keeper", "place", "07-5-left-weight", { destination: "07-5-return-home" }), wait(property("07-5-curtain", "open", true)), action("keeper", "move", "07-5-keeper-exit")),
        sequence(action("hero", "move", "07-5-inner"), action("hero", "turn", "07-5-crank"), action("hero", "turn", "07-5-crank"), action("hero", "turn", "07-5-crank"), action("hero", "move", "07-5-right-stand"), action("hero", "take", "07-5-right-weight"), action("hero", "move", "07-5-return-home"), action("hero", "place", "07-5-right-weight", { destination: "07-5-return-home" }), wait(property("07-5-curtain", "open", true)), action("hero", "move", "07-5-hero-exit")),
      ),
    )).completed!;
    expect(routeB.entities["07-5-bridge"].properties.lockedAlignment).toBe("right");
    expect(routeB.entities["07-5-left-weight"].parent).toBe("07-5-return-home");
    expect(routeB.entities["07-5-right-weight"].parent).toBe("07-5-return-home");
    expect(bothActorsExited(routeB, "07-5-hero-exit", "07-5-keeper-exit")).toBe(true);
  });
});

function bothActorsExited(world: WorldState, heroExit: string, keeperExit: string): boolean {
  return world.actors.hero.location.x === world.entities[heroExit].location.x
    && world.actors.keeper.location.x === world.entities[keeperExit].location.x;
}

describe("theatre failure, clarification, and safe incomplete states", () => {
  it("uses common stepped movement for a ridden platform and its physical cargo", () => {
    const definition = segment("07-2");
    let world = definition.enter(null);
    world = executeFully(definition, world, action("hero", "move", "07-2-right-platform"));
    world = executeFully(definition, world, action("hero", "board", "07-2-right-platform"));
    world.entities["07-2-platform-cargo"] = {
      ...structuredClone(world.entities["07-2-weight"]),
      id: "07-2-platform-cargo",
      name: "승강판 시험 화물",
      parent: "07-2-right-platform",
      location: { ...world.entities["07-2-right-platform"].location },
    };
    const moved = definition.execute?.(world, action("hero", "move", "07-2-hero-exit"));
    expect(moved?.outcome).toBe("progress");
    expect(moved!.world.actors.hero.location.x).toBe(4);
    expect(moved!.world.entities["07-2-right-platform"].location.x).toBe(4);
    expect(moved!.world.entities["07-2-platform-cargo"].location.x).toBe(4);
  });

  it("keeps a carried rope constraint on every one-cell theatre movement", () => {
    const definition = segment("07-1");
    const world = definition.enter(null);
    world.entities["07-rope-payload"] = {
      id: "07-rope-payload", name: "묶인 소품", description: "한 칸 밧줄에 묶인 소품", material: "wood", movable: true,
      weight: 0.1, capacity: 0, reach: 1, location: { ...world.actors.hero.location }, parent: "hero",
      properties: { kind: "prop", publicLabel: "묶인 소품", slot: "small", tiedTo: "07-rope-anchor", tiedWith: "07-rope" },
    };
    world.entities["07-rope-anchor"] = {
      id: "07-rope-anchor", name: "고정 닻", description: "움직이지 않는 닻", material: "metal", movable: false,
      weight: 2, capacity: 0, reach: 1, location: { ...world.actors.hero.location }, parent: null,
      properties: { kind: "anchor", publicLabel: "고정 닻", fixed: true, tiedTo: "07-rope-payload", tiedWith: "07-rope" },
    };
    world.entities["07-rope"] = {
      id: "07-rope", name: "한 칸 밧줄", description: "길이 한 칸 밧줄", material: "cloth", movable: true,
      weight: 0.1, capacity: 0, reach: 1, location: { ...world.actors.hero.location }, parent: "07-rope-payload",
      properties: { kind: "rope", publicLabel: "한 칸 밧줄", tool: "rope", ropeLength: 1 },
    };
    world.actors.hero.carrying.push("07-rope-payload");
    const first = definition.execute?.(world, action("hero", "move", "07-1-arrival"));
    expect(first?.outcome).toBe("progress");
    expect(first!.world.actors.hero.location.x).toBe(1);
    const stretched = definition.execute?.(first!.world, action("hero", "move", "07-1-arrival"));
    expect(stretched?.outcome).toBe("clarification");
    expect(stretched!.world.actors.hero.location.x).toBe(1);
    expect(stretched!.world.entities["07-rope-anchor"].location.x).toBe(0);
  });

  it("routes an implicit move-away release through the same three-beat curtain descent", () => {
    const definition = segment("07-1");
    let world = definition.enter(null);
    world = executeFully(definition, world, action("keeper", "move", "07-1-curtain-handle"));
    world = executeFully(definition, world, action("keeper", "hold", "07-1-curtain-handle"));
    const leaving = definition.execute?.(world, action("keeper", "move", "07-1-keeper-exit"));
    expect(leaving?.outcome).toBe("progress");
    expect(leaving!.world.actors.keeper.holding).toBeNull();
    expect(leaving!.world.entities["07-1-curtain"].properties).toMatchObject({ open: true, closingBeatsRemaining: 3 });
    const advanced = definition.advance(leaving!.world).world;
    expect(advanced.entities["07-1-curtain"].properties).toMatchObject({ open: true, closingBeatsRemaining: 2 });
  });

  it("keeps public keeper reach and capacity violations free and non-mutating", () => {
    const lift = segment("07-2");
    const initial = lift.enter(null);
    const before = structuredClone(initial);
    const stairs = lift.execute?.(initial, action("keeper", "climb", "07-2-side-ladder"));
    expect(stairs?.outcome).toBe("clarification");
    expect(stairs?.world).toEqual(before);

    const finale = segment("07-5");
    let world = finale.enter(null);
    world = executeFully(finale, world, action("keeper", "take", "07-5-left-weight"));
    const capacity = finale.execute?.(world, action("keeper", "take", "07-5-right-weight"));
    expect(capacity?.outcome).toBe("clarification");
    expect(capacity?.world).toEqual(world);
  });

  it("preserves prior devices and a carried inventory tree without exposing the old room", () => {
    const lift = segment("07-2");
    let previous = lift.enter(null);
    previous = executeFully(lift, previous, action("keeper", "take", "07-2-weight"));
    previous.entities["07-2-weight-mark"] = {
      ...structuredClone(previous.entities["07-2-weight"]), id: "07-2-weight-mark", name: "추 표식", parent: "07-2-weight",
      properties: { kind: "weight-mark", publicLabel: "추 표식" },
    };
    const entered = segment("07-3").enter(previous);
    expect(entered.entities["07-2-axis"]).toBeDefined();
    expect(entered.visible).not.toContain("07-2-axis");
    expect(entered.actors.keeper.carrying).toEqual(["07-2-weight"]);
    expect(entered.entities["07-2-weight"].parent).toBe("keeper");
    expect(entered.entities["07-2-weight-mark"].parent).toBe("07-2-weight");
    expect(entered.entities["07-2-weight-mark"].location).toEqual(entered.actors.keeper.location);
    expect(entered.visible).toEqual(expect.arrayContaining(["07-2-weight", "07-2-weight-mark"]));
  });

  it("rewinds a real same-body hold-and-leave failure with both actors restored", () => {
    const definition = segment("07-3");
    let run = createStageRun("theatre-role-failure", definition.enter(null));
    run = { ...run, notebook: writeProgram(run.notebook, literal("bad-role", "07-3", sequence(
      action("hero", "hold", "07-3-pressure"), action("hero", "move", "07-3-hero-exit"),
    ))) };
    run = departStage(run);
    for (let step = 0; step < 20 && run.world.attempt === 1; step += 1) run = restored(advanceStage(run, stageDynamics(THEATRE_STAGE)));
    expect(run.world.attempt).toBe(2);
    expect(run.phase).toBe("bookmark");
    expect(run.notebook.bells).toBe(1);
    expect(run.world.actors.hero.location.x).toBe(0);
    expect(run.world.actors.keeper.location.x).toBe(0);
    expect(run.world.entities["07-3-bridge"].properties.extended).toBe(false);
  });

  it("returns a same-actor parallel role conflict for free repair rather than inventing a companion action", () => {
    const definition = segment("07-3");
    let run = createStageRun("theatre-role-clarification", definition.enter(null));
    run = { ...run, notebook: writeProgram(run.notebook, literal("same-body", "07-3", parallel(
      action("hero", "hold", "07-3-pressure"), action("hero", "move", "07-3-far-rail"),
    ))) };
    run = departStage(run);
    run = restored(advanceStage(run, stageDynamics(THEATRE_STAGE)));
    expect(run.phase).toBe("bookmark");
    expect(run.notebook.bells).toBe(0);
    expect(run.notebook.clarificationId).toBe("same-body");
    expect(run.world.attempt).toBe(2);
  });

  it("stops an unbounded moon-light hold as a safe incomplete deadlock without a bell", () => {
    const definition = segment("07-5");
    let run = createStageRun("theatre-infinite-hold", definition.enter(null));
    run = { ...run, notebook: writeProgram(run.notebook, literal("hold-forever", "07-5", action("keeper", "hold", "07-5-moon-handle"))) };
    run = departStage(run);
    run = restored(advanceStage(run, stageDynamics(THEATRE_STAGE)));
    run = restored(advanceStage(run, stageDynamics(THEATRE_STAGE)));
    expect(run.phase).toBe("blocked");
    expect(run.notebook.bells).toBe(0);
    expect(run.world.actors.keeper.holding).toBe("07-5-moon-handle");
    expect(run.world.entities["07-5-latch"].properties.locked).toBe(false);
    expect(run.world.entities["07-5-curtain"].properties.open).toBe(false);
  });
});
