import { describe, expect, it } from "vitest";
import { createCursor, stepProgram, type ProgramCursor } from "../src/campaign/program";
import { stageDynamics, type CampaignStageDefinition, type SegmentDefinition } from "../src/campaign/level";
import { propertyVisibility } from "../src/campaign/presentation";
import { advanceStage, createCampaignRun, departStage } from "../src/campaign/run";
import { writeProgram } from "../src/campaign/notebook";
import {
  QUIET_EARLY_INTENT_CASES,
  QUIET_FORGE_STAGE,
  QUIET_KITCHEN_STAGE,
  QUIET_RAIN_STAGE,
  quietEarlyProgram,
  type QuietEarlyIntentCase,
} from "../src/campaign/quiet/early";
import type { PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";

const stages: readonly CampaignStageDefinition[] = [QUIET_RAIN_STAGE, QUIET_KITCHEN_STAGE, QUIET_FORGE_STAGE];

function segment(stageId: number, segmentId: string): SegmentDefinition {
  const stage = stages.find((item) => item.id === stageId);
  const found = stage?.segments.find((item) => item.id === segmentId);
  if (!found) throw new Error(`missing ${segmentId}`);
  return found;
}

function physical(verb: PhysicalAction["verb"], target: string, destination?: string): PhysicalAction {
  return { kind: "action", actor: "hero", verb, target, ...(destination ? { destination } : {}) };
}

function play(definition: SegmentDefinition, body: ProgramNode): WorldState {
  let world = definition.enter(null);
  let cursor: ProgramCursor = createCursor();
  const execute = definition.execute;
  if (!execute) throw new Error(`${definition.id} has no executor`);
  for (let boundary = 0; boundary < 32 && !definition.complete(world); boundary += 1) {
    const stepped = stepProgram(world, body, cursor, execute, world);
    world = stepped.world;
    cursor = stepped.cursor;
    expect(["blocked", "clarification", "failure"], stepped.reason ?? "unexpected program stop").not.toContain(stepped.outcome);
    if (definition.complete(world)) break;
    if (stepped.outcome === "waiting" || stepped.actions.length > 0) {
      const environment = definition.advance(world);
      expect(environment.failure).toBeUndefined();
      world = environment.world;
    }
    if (stepped.outcome === "done" && stepped.actions.length === 0 && !definition.complete(world)) break;
  }
  return world;
}

function playInRuntime(intent: QuietEarlyIntentCase): WorldState {
  const source = stages.find((stage) => stage.id === intent.stageId);
  const definition = source?.segments.find((item) => item.id === intent.segmentId);
  if (!source || !definition) throw new Error(`missing ${intent.segmentId}`);
  const isolated: CampaignStageDefinition = { ...source, segments: [definition] };
  let run = createCampaignRun(`runtime-${intent.segmentId}`, isolated);
  run.notebook = writeProgram(run.notebook, quietEarlyProgram(intent));
  run = departStage(run);
  const dynamics = stageDynamics(isolated);
  for (let boundary = 0; boundary < 32 && (run.phase === "running" || run.phase === "waiting"); boundary += 1) {
    run = advanceStage(run, dynamics);
  }
  expect(run.phase, `${intent.segmentId}: ${run.statusReason}`).toBe("cleared");
  expect(run.clearedSegments).toContain(intent.segmentId);
  return run.world;
}

function inspectSolvedState(id: string, world: WorldState): void {
  switch (id) {
    case "02-v2-1":
      expect(world.entities[`${id}-box`].properties).toMatchObject({ blocksPath: false, position: "aside" });
      expect(world.entities[`${id}-box`].location.x).toBeLessThan(world.actors.hero.location.x);
      break;
    case "02-v2-2":
      expect(world.entities[`${id}-window`].properties.accessReady).toBe(true);
      expect(world.entities[`${id}-box`].location).toMatchObject({ x: 8, y: 0 });
      break;
    case "02-v2-3":
      expect(world.entities[`${id}-plank`].properties.extended).toBe(true);
      expect(world.entities[`${id}-plank`].location.x).toBe(5);
      break;
    case "02-v2-4": expect(world.entities[`${id}-cork`].properties.position).toBe("far"); break;
    case "02-v2-5": expect(world.entities[`${id}-pool`].properties).toMatchObject({ safe: true, level: "low" }); break;
    case "02-v2-6": expect(world.entities[`${id}-bridge`].properties).toMatchObject({ supported: true, stable: true }); break;
    case "03-v2-1": expect(world.actors.hero.location.x).toBe(9); break;
    case "03-v2-2": expect(world.entities[`${id}-bread`].parent).toBe("hero"); break;
    case "03-v2-3": expect(world.actors.hero.location.x).toBe(9); break;
    case "03-v2-4": expect(world.entities[`${id}-dough`].properties.raised).toBe(true); break;
    case "03-v2-5":
      expect(world.actors.hero.location.x).toBe(9);
      expect(world.actors.hero.riding).toBeNull();
      break;
    case "03-v2-6": expect(world.entities[`${id}-tray`].properties.safeToCross).toBe(true); break;
    case "04-v2-1": expect(world.entities[`${id}-windmill`].properties).toMatchObject({ active: true, spinning: true }); break;
    case "04-v2-2": expect(world.entities[`${id}-lift`].properties.raised).toBe(true); break;
    case "04-v2-3": expect(world.entities[`${id}-hotplate`].properties).toMatchObject({ heated: false, safe: true }); break;
    case "04-v2-4": expect(world.entities[`${id}-blades`].properties).toMatchObject({ active: false, spinning: false }); break;
    case "04-v2-5": expect(world.entities[`${id}-door`].properties).toMatchObject({ open: true, latched: true, suppliesWind: true }); break;
    case "04-v2-6": expect(world.entities[`${id}-duct`].properties).toMatchObject({ flowing: true, active: true, suppliesWind: true }); break;
    default: throw new Error(`no state assertion for ${id}`);
  }
}

const bypasses: Record<string, PhysicalAction> = {
  "02-v2-1": physical("move", "02-v2-1-exit"),
  "02-v2-2": physical("climb", "02-v2-2-window"),
  "02-v2-3": physical("move", "02-v2-3-bank"),
  "02-v2-4": physical("move", "02-v2-4-bank"),
  "02-v2-5": physical("move", "02-v2-5-stairs"),
  "02-v2-6": physical("move", "02-v2-6-exit"),
  "03-v2-1": physical("move", "03-v2-1-exit"),
  "03-v2-2": physical("take", "03-v2-2-bread"),
  "03-v2-3": physical("move", "03-v2-3-exit"),
  "03-v2-4": physical("climb", "03-v2-4-dough"),
  "03-v2-5": physical("move", "03-v2-5-exit"),
  "03-v2-6": physical("board", "03-v2-6-tray"),
  "04-v2-1": physical("turn", "04-v2-1-windmill"),
  "04-v2-2": physical("board", "04-v2-2-lift"),
  "04-v2-3": physical("move", "04-v2-3-exit"),
  "04-v2-4": physical("move", "04-v2-4-exit"),
  "04-v2-5": physical("turn", "04-v2-5-latch"),
  "04-v2-6": physical("move", "04-v2-6-exit"),
};

describe("quiet early campaign", () => {
  it("defines six quiet-v1 spatial scenes per chapter without onboarding", () => {
    expect(stages.map((stage) => stage.contentRevision)).toEqual(["quiet-v1", "quiet-v1", "quiet-v1"]);
    expect(stages.map((stage) => stage.segments.map((item) => item.id))).toEqual([
      ["02-v2-1", "02-v2-2", "02-v2-3", "02-v2-4", "02-v2-5", "02-v2-6"],
      ["03-v2-1", "03-v2-2", "03-v2-3", "03-v2-4", "03-v2-5", "03-v2-6"],
      ["04-v2-1", "04-v2-2", "04-v2-3", "04-v2-4", "04-v2-5", "04-v2-6"],
    ]);
    for (const stage of stages) {
      expect(stage.onboarding).toBeUndefined();
      expect(stage.practice.id).toBe(`${String(stage.id).padStart(2, "0")}-v2-practice`);
      expect(stage.practice.enter(null).segmentId).toBe(stage.practice.id);
      expect(stage.practice.complete(stage.practice.enter(null))).toBe(false);
      for (const definition of stage.segments) {
        const world = definition.enter(null);
        const authored = Object.values(world.entities).filter((entity) => entity.id !== "letter");
        expect(authored.length, definition.id).toBeGreaterThanOrEqual(2);
        expect(authored.length, definition.id).toBeLessThanOrEqual(4);
        expect(authored.every((entity) => entity.description === entity.name), definition.id).toBe(true);
        for (const entity of authored) {
          for (const property of Object.keys(entity.properties)) expect(propertyVisibility(property), `${entity.id}.${property}`).not.toBe("unknown");
        }
        expect(definition.scene?.floors.length, definition.id).toBeGreaterThan(0);
        for (const floor of definition.scene?.floors ?? []) {
          expect(floor.from).toBeGreaterThanOrEqual(0);
          expect(floor.to).toBeLessThanOrEqual(10);
          expect(floor.y).toBeGreaterThanOrEqual(0);
          expect(floor.y).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  for (const intent of QUIET_EARLY_INTENT_CASES) {
    it(`solves ${intent.segmentId} from a typed program and physical state`, () => {
      const definition = segment(intent.stageId, intent.segmentId);
      const world = playInRuntime(intent);
      expect(definition.complete(world), intent.text).toBe(true);
      inspectSolvedState(intent.segmentId, world);
    });

    it(`rejects a direct bypass in ${intent.segmentId}`, () => {
      const definition = segment(intent.stageId, intent.segmentId);
      const initial = definition.enter(null);
      const execute = definition.execute;
      if (!execute) throw new Error(`${definition.id} has no executor`);
      const result = execute(initial, bypasses[intent.segmentId]);
      expect(result.outcome).not.toBe("done");
      expect(definition.complete(result.world)).toBe(false);
    });
  }

  it("cycles every periodic public state into a valid wait boundary", () => {
    const probes = [
      [3, "03-v2-1", "03-v2-1-steam", "active", false],
      [3, "03-v2-2", "03-v2-2-oven", "open", true],
      [3, "03-v2-3", "03-v2-3-claw", "raised", true],
      [3, "03-v2-5", "03-v2-5-tray", "position", "near"],
      [3, "03-v2-6", "03-v2-6-steam", "active", false],
    ] as const;
    for (const [stageId, id, entityId, property, expected] of probes) {
      const definition = segment(stageId, id);
      const initial = definition.enter(null);
      const first = definition.advance(initial);
      expect(first.world.entities[entityId].properties[property], id).toBe(expected);
      expect(first.canChange, id).toBe(true);
    }
  });

  it("leaves the hero at a safe work position after each early object manipulation", () => {
    const cases = [
      ["02-v2-1", physical("push", "02-v2-1-box"), 3, "02-v2-1-box", 2],
      ["02-v2-2", physical("place", "02-v2-2-box", "02-v2-2-window"), 7, "02-v2-2-box", 8],
      ["02-v2-3", physical("place", "02-v2-3-plank", "02-v2-3-gap"), 3.5, "02-v2-3-plank", 5],
    ] as const;
    for (const [id, intent, heroX, objectId, objectX] of cases) {
      const definition = segment(2, id);
      const execute = definition.execute;
      if (!execute) throw new Error(`${id} has no executor`);
      const result = execute(definition.enter(null), intent);
      expect(result.outcome, id).toBe("done");
      expect(result.world.actors.hero.location, id).toMatchObject({ x: heroX, y: 0 });
      expect(result.world.entities[objectId].location.x, id).toBe(objectX);
      const floorUnderHero = definition.scene?.floors.some((floor) => floor.y === 0 && floor.from <= heroX && floor.to >= heroX);
      expect(floorUnderHero, id).toBe(true);
    }
    const windowScene = segment(2, "02-v2-2");
    expect(windowScene.scene?.floors.some((floor) => floor.y === 0 && floor.from <= 8 && floor.to >= 8)).toBe(true);
    expect(windowScene.scene?.floors.some((floor) => floor.y === 3 && floor.from <= 8 && floor.to >= 8)).toBe(true);
  });

  it("keeps reference resolution active in custom scene executors", () => {
    const definition = segment(2, "02-v2-1");
    const state = definition.enter(null);
    const unresolved: PhysicalAction = {
      kind: "action",
      actor: "hero",
      verb: "push",
      target: "ignored-literal",
      references: { target: { entity: "02-v2-1-box", property: "connectedTo", source: "remembered" } },
    };
    expect(definition.execute?.(state, unresolved).outcome).toBe("clarification");
    expect(state.entities["02-v2-1-box"].properties.blocksPath).toBe(true);
  });

  it("accepts equivalent structured verbs and explicit destinations", () => {
    const alternatives: readonly [number, string, ProgramNode][] = [
      [2, "02-v2-1", { kind: "sequence", children: [physical("pull", "02-v2-1-box"), physical("move", "02-v2-1-exit")] }],
      [2, "02-v2-2", { kind: "sequence", children: [physical("push", "02-v2-2-box", "02-v2-2-window"), physical("move", "02-v2-2-window")] }],
      [2, "02-v2-3", { kind: "sequence", children: [physical("pull", "02-v2-3-plank", "02-v2-3-bank"), physical("move", "02-v2-3-bank")] }],
      [2, "02-v2-4", { kind: "sequence", children: [physical("climb", "02-v2-4-cork"), physical("dismount", "02-v2-4-cork", "02-v2-4-bank")] }],
      [4, "04-v2-5", { kind: "sequence", children: [physical("open", "04-v2-5-door"), physical("close", "04-v2-5-latch")] }],
    ];
    for (const [stageId, id, body] of alternatives) {
      const definition = segment(stageId, id);
      expect(definition.complete(play(definition, body)), id).toBe(true);
    }
  });

  it("treats a supported bridge as a path to its far landing", () => {
    const definition = segment(2, "02-v2-6");
    const body: ProgramNode = {
      kind: "sequence",
      children: [
        physical("push", "02-v2-6-box", "02-v2-6-bridge"),
        physical("move", "02-v2-6-bridge"),
      ],
    };
    const solved = playInRuntime({
      stageId: 2,
      segmentId: "02-v2-6",
      text: "상자로 다리를 받치고 건너",
      body,
    });
    expect(definition.complete(solved)).toBe(true);
    expect(solved.actors.hero.location).toEqual(solved.entities["02-v2-6-exit"].location);
    expect(solved.entities["02-v2-6-bridge"].properties).toMatchObject({ supported: true, stable: true });

    const initial = definition.enter(null);
    const bypass = definition.execute?.(initial, physical("move", "02-v2-6-bridge"));
    expect(bypass?.outcome).toBe("failure");
    expect(definition.complete(bypass?.world ?? initial)).toBe(false);
  });

  it("does not invent an omitted exit after a lone box push", () => {
    const definition = segment(2, "02-v2-1");
    const initial = definition.enter(null);
    const pushed = definition.execute?.(initial, physical("push", "02-v2-1-box"));
    expect(pushed?.outcome).toBe("done");
    expect(pushed?.world.entities["02-v2-1-box"].properties.blocksPath).toBe(false);
    expect(pushed?.world.actors.hero.location.x).toBe(3);
    expect(definition.complete(pushed?.world ?? initial)).toBe(false);
  });

  it("lets a boarded delivery tray finish its physical trip without inventing the dismount", () => {
    const definition = segment(3, "03-v2-6");
    const initial = definition.enter(null);
    const steamStopped = definition.advance(initial).world;
    expect(steamStopped.entities["03-v2-6-steam"].properties.active).toBe(false);
    const boarded = definition.execute?.(steamStopped, physical("board", "03-v2-6-tray"));
    expect(boarded?.outcome).toBe("done");
    const arrived = definition.advance(boarded?.world ?? steamStopped).world;
    expect(arrived.entities["03-v2-6-tray"].properties.position).toBe("far");
    expect(arrived.actors.hero.riding).toBe("03-v2-6-tray");
    expect(arrived.actors.hero.location).toEqual(arrived.entities["03-v2-6-tray"].location);
    expect(definition.complete(arrived)).toBe(false);
  });

  it("creates dynamics that resolve every authored segment", () => {
    for (const stage of stages) {
      const dynamics = stageDynamics(stage);
      for (const definition of stage.segments) {
        expect(() => dynamics.segmentComplete(definition.enter(null))).not.toThrow();
      }
    }
  });
});
