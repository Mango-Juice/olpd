import { describe, expect, it } from "vitest";
import { stageDynamics } from "../src/campaign/level";
import { acknowledgePresentation, advanceStage, createStageRun, departStage, writeStageProgram, type StageRun } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import { WARDEN_STAGE } from "./fixtures/campaign-worlds/warden";
import { deepSeekPublicWorld } from "../server/campaign-deepseek";
import type { PhysicalAction, Predicate, ProgramNode, Scalar, WorldState } from "../src/campaign/types";

const stage = WARDEN_STAGE;
const dynamics = stageDynamics(stage);
const action = (verb: PhysicalAction["verb"], target: string, extra: Partial<PhysicalAction> = {}): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...extra });
const seq = (...children: ProgramNode[]): ProgramNode => ({ kind: "sequence", children });
const par = (...children: ProgramNode[]): ProgramNode => ({ kind: "parallel", children });
const condition = (entity: string, property: string, value: Scalar): Predicate => ({ kind: "property", entity, property, value, comparison: "eq", source: "visible" });
const wait = (entity: string, property: string, value: Scalar): ProgramNode => ({ kind: "wait", until: condition(entity, property, value) });
const turnTo = (route: string): ProgramNode => ({ kind: "until", body: action("turn", "10-2-vane"), condition: condition("10-2-vane", "route", route) });
function play(index: number, body: ProgramNode, initial?: WorldState, restore = false): StageRun {
  let run = createStageRun(`warden-${index}`, initial ?? stage.segments[index].enter(null));
  run = writeStageProgram(run, { version: 2, id: `plan-${index}`, text: "공개된 관계를 따라 실제로 조작한다.", model: "fixture", scope: { stageId: 10, region: run.world.actors.hero.location.region }, guard: false, body });
  run = departStage(run);
  for (let i = 0; i < 300 && (run.phase === "running" || run.phase === "waiting"); i++) {
    run = advanceStage(acknowledgePresentation(run), dynamics);
    if (restore) { const saved = parseStageRun(JSON.parse(JSON.stringify(run))); expect(saved, `invalid save at ${run.world.segmentId}: ${run.statusReason}`).not.toBeNull(); run = saved!; }
  }
  expect(run.clearedSegments, `${stage.segments[index].id}: ${run.phase} ${run.statusReason}`).toContain(stage.segments[index].id);
  return run;
}
const gestureA = seq(action("move", "10-1-alcove"), wait("10-1-arm", "phase", "retracted"), action("jump", "10-1-gap"), action("move", "10-1-console"));
const gestureB = seq(action("climb", "10-1-walkway"), action("place", "10-1-plank", { destination: "10-1-gap" }), action("climb", "10-1-alcove"), action("duck", "10-1-console"));
const pinA = seq(turnTo("pressure"), wait("10-2-pin", "removed", true), turnTo("vent"), action("climb", "10-2-balcony"));
const pinB = seq(turnTo("turbine"), wait("10-2-heavy-weight", "latched", true), turnTo("vent"), action("pull", "10-2-release"), action("climb", "10-2-balcony"));
function garden(reinforce: boolean): ProgramNode {
  const children: ProgramNode[] = [];
  for (const side of ["normal", "inverse"]) {
    if (side === "inverse") children.push(action("move", "10-3-inverse-entry"));
    children.push(action("move", `10-3-${side}-${reinforce ? "support" : "empty"}`));
    if (reinforce) children.push(action("place", `10-3-${side}-support`, { destination: `10-3-${side}-grid` }));
    children.push(action("push", `10-3-${side}-${reinforce ? "glass" : "empty"}`, { destination: `10-3-${side}-step` }));
    children.push(action("move", side === "normal" ? "10-3-boundary" : "10-3-console"));
  }
  return seq(...children);
}
const toolA = seq(action("take", "10-4-plank"), action("place", "10-4-plank", { destination: "10-4-front-plate" }), action("move", "10-4-inside-latch"), action("pull", "10-4-inside-latch"), action("move", "10-4-front-plate"), action("take", "10-4-plank"), action("move", "10-4-rear-plate"), action("place", "10-4-plank", { destination: "10-4-rear-plate" }), action("move", "10-4-seal-handle"), action("pull", "10-4-seal-handle"));
const toolB = seq(action("take", "10-4-plank"), action("take", "10-4-wedge"), action("climb", "10-4-side-start"), action("place", "10-4-plank", { destination: "10-4-side-gap" }), action("climb", "10-4-side-end"), action("pull", "10-4-inside-latch"), action("take", "10-4-plank"), action("move", "10-4-inside-latch"), action("move", "10-4-rear-plate"), action("place", "10-4-plank", { destination: "10-4-rear-plate" }), action("place", "10-4-wedge", { destination: "10-4-rear-socket" }), action("take", "10-4-plank"), action("move", "10-4-seal-handle"), action("pull", "10-4-seal-handle"));
const joinWorkbench = par(action("move", "10-5-workbench"), action("move", "10-5-workbench", { actor: "keeper" }));
const sightA = seq(action("observe", "10-5-scope"), joinWorkbench);
const sightB = seq(action("open", "10-5-vent"), joinWorkbench);
const locked = condition("10-6-lock-plate", "locked", true);
function held(actor: "hero" | "keeper", referenced = false): PhysicalAction {
  return action("hold", referenced ? "10-5-left-map" : "10-5-left-handle", { actor, ...(referenced ? { references: { target: { entity: "10-5-left-map", property: "connectedTo", source: "remembered" as const } } } : {}) });
}
function finalA(referenced = false): ProgramNode {
  return par(
    seq({ kind: "until", body: held("keeper", referenced), condition: locked }, action("move", "10-6-keeper-exit", { actor: "keeper" })),
    seq(action("hold", "10-5-right-handle"), action("place", "10-6-wedge", { destination: "10-6-right-socket" }), action("move", "10-6-lock-plate"), action("move", "10-6-hero-exit"), wait("10-6-keeper-exit", "keeperArrived", true), action("open", "10-6-delivery-door")),
  );
}
const finalB = seq(action("take", "10-6-weight", { actor: "keeper" }), action("place", "10-6-weight", { actor: "keeper", destination: "10-6-right-plate" }), par(
  seq({ kind: "until", body: held("hero"), condition: locked }, action("move", "10-6-hero-exit"), wait("10-6-keeper-exit", "keeperArrived", true), action("open", "10-6-delivery-door")),
  seq(action("move", "10-6-lock-plate", { actor: "keeper" }), action("move", "10-6-keeper-exit", { actor: "keeper" })),
));

it.each([
  [0, "event and jump", gestureA], [0, "boardwalk and plank", gestureB],
  [1, "direct pressure", pinA], [1, "stored falling weight", pinB],
  [2, "empty rail boxes", garden(false)], [2, "reinforced glass boxes", garden(true)],
  [3, "front plate and recovered plank", toolA], [3, "side gap and recovered plank", toolB],
  [4, "observed connections", sightA], [4, "ventilation", sightB],
  [5, "hero crosses first", finalA()], [5, "keeper crosses first", finalB],
] as const)("core %i completes %s through the real scheduler", (index, _label, plan) => { play(index, plan, undefined, true); });


it("defaults to an already opened safe approach without choosing or actuating a seal solution", () => {
  const run = play(1, seq(turnTo("pressure"), wait("10-2-pin", "removed", true), turnTo("vent")));
  expect(run.events.some((event) => event.instructionId === null && event.target === "10-2-balcony" && event.actor === "hero")).toBe(true);
  expect(run.notebook.instructions).toHaveLength(1);
  expect(run.notebook.deaths).toBe(0);
  const last = departStage(createStageRun("no-auto-role", stage.segments[5].enter(null)));
  const paused = advanceStage(last, dynamics);
  expect(paused.phase).toBe("blocked");
  expect(paused.world.actors.hero.location.x).toBe(0);
  expect(paused.world.actors.keeper.holding).toBeNull();
  expect(paused.world.entities["10-6-lock-plate"].properties.locked).toBe(false);
});

describe("warden physical boundaries", () => {
  it("a misplaced direct plank cannot replace the upper walkway and an early jump collides", () => {
    const initial = stage.segments[0].enter(null);
    expect(stage.segments[0].execute!(initial, action("place", "10-1-plank", { destination: "10-1-gap" })).outcome).toBe("clarification");
    let state = stage.segments[0].execute!(initial, action("move", "10-1-alcove")).world;
    expect(stage.segments[0].execute!(state, action("jump", "10-1-console")).outcome).toBe("failure");
    for (let i = 0; i < 3; i++) state = stage.segments[0].execute!(state, action("climb", "10-1-walkway")).world;
    expect(stage.segments[0].execute!(state, action("move", "10-1-console")).outcome).toBe("blocked");
  });

  it("an early release cannot remove a pin later, incomplete lifting resets, and a caught pin stays out", () => {
    const segment = stage.segments[1]; let state = segment.enter(null);
    state = segment.execute!(state, action("pull", "10-2-release")).world;
    state = segment.execute!(state, action("turn", "10-2-vane")).world;
    state = segment.advance(state).world;
    expect(state.entities["10-2-heavy-weight"].properties.height).toBe(1);
    state = segment.execute!(state, action("turn", "10-2-vane", { amount: 2 })).world;
    state = segment.advance(state).world;
    expect(state.entities["10-2-heavy-weight"].properties.height).toBe(0);
    state = segment.execute!(state, action("turn", "10-2-vane")).world;
    for (let i = 0; i < 3; i++) state = segment.advance(state).world;
    expect(state.entities["10-2-heavy-weight"].properties.latched).toBe(true);
    expect(state.entities["10-2-pin"].properties.removed).toBe(false);
    state = segment.execute!(state, action("turn", "10-2-vane", { amount: 2 })).world;
    state = segment.execute!(state, action("pull", "10-2-release")).world;
    expect(state.entities["10-2-heavy-weight"].properties.height).toBe(0);
    expect(state.entities["10-2-heavy-weight"].properties.latched).toBe(false);
    for (let i = 0; i < 5; i++) state = segment.advance(state).world;
    expect(state.entities["10-2-pin"].properties.latchedOut).toBe(true);
  });

  it("glass fails only under unsupported load and a direct named movement cannot skip a step", () => {
    const segment = stage.segments[2]; let state = segment.enter(null);
    state = segment.execute!(state, action("move", "10-3-normal-glass")).world;
    expect(segment.execute!(state, action("push", "10-3-normal-glass", { destination: "10-3-normal-step" })).outcome).toBe("failure");
    expect(segment.execute!(state, action("take", "10-3-normal-empty")).outcome).toBe("clarification");
    expect(segment.execute!(state, action("move", "10-3-boundary")).outcome).toBe("blocked");
    expect(segment.execute!(state, action("push", "10-3-normal-empty", { destination: "10-3-inverse-step" })).outcome).toBe("clarification");
  });

  it("does not allow reaching through doors, wedging closed doors, or pressing a plate with a light wedge", () => {
    const segment = stage.segments[3]; let state = segment.enter(null);
    expect(segment.execute!(state, action("pull", "10-4-inside-latch")).outcome).toBe("clarification");
    expect(segment.execute!(state, action("pull", "10-4-seal-handle")).outcome).toBe("clarification");
    expect(segment.execute!(state, action("place", "10-4-wedge", { destination: "10-4-rear-socket" })).outcome).toBe("blocked");
    state = segment.execute!(state, action("place", "10-4-wedge", { destination: "10-4-front-plate" })).world;
    expect(state.entities["10-4-front-door"].properties.open).toBe(false);
  });

  it("carries real connection facts into the very same handles in the next segment", () => {
    const observed = play(4, sightA);
    expect(observed.world.segmentId).toBe("10-6");
    expect(observed.world.visible).not.toContain("10-5-left-map");
    expect(observed.world.facts).toEqual(expect.arrayContaining([expect.objectContaining({ entity: "10-5-left-map", property: "connectedTo", value: "10-5-left-handle", attempt: 1 })]));
    expect(observed.world.entities["10-5-left-handle"].location.region).toBe("10-6");
    expect(JSON.stringify(deepSeekPublicWorld(observed.world))).not.toContain('"connection-sample"');
    expect(play(5, finalA(true), observed.world, true).phase).toBe("cleared");
    const vented = play(4, sightB);
    expect(vented.world.visible).toContain("10-5-left-map");
    expect(vented.world.facts).toHaveLength(0);
  });

  it("does not disclose hidden relations through handle properties or descriptions", () => {
    const segment = stage.segments[4]; let state = segment.enter(null);
    state = segment.execute!(state, action("move", "10-5-workbench")).world;
    const context = deepSeekPublicWorld(state);
    expect(context.entities.some((item) => item.id === "10-5-left-map")).toBe(false);
    const handle = context.entities.find((item) => item.id === "10-5-left-handle")!;
    expect(handle.properties).not.toHaveProperty("connectedTo");
    expect(handle.description ?? handle.name).not.toContain("왼쪽");
    state = segment.execute!(state, action("move", "10-5-scope")).world;
    expect(state.visible).toContain("10-5-left-map");
  });

  it("uses the magnifier as an explicit observation instrument only at the actual balcony", () => {
    const segment = stage.segments[4];
    const command = action("observe", "10-5-left-map", { instrument: "10-5-scope" });
    const observed = segment.execute!(segment.enter(null), command);
    expect(observed.outcome).toBe("done");
    expect(observed.world.facts).toEqual(expect.arrayContaining([expect.objectContaining({ entity: "10-5-left-map", property: "connectedTo", value: "10-5-left-handle" })]));
    const distant = structuredClone(observed.world); distant.actors.hero.location.x = 3;
    expect(segment.execute!(distant, command).outcome).toBe("clarification");
    expect(segment.execute!(observed.world, action("observe", "10-5-workbench", { instrument: "10-5-scope" })).outcome).toBe("clarification");
  });

  it("the arm remains dangerous when a hero waits in its central sweep", () => {
    const segment = stage.segments[0], state = segment.enter(null);
    state.actors.hero.location.x = 3; state.tick = 10;
    const next = segment.advance(state);
    expect(next.failure).toContain("중앙 통로");
  });

  it("requires actual plate contact, rejects a keeper opening the letter, and never wins on door-open alone", () => {
    const segment = stage.segments[5]; let state = segment.enter(null);
    state = segment.execute!(state, action("hold", "10-5-left-handle", { actor: "keeper" })).world;
    state = segment.execute!(state, action("hold", "10-5-right-handle")).world;
    expect(state.entities["10-6-work-door"].properties.open).toBe(true);
    expect(segment.complete(state)).toBe(false);
    expect(segment.execute!(state, action("push", "10-6-lock-plate")).outcome).toBe("clarification");
    expect(segment.execute!(state, action("open", "10-6-delivery-door", { actor: "keeper" })).outcome).toBe("clarification");
    expect(state.visible).not.toContain("10-6-ending-letter");
    expect(segment.execute!(state, action("place", "10-6-wedge", { actor: "keeper", destination: "10-6-right-socket" })).outcome).toBe("clarification");
  });

  it("moving a holder releases support before crossing", () => {
    const segment = stage.segments[5]; let state = segment.enter(null);
    state = segment.execute!(state, action("hold", "10-5-left-handle", { actor: "keeper" })).world;
    state = segment.execute!(state, action("hold", "10-5-right-handle")).world;
    state = segment.execute!(state, action("move", "10-6-lock-plate")).world;
    expect(state.actors.hero.holding).toBeNull();
    expect(state.entities["10-6-work-door"].properties.open).toBe(false);
    expect(segment.execute!(state, action("move", "10-6-lock-plate")).outcome).toBe("failure");
  });
});
