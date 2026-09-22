import { expect, it } from "vitest";
import { RAIN_INTRO } from "../src/campaign/stages/rain";
import { executePhysicalAction } from "../src/campaign/physics";
import type { PhysicalAction } from "../src/campaign/types";
const action = (verb: PhysicalAction["verb"], target: string, destination?: string): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...(destination ? { destination } : {}) });
it("02-1 cork load and current carry the hero to a dry exit", () => {
  let world = RAIN_INTRO.enter(null);
  for (const instruction of [action("push", "rain-cork", "rain-launch"), action("board", "rain-cork"), action("dismount", "rain-cork", "rain-platform")]) {
    const result = (RAIN_INTRO.execute ?? executePhysicalAction)(world, instruction);
    expect(result.outcome, result.reason).toBe("done");
    const environment = RAIN_INTRO.advance(result.world);
    expect(environment.failure).toBeUndefined();
    world = environment.world;
  }
  expect(RAIN_INTRO.complete(world)).toBe(true);
});
it("02-1 walking through the water is an actual failure", () => {
  const result = RAIN_INTRO.execute!(RAIN_INTRO.enter(null), action("move", "rain-platform"));
  expect(result.outcome).toBe("failure");
  expect(RAIN_INTRO.complete(result.world)).toBe(false);
});
it("exposes landing reach from physical distance, separately from being afloat", () => {
  let world = RAIN_INTRO.enter(null);
  expect(world.entities["rain-cork"].properties.landingReachable).toBe(false);
  world = RAIN_INTRO.advance(RAIN_INTRO.execute!(world, action("push", "rain-cork", "rain-launch")).world).world;
  expect(world.entities["rain-cork"].properties.afloat).toBe(true);
  expect(world.entities["rain-cork"].properties.landingReachable).toBe(false);
  world = RAIN_INTRO.advance(RAIN_INTRO.execute!(world, action("board", "rain-cork")).world).world;
  expect(world.entities["rain-cork"].properties.landingReachable).toBe(true);
  expect(RAIN_INTRO.execute!(world, action("dismount", "rain-cork", "rain-platform")).outcome).toBe("done");
  world.entities["rain-platform"].location.x = 20;
  world = RAIN_INTRO.advance(world).world;
  expect(world.entities["rain-cork"].properties.landingReachable).toBe(false);
});
it("02-1 leaving the launched cork unattended loses its reachable boarding window", () => {
  const moved = RAIN_INTRO.execute!(RAIN_INTRO.enter(null), action("push", "rain-cork", "rain-launch"));
  const first = RAIN_INTRO.advance(moved.world);
  expect(first.failure).toBeUndefined();
  const second = RAIN_INTRO.advance(first.world);
  expect(second.failure).toContain("손");
  expect(second.world.entities["rain-cork"].location.x).toBe(8);
});

import { RAIN_CHANNELS } from "../src/campaign/stages/rain";
it("02-2 direct inflow then cutoff and balanced small inflow both float the bridge", () => {
  for (const approach of ["gate", "plug"] as const) {
    let state = RAIN_CHANNELS.enter(null);
    const first = approach === "gate" ? action("open", "channels-gate") : action("push", "channels-plug", "channels-gap");
    state = RAIN_CHANNELS.advance(RAIN_CHANNELS.execute!(state, first).world).world;
    if (approach === "gate") state = RAIN_CHANNELS.advance(RAIN_CHANNELS.execute!(state, action("close", "channels-gate")).world).world;
    else { state = RAIN_CHANNELS.advance(state).world; state = RAIN_CHANNELS.advance(state).world; }
    expect(state.entities["channels-tank"].properties.level).toBe(3);
    if (approach === "plug") state = RAIN_CHANNELS.execute!(state, action("pull", "channels-tow")).world;
    for (const instruction of [action("board", "channels-bridge"), action("dismount", "channels-bridge", "channels-exit")]) {
      const moved = RAIN_CHANNELS.execute!(state, instruction);
      expect(moved.outcome, moved.reason).toBe("done");
      const environment = RAIN_CHANNELS.advance(moved.world);
      expect(environment.failure).toBeUndefined();
      state = environment.world;
    }
    expect(RAIN_CHANNELS.complete(state)).toBe(true);
    expect(state.entities["channels-gap"].properties.blocked).toBe(approach === "plug");
    expect(state.entities["channels-tank"].properties.inflow).toBe(approach === "plug" ? 1 : 0);
  }
});
it("02-2 continuing the fast inflow floods the start despite the overflow drain", () => {
  const initial = RAIN_CHANNELS.execute!(RAIN_CHANNELS.enter(null), action("open", "channels-gate"));
  const first = RAIN_CHANNELS.advance(initial.world);
  expect(first.failure).toBeUndefined();
  expect(RAIN_CHANNELS.advance(first.world).failure).toContain("잠겼어요");
});


import { createStageRun, departStage, advanceStage } from "../src/campaign/run";
import { writeProgram } from "../src/campaign/notebook";
import type { ProgramNode } from "../src/campaign/types";
it("02-2 a wait that is already satisfied consumes no extra flow tick before closing the gate", () => {
  let run = createStageRun("flow", RAIN_CHANNELS.enter(null));
  const body: ProgramNode = { kind: "sequence", children: [
    action("open", "channels-gate"),
    { kind: "wait", until: { kind: "property", entity: "channels-tank", property: "level", comparison: "gte", value: 3, source: "visible" } },
    action("close", "channels-gate"), action("board", "channels-bridge"), action("dismount", "channels-bridge", "channels-exit"),
  ] };
  run.notebook = writeProgram(run.notebook, { version: 2, id: "flow-plan", text: "수문을 열고 수위가 위 눈금에 닿으면 닫은 다음 부교를 타고 출구에서 내려", model: "physical-fixture", scope: {}, guard: false, body });
  run = departStage(run);
  for (let tick = 0; tick < 10 && run.phase !== "cleared"; tick++) {
    run = advanceStage(run, { execute: RAIN_CHANNELS.execute!, advance: RAIN_CHANNELS.advance, segmentComplete: RAIN_CHANNELS.complete, nextSegment: () => null, sealAfter: () => null });
  }
  expect(run.phase).toBe("cleared");
  expect(run.notebook.bells).toBe(0);
  expect(run.world.entities["channels-tank"].properties.level).toBe(3);
});
