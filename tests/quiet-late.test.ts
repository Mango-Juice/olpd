import { describe, expect, it } from "vitest";
import { stageDynamics, type SegmentDefinition } from "../src/campaign/level";
import { writeProgram } from "../src/campaign/notebook";
import { propertyVisibility } from "../src/campaign/presentation";
import { acknowledgePresentation, advanceStage, createStageRun, departStage, type StageRun } from "../src/campaign/run";
import {
  QUIET_FOG_STAGE,
  QUIET_LATE_REPRESENTATIVE_COMMANDS,
  QUIET_LATE_REPRESENTATIVE_PROGRAMS,
  QUIET_TOWER_STAGE,
  QUIET_WARDEN_STAGE,
} from "../src/campaign/quiet/late";
import { QUIET_LATE_LIVE_REGRESSION_CASES } from "./fixtures/quiet-late-intents";
import type { PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const stages = [QUIET_FOG_STAGE, QUIET_TOWER_STAGE, QUIET_WARDEN_STAGE] as const;
const stageBySegment = new Map(stages.flatMap((stage) => stage.segments.map((segment) => [segment.id, stage] as const)));
const action = (actor: "hero" | "keeper", verb: PhysicalAction["verb"], target: string, extra: Partial<PhysicalAction> = {}): PhysicalAction => ({ kind: "action", actor, verb, target, ...extra });

function segment(id: string): SegmentDefinition {
  const stage = stageBySegment.get(id);
  const found = stage?.segments.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function playBody(id: string, text: string, body: ProgramNode): StageRun {
  const stage = stageBySegment.get(id)!;
  let run = createStageRun(`quiet-${id}`, segment(id).enter(null));
  run.notebook = writeProgram(run.notebook, {
    version: 2,
    id: `replay-${id}`,
    text,
    model: "fixture",
    scope: { stageId: stage.id, region: id },
    guard: false,
    body,
  });
  run = departStage(run);
  const dynamics = stageDynamics(stage);
  for (let step = 0; step < 100 && (run.phase === "running" || run.phase === "waiting"); step++) {
    run = advanceStage(run, dynamics);
    if (run.presentation) run = acknowledgePresentation(run);
  }
  expect(run.clearedSegments, `${id}: ${run.phase} ${run.statusReason}`).toContain(id);
  return run;
}

function play(id: string): StageRun {
  const representative = QUIET_LATE_REPRESENTATIVE_PROGRAMS[id];
  return playBody(id, representative.text, representative.body);
}

describe("quiet late-stage content contract", () => {
  it("publishes six v2 encounters per chapter without onboarding", () => {
    for (const [index, stage] of stages.entries()) {
      const chapter = index + 8;
      expect(stage.contentRevision).toBe("shared-v1");
      expect(stage.onboarding).toBeUndefined();
      expect(stage.segments.map((item) => item.id)).toEqual(Array.from({ length: 6 }, (_, item) => `${String(chapter).padStart(2, "0")}-v2-${item + 1}`));
      expect(stage.practice).toBe(stage.segments[0]);
    }
    expect(QUIET_FOG_STAGE.story.text).toBe("먼저 보고 말해 주던 네가 있었지.");
    expect(QUIET_TOWER_STAGE.story.text).toBe("큰 종의 잔향 사이로 지나온 탑의 모든 방이 하나의 기계였다는 윤곽이 남았다.");
    expect(QUIET_WARDEN_STAGE.story).toMatchObject({ object: "letter", text: "여기까지는 내가 길을 적었어. 다음 길은 네가 골라 줘. 이제는 같이 가자." });
  });

  it("keeps every authored scene bounded, sparse, and vertically composed", () => {
    for (const stage of stages) for (const encounter of stage.segments) {
      expect(encounter.scene, encounter.id).toBeDefined();
      expect(encounter.scene!.floors.length, encounter.id).toBeGreaterThan(0);
      for (const floor of encounter.scene!.floors) {
        expect(floor.from, encounter.id).toBeGreaterThanOrEqual(0);
        expect(floor.to, encounter.id).toBeLessThanOrEqual(10);
        expect(floor.from, encounter.id).toBeLessThan(floor.to);
        expect(floor.y, encounter.id).toBeGreaterThanOrEqual(0);
        expect(floor.y, encounter.id).toBeLessThanOrEqual(4);
      }
      const world = encounter.enter(null);
      const objects = Object.values(world.entities).filter((entity) => entity.id !== "letter");
      expect(objects.length, encounter.id).toBeGreaterThanOrEqual(2);
      expect(objects.length, encounter.id).toBeLessThanOrEqual(4);
      for (const entity of objects) {
        expect(entity.location.x, entity.id).toBeGreaterThanOrEqual(0);
        expect(entity.location.x, entity.id).toBeLessThanOrEqual(10);
        expect(entity.location.y, entity.id).toBeGreaterThanOrEqual(0);
        expect(entity.location.y, entity.id).toBeLessThanOrEqual(4);
        expect(entity.description).toBe(entity.name);
        for (const property of Object.keys(entity.properties)) expect(propertyVisibility(property), `${entity.id}.${property}`).not.toBe("unknown");
      }
    }
    expect(segment("08-v2-2").scene!.floors.map((floor) => floor.y)).toEqual([1, 1]);
    expect(segment("08-v2-5").scene!.floors.map((floor) => floor.y)).toEqual([1, 1]);
    expect(segment("08-v2-4").scene!.floors.map((floor) => floor.y)).toEqual([0, 1, 2, 3, 4]);
    expect(segment("09-v2-3").scene!.floors.map((floor) => floor.y)).toEqual([0, 4]);
    expect(segment("10-v2-4").scene!.floors.map((floor) => floor.y)).toEqual([0, 4]);
  });

  it("exports one short representative command and typed program for every encounter", () => {
    const ids = stages.flatMap((stage) => stage.segments.map((item) => item.id));
    expect(Object.keys(QUIET_LATE_REPRESENTATIVE_PROGRAMS).sort()).toEqual([...ids].sort());
    expect(Object.keys(QUIET_LATE_REPRESENTATIVE_COMMANDS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(QUIET_LATE_REPRESENTATIVE_COMMANDS[id]).toBe(QUIET_LATE_REPRESENTATIVE_PROGRAMS[id].text);
      expect(QUIET_LATE_REPRESENTATIVE_COMMANDS[id].length, id).toBeLessThan(100);
    }
  });

  it("keeps visible Warden transformations out of the life retry checkpoint", () => {
    const dynamics = stageDynamics(QUIET_WARDEN_STAGE);
    expect(dynamics.sealAfter("10-v2-2")).toBeNull();
    expect(dynamics.sealAfter("10-v2-4")).toBeNull();
    expect(dynamics.sealAfter("10-v2-5")).toBeNull();
  });
});

it.each(Object.keys(QUIET_LATE_REPRESENTATIVE_PROGRAMS))("completes %s through typed actions and world-state predicates", (id) => {
  play(id);
});

it.each(QUIET_LATE_LIVE_REGRESSION_CASES)("replays first live AI body for $segmentId", ({ segmentId, text, body }) => {
  playBody(segmentId, text, body);
});

describe("quiet late-stage observation boundaries", () => {
  it("does not resolve the connected bridge before the window is observed", () => {
    const encounter = segment("08-v2-5");
    const initial = encounter.enter(null);
    expect(initial.entities["08-v2-5-window"].properties.connectedTo).toBe("unknown");
    expect(initial.facts).toHaveLength(0);
    const referenced = action("hero", "move", "08-v2-5-circle-bridge", {
      references: { target: { entity: "08-v2-5-window", property: "connectedTo", source: "remembered" } },
    });
    expect(encounter.execute!(initial, referenced).outcome).toBe("clarification");
    const observed = encounter.execute!(initial, action("hero", "observe", "08-v2-5-window"));
    expect(observed.outcome).toBe("done");
    expect(observed.reason).toContain("삼각 다리");
    expect(observed.world.facts).toEqual([
      expect.objectContaining({ entity: "08-v2-5-window", property: "connectedTo", value: "08-v2-5-triangle-bridge" }),
    ]);
    expect(encounter.execute!(observed.world, referenced).outcome).toBe("done");
  });

  it("reveals visible scene changes instead of copying every property into facts", () => {
    const fog = segment("08-v2-1");
    const cleared = fog.execute!(fog.enter(null), action("hero", "observe", "08-v2-1-mist"));
    expect(cleared.world.entities["08-v2-1-bridge"].properties).toMatchObject({ visible: true, safeToCross: true });
    expect(cleared.world.facts).toHaveLength(0);
    const bell = segment("09-v2-6");
    const seen = bell.execute!(bell.enter(null), action("hero", "observe", "09-v2-6-window"));
    expect(seen.world.entities["09-v2-6-bell"].properties.phase).toBe("near");
    expect(seen.world.facts).toHaveLength(0);
  });

  it("publishes possible bridge states without exposing which branch is connected", () => {
    const initial = segment("08-v2-2").enter(null);
    for (const id of ["08-v2-2-left-bridge", "08-v2-2-right-bridge"]) {
      expect(initial.entities[id].properties.visibleState).toBe("unknown");
      expect(initial.entities[id].properties).not.toHaveProperty("broken");
      expect(initial.entities[id].propertyOptions?.visibleState).toEqual(["unknown", "connected", "broken"]);
    }
    const observed = segment("08-v2-2").execute!(initial, action("hero", "observe", "08-v2-2-left-bridge"));
    expect(observed.world.entities["08-v2-2-left-bridge"].properties.visibleState).toBe("broken");
    expect(observed.world.entities["08-v2-2-right-bridge"].properties.visibleState).toBe("connected");
  });

  it("walks directly to the island only after observation leaves one connected route", () => {
    const encounter = segment("08-v2-2");
    const initial = encounter.enter(null);
    expect(encounter.execute!(initial, action("hero", "move", "08-v2-2-island")).outcome).toBe("blocked");

    const observed = encounter.execute!(initial, action("hero", "observe", "08-v2-2-left-bridge")).world;
    expect(encounter.execute!(observed, action("hero", "move", "08-v2-2-island")).outcome).toBe("done");

    const ambiguous = structuredClone(observed);
    ambiguous.entities["08-v2-2-left-bridge"].properties.visibleState = "connected";
    expect(encounter.execute!(ambiguous, action("hero", "move", "08-v2-2-island")).outcome).toBe("blocked");

    const disconnected = structuredClone(observed);
    disconnected.entities["08-v2-2-right-bridge"].properties.visibleState = "broken";
    expect(encounter.execute!(disconnected, action("hero", "move", "08-v2-2-island")).outcome).toBe("blocked");
  });
});

describe("quiet late-stage bypass and companion boundaries", () => {
  it("blocks crossing before the scene's visible prerequisite", () => {
    const checks: [string, PhysicalAction][] = [
      ["08-v2-1", action("hero", "move", "08-v2-1-exit")],
      ["08-v2-1", action("hero", "move", "08-v2-1-bridge")],
      ["08-v2-2", action("hero", "move", "08-v2-2-right-bridge")],
      ["08-v2-4", action("hero", "climb", "08-v2-4-stairs")],
      ["08-v2-6", action("hero", "board", "08-v2-6-boat")],
      ["09-v2-1", action("hero", "climb", "09-v2-1-stairs")],
      ["09-v2-4", action("hero", "move", "09-v2-4-stairs")],
      ["09-v2-3", action("hero", "dismount", "09-v2-3-lift", { destination: "09-v2-3-upper-floor" })],
      ["10-v2-2", action("hero", "climb", "10-v2-2-plate")],
      ["10-v2-3", action("hero", "move", "10-v2-3-inside")],
      ["10-v2-4", action("hero", "climb", "10-v2-4-wing")],
      ["10-v2-6", action("hero", "move", "10-v2-6-beyond")],
    ];
    for (const [id, attempt] of checks) expect(segment(id).execute!(segment(id).enter(null), attempt).outcome, id).not.toBe("done");
  });

  it("accepts semantic action families only at the same physical object and safe ownership boundary", () => {
    const fogStairs = segment("08-v2-4");
    expect(fogStairs.execute!(fogStairs.enter(null), action("hero", "turn", "08-v2-4-lantern", { destination: "08-v2-4-upper-floor" })).outcome).toBe("clarification");

    const support = segment("09-v2-1");
    const distant = support.enter(null);
    distant.actors.hero.location = { region: distant.segmentId, x: 9, y: 4 };
    expect(support.execute!(distant, action("hero", "place", "09-v2-1-support", { destination: "09-v2-1-stairs" })).outcome).toBe("clarification");

    const latch = segment("10-v2-5");
    expect(latch.execute!(latch.enter(null), action("keeper", "untie", "10-v2-5-latch")).outcome).toBe("clarification");
  });

  it("requires the keeper's explicit holding role before the hero crosses or unlatches", () => {
    const bridge = segment("09-v2-5");
    const bridgeWorld = bridge.enter(null);
    expect(bridge.execute!(bridgeWorld, action("hero", "hold", "09-v2-5-handle")).outcome).toBe("clarification");
    expect(bridge.execute!(bridgeWorld, action("hero", "move", "09-v2-5-bridge")).outcome).toBe("blocked");
    expect(bridge.execute!(bridgeWorld, action("keeper", "move", "09-v2-5-meeting")).outcome).toBe("blocked");

    const latch = segment("10-v2-5");
    const latchWorld = latch.enter(null);
    expect(latch.execute!(latchWorld, action("hero", "hold", "10-v2-5-ring")).outcome).toBe("clarification");
    expect(latch.execute!(latchWorld, action("hero", "pull", "10-v2-5-latch")).outcome).toBe("blocked");
    expect(latch.execute!(latchWorld, action("keeper", "pull", "10-v2-5-latch")).outcome).toBe("clarification");
  });

  it("requires both actors to arrive and preserves the hero's ending letter", () => {
    const encounter = segment("10-v2-6");
    let world: WorldState = encounter.enter(null);
    expect(encounter.execute!(world, action("keeper", "open", "10-v2-6-door")).outcome).toBe("clarification");
    world = encounter.execute!(world, action("hero", "open", "10-v2-6-door")).world;
    world = encounter.execute!(world, action("hero", "move", "10-v2-6-beyond")).world;
    expect(encounter.complete(world)).toBe(false);
    world = encounter.execute!(world, action("keeper", "move", "10-v2-6-beyond")).world;
    expect(encounter.complete(world)).toBe(true);
    expect(world.entities.letter.parent).toBe("hero");
    expect(world.entities.letter.properties.recipient).toBe("hero");
    expect(world.actors.hero.carrying).toContain("letter");
  });
});
