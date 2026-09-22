import { expect, it } from "vitest";
import { advanceStage, createStageRun, departStage, rewindStage, type StageDynamics } from "../src/campaign/run";
import { writeProgram } from "../src/campaign/notebook";
import type { WorldState } from "../src/campaign/types";
const world = (stageId: 2 | 10 = 2): WorldState => ({ stageId, segmentId: `${stageId}-1`, tick: 0, attempt: 1, entities: { box: { id: "box", name: "상자", description: "상자", material: "wood", movable: true, weight: 1, capacity: 1, reach: 1, parent: null, location: { region: "fixture", x: 0, y: 0 }, properties: {} } }, actors: {}, visible: [], facts: [] });
const dynamics: StageDynamics = { execute: (state) => ({ world: state, outcome: "done", reason: "ok" }), advance: (state) => ({ world: state, events: [], canChange: false }), segmentComplete: () => true, nextSegment: (state) => ({ ...state, segmentId: `${state.stageId}-2` }), sealAfter: () => null };
function started(stageId: 2 | 10 = 2) {
  const run = createStageRun("test", world(stageId));
  run.notebook = writeProgram(run.notebook, { version: 2, id: "line", text: "상자를 밀어", model: "fixture", scope: {}, guard: false, body: { kind: "action", actor: "hero", verb: "push", target: "box" } });
  return departStage(run);
}
it("discovery grants never become ordinary-stage respawn checkpoints", () => {
  const next = advanceStage(started(), dynamics);
  expect(next.phase).toBe("bookmark");
  expect(next.world.segmentId).toBe("2-2");
  expect(next.notebook.canWrite).toBe(true);
  expect(next.events[0].instructionId).toBe("line");
  const rewound = rewindStage(next);
  expect(rewound.world.segmentId).toBe("2-1");
  expect(rewound.notebook.visitedBookmarks).toEqual(["2-1", "2-2"]);
  expect(rewound.notebook.bells).toBe(1);
});
it("boss seal transition stores the next seal world, preserving prior discovery", () => {
  const next = advanceStage(started(10), { ...dynamics, sealAfter: () => 1 });
  expect(next.seal).toBe(1);
  const rewound = rewindStage(next);
  expect(rewound.world.segmentId).toBe("10-2");
  expect(rewound.world.attempt).toBe(2);
  expect(rewound.seal).toBe(1);
});
it("physical failure rewinds with one bell and one writing chance", () => {
  const next = advanceStage(started(), { ...dynamics, execute: (state) => ({ world: state, outcome: "failure", reason: "판자가 하중을 버티지 못했어요." }) });
  expect(next.world.attempt).toBe(2);
  expect(next.notebook.bells).toBe(1);
  expect(next.notebook.canWrite).toBe(true);
  expect(next.events[0].outcome).toBe("failure");
  expect(next.clearedSegments).toEqual([]);
});
it("a blocked physical action never clears a still-unmet goal or charges a bell", () => {
  const next = advanceStage(started(), { ...dynamics, execute: (state) => ({ world: state, outcome: "blocked", reason: "문이 닫혀 있어요." }), segmentComplete: () => false });
  expect(next.phase).toBe("blocked");
  expect(next.notebook.bells).toBe(0);
  expect(next.clearedSegments).toEqual([]);
});

it("waits for an observable conditional instruction while an autonomous mechanism changes", () => {
  const initial = started();
  initial.notebook.instructions[0].condition = { kind: "property", entity: "signal", property: "ready", comparison: "eq", value: true, source: "visible" };
  initial.world.entities.signal = { id: "signal", name: "신호", description: "신호", material: "metal", movable: false, weight: 1, capacity: 0, reach: 1, parent: null, location: { region: "2-1", x: 0, y: 0 }, properties: { ready: false } };
  initial.world.visible = ["signal"];
  const dynamic: StageDynamics = { ...dynamics, segmentComplete: () => false, advance: (state) => {
    const next = structuredClone(state);
    next.entities.signal.properties.ready = true;
    return { world: next, events: [], canChange: true };
  } };
  const first = advanceStage(initial, dynamic);
  expect(first.phase).toBe("waiting");
  expect(first.events.filter((event) => event.actor !== null)).toHaveLength(0);
  expect(first.events[0].changes).toContainEqual({ entity: "signal", property: "ready", before: false, after: true });
  const second = advanceStage(first, dynamic);
  expect(second.events.filter((event) => event.actor !== null)).toHaveLength(1);
  expect(second.events.find((event) => event.actor !== null)?.instructionId).toBe("line");
});

it("reevaluates a wait after a mechanism's final transition even when it cannot change again", () => {
  let run = started();
  run.world.visible = ["box"];
  run.world.entities.box.properties.cooled = false;
  run.notebook.instructions[0].body = { kind: "wait", until: { kind: "property", entity: "box", property: "cooled", comparison: "eq", value: true, source: "visible" } };
  const finalTransition: StageDynamics = { ...dynamics, segmentComplete: () => false, advance: (state) => {
    const next = structuredClone(state);
    next.entities.box.properties.cooled = true;
    return { world: next, events: [], canChange: false };
  } };
  run = advanceStage(run, finalTransition);
  expect(run.phase).toBe("waiting");
  run = advanceStage(run, finalTransition);
  expect(run.execution.active).toBeNull();
  expect(run.phase).toBe("running");
  expect(run.notebook.bells).toBe(0);
});

it("stops a repeating mechanical cycle whose wait condition never becomes true", () => {
  let run = started();
  run.world.entities.signal = { id: "signal", name: "신호", description: "두 상태를 반복하는 신호", material: "metal", movable: false, weight: 1, capacity: 0, reach: 1, parent: null, location: { region: "2-1", x: 0, y: 0 }, properties: { phase: 0 } };
  run.world.visible = ["signal"];
  run.notebook.instructions[0].body = { kind: "wait", until: { kind: "property", entity: "signal", property: "phase", comparison: "eq", value: 3, source: "visible" } };
  const cycle: StageDynamics = { ...dynamics, segmentComplete: () => false, advance: (state) => {
    const next = structuredClone(state);
    next.tick++;
    next.entities.signal.properties.phase = next.entities.signal.properties.phase === 0 ? 1 : 0;
    return { world: next, events: [], canChange: true };
  } };
  for (let step = 0; step < 5 && run.phase !== "blocked"; step++) run = advanceStage(run, cycle);
  expect(run.phase).toBe("blocked");
  expect(run.notebook.bells).toBe(0);
  expect(run.statusReason).toContain("같은 상태");
});

it("marks identical successful replay for compressed presentation while recomputing physics", () => {
  let calls = 0;
  const replay: StageDynamics = { ...dynamics, segmentComplete: () => false, execute: (state) => { calls++; return { world: state, outcome: "done", reason: "ok" }; } };
  const first = advanceStage(started(), replay);
  const again = advanceStage(departStage(rewindStage(first)), replay);
  expect(calls).toBe(2);
  expect(first.events[0].repeated).toBe(false);
  expect(again.events[1].repeated).toBe(true);
});
