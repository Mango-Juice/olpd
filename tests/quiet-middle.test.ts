import { describe, expect, it } from "vitest";
import type { CampaignStageDefinition, SegmentDefinition } from "../src/campaign/level";
import { createCursor, stepProgram, type ProgramCursor } from "../src/campaign/program";
import type { PhysicalAction, ProgramNode, WorldState } from "../src/campaign/types";
import { QUIET_GARDEN_STAGE, QUIET_STOREHOUSE_STAGE, QUIET_THEATRE_STAGE } from "../src/campaign/quiet/middle";
import { QUIET_MIDDLE_INTENT_CASES, type QuietMiddleIntentCase } from "./fixtures/quiet-middle-intents";

const action = (
  actor: "hero" | "keeper",
  verb: PhysicalAction["verb"],
  target: string,
  extra: Partial<Pick<PhysicalAction, "destination" | "instrument">> = {},
): PhysicalAction => ({ kind: "action", actor, verb, target, ...extra });

interface Probe extends QuietMiddleIntentCase {
  stage: CampaignStageDefinition;
  actions: PhysicalAction[];
}

function actionsIn(node: ProgramNode): PhysicalAction[] {
  if (node.kind === "action") return [node];
  if (node.kind === "sequence" || node.kind === "parallel") return node.children.flatMap(actionsIn);
  throw new Error("quiet middle probe bodies must be actions or sequences");
}

const stageById = new Map<number, CampaignStageDefinition>([
  [5, QUIET_GARDEN_STAGE], [6, QUIET_STOREHOUSE_STAGE], [7, QUIET_THEATRE_STAGE],
]);

const probes: readonly Probe[] = QUIET_MIDDLE_INTENT_CASES.map((probe) => ({
  ...probe,
  stage: stageById.get(probe.stageId)!,
  actions: actionsIn(probe.body),
}));

function definition(probe: Probe): SegmentDefinition {
  const found = probe.stage.segments.find((segment) => segment.id === probe.segmentId);
  if (!found) throw new Error(`missing ${probe.segmentId}`);
  return found;
}

function execute(definition: SegmentDefinition, world: WorldState, next: PhysicalAction): WorldState {
  const result = definition.execute?.(world, next);
  expect(result, `${definition.id}/${next.actor}/${next.verb}`).toBeDefined();
  expect(result!.outcome, `${definition.id}/${next.actor}/${next.verb}: ${result!.reason}`).toBe("done");
  return result!.world;
}

function play(probe: Probe): WorldState {
  const current = definition(probe);
  let world = current.enter(null);
  for (const next of probe.actions) world = execute(current, world, next);
  return world;
}

function playProgram(probe: Probe): WorldState {
  const current = definition(probe);
  let world = current.enter(null);
  let cursor: ProgramCursor = createCursor();
  for (let count = 0; count < 20; count += 1) {
    const next = stepProgram(world, probe.body, cursor, current.execute!);
    world = next.world;
    cursor = next.cursor;
    if (next.outcome === "done") return world;
    expect(["progress", "waiting"], `${probe.segmentId}: ${next.reason}`).toContain(next.outcome);
  }
  throw new Error(`${probe.segmentId} did not finish its typed program`);
}

describe("quiet middle solutions", () => {
  it.each(probes.map((probe) => [probe.segmentId, probe] as const))("completes %s with physical actions", (_id, probe) => {
    const world = play(probe);
    expect(definition(probe).complete(world)).toBe(true);
  });

  it("keeps all carried tools on their actual owner and position", () => {
    for (const probe of probes.filter((item) => item.stage.id === 6)) {
      const world = play(probe);
      for (const tool of Object.values(world.entities).filter((entity) => entity.properties.tool)) {
        if (tool.parent !== "hero") continue;
        expect(world.actors.hero.carrying).toContain(tool.id);
        expect(tool.location).toEqual(world.actors.hero.location);
      }
    }
  });

  it.each([5, 10, 14, 16, 17].map((index) => [probes[index].segmentId, probes[index]] as const))(
    "replays observed live AST shape for %s",
    (_id, probe) => expect(definition(probe).complete(playProgram(probe))).toBe(true),
  );

  it("moves actors to each safe interaction point before the state changes", () => {
    const dark = QUIET_STOREHOUSE_STAGE.segments[0];
    const taken = execute(dark, dark.enter(null), action("hero", "take", "06-v2-lantern"));
    expect(taken.actors.hero.location).toEqual(taken.entities["06-v2-lantern"].location);

    const climb = QUIET_STOREHOUSE_STAGE.segments[1];
    const hung = execute(climb, climb.enter(null), action("hero", "place", "06-v2-lantern", { destination: "06-v2-2-hook" }));
    expect(hung.actors.hero.location.x).toBe(hung.entities["06-v2-2-hook"].location.x);
    expect(hung.entities["06-v2-lantern"].location).toEqual(hung.entities["06-v2-2-hook"].location);

    const key = QUIET_STOREHOUSE_STAGE.segments[3];
    const opened = execute(key, key.enter(null), action("hero", "open", "06-v2-4-door", { instrument: "06-v2-key" }));
    expect(opened.actors.hero.location).toEqual(opened.entities["06-v2-4-door"].location);
    expect(opened.entities["06-v2-key"].location).toEqual(opened.actors.hero.location);

    const held = QUIET_THEATRE_STAGE.segments[1];
    const raised = execute(held, held.enter(null), action("keeper", "hold", "07-v2-2-grip"));
    expect(raised.actors.keeper.location).toEqual(raised.entities["07-v2-2-grip"].location);
  });
});

describe("quiet middle bypasses and ownership", () => {
  it("rejects walking through thorns and jumping into the low vine", () => {
    const thorn = QUIET_GARDEN_STAGE.segments[1];
    expect(thorn.execute?.(thorn.enter(null), action("hero", "move", "05-v2-2-exit"))?.outcome).toBe("failure");
    const vine = QUIET_GARDEN_STAGE.segments[2];
    expect(vine.execute?.(vine.enter(null), action("hero", "jump", "05-v2-3-exit"))?.outcome).toBe("failure");
  });

  it("cannot skip the arch or combine the vine and thorn into one jump", () => {
    const arch = QUIET_GARDEN_STAGE.segments[4];
    expect(arch.execute?.(arch.enter(null), action("hero", "jump", "05-v2-5-exit"))?.outcome).toBe("blocked");
    const mixed = QUIET_GARDEN_STAGE.segments[5];
    expect(mixed.execute?.(mixed.enter(null), action("hero", "jump", "05-v2-6-exit"))?.outcome).toBe("blocked");
  });

  it("keeps darkness, doors, and two-hand climbing as physical blockers", () => {
    const dark = QUIET_STOREHOUSE_STAGE.segments[0];
    expect(dark.execute?.(dark.enter(null), action("hero", "move", "06-v2-1-alcove"))?.outcome).toBe("failure");
    const ladder = QUIET_STOREHOUSE_STAGE.segments[1];
    let carrying = execute(ladder, ladder.enter(null), action("hero", "take", "06-v2-lantern"));
    expect(ladder.execute?.(carrying, action("hero", "climb", "06-v2-2-ladder"))?.outcome).toBe("blocked");
    const floors = QUIET_STOREHOUSE_STAGE.segments[4];
    expect(floors.execute?.(floors.enter(null), action("hero", "open", "06-v2-5-upper-door", { instrument: "06-v2-key" }))?.outcome).toBe("blocked");
  });

  it("normalizes named obstacles and intuitive tool or joint-object forms", () => {
    const thorn = QUIET_GARDEN_STAGE.segments[1];
    const jumped = execute(thorn, thorn.enter(null), action("hero", "jump", "05-v2-2-thorns"));
    expect(thorn.complete(jumped)).toBe(true);

    const dark = QUIET_STOREHOUSE_STAGE.segments[0];
    const carried = execute(dark, dark.enter(null), action("hero", "move", "06-v2-1-alcove", { instrument: "06-v2-lantern" }));
    expect(dark.complete(carried)).toBe(true);

    const hook = QUIET_STOREHOUSE_STAGE.segments[1];
    const hung = execute(hook, hook.enter(null), action("hero", "place", "06-v2-2-hook", { instrument: "06-v2-lantern" }));
    expect(hung.entities["06-v2-lantern"].parent).toBe("06-v2-2-hook");

    const bridge = QUIET_THEATRE_STAGE.segments[4];
    let joint = execute(bridge, bridge.enter(null), action("hero", "push", "07-v2-5-bench", { destination: "07-v2-5-gap" }));
    joint = execute(bridge, joint, action("keeper", "push", "07-v2-5-bench", { destination: "07-v2-5-gap" }));
    expect(joint.entities["07-v2-5-bench"].properties.bridged).toBe(true);

    const last = QUIET_THEATRE_STAGE.segments[5];
    const latched = execute(last, last.enter(null), action("hero", "place", "07-v2-6-curtain", { destination: "07-v2-6-latch" }));
    expect(latched.entities["07-v2-6-latch"].properties.latched).toBe(true);
  });

  it("treats joint take and place as two end-grips without exclusive inventory ownership", () => {
    const bridge = QUIET_THEATRE_STAGE.segments[4];
    const initial = bridge.enter(null);
    const heroGrip = execute(bridge, initial, action("hero", "take", "07-v2-5-bench"));
    expect(heroGrip.entities["07-v2-5-bench"].parent).toBeNull();
    expect(heroGrip.actors.hero.carrying).not.toContain("07-v2-5-bench");
    expect(heroGrip.entities["07-v2-5-bench"].location).toEqual(initial.entities["07-v2-5-bench"].location);
    expect(bridge.execute?.(heroGrip, action("hero", "place", "07-v2-5-bench", { destination: "07-v2-5-gap" }))?.outcome).toBe("blocked");

    const bothGrip = execute(bridge, heroGrip, action("keeper", "take", "07-v2-5-bench"));
    expect(bothGrip.entities["07-v2-5-bench"].properties.holders).toBe("hero|keeper");
    expect(bothGrip.entities["07-v2-5-bench"].location).toEqual(initial.entities["07-v2-5-bench"].location);
    const placed = execute(bridge, bothGrip, action("hero", "place", "07-v2-5-bench", { destination: "07-v2-5-gap" }));
    expect(placed.entities["07-v2-5-bench"].properties.bridged).toBe(true);
    expect(placed.entities["07-v2-5-bench"].location).toEqual(placed.entities["07-v2-5-gap"].location);
    const repeated = execute(bridge, placed, action("keeper", "place", "07-v2-5-bench", { destination: "07-v2-5-gap" }));
    expect(repeated.entities["07-v2-5-bench"].location).toEqual(placed.entities["07-v2-5-bench"].location);
  });

  it("does not let one actor release another actor's hold or finish both roles", () => {
    const release = QUIET_THEATRE_STAGE.segments[2];
    const started = release.enter(null);
    expect(release.execute?.(started, action("hero", "release", "07-v2-3-grip"))?.outcome).toBe("blocked");

    const bridge = QUIET_THEATRE_STAGE.segments[4];
    const heroOnly = execute(bridge, bridge.enter(null), action("hero", "hold", "07-v2-5-bench"));
    expect(heroOnly.entities["07-v2-5-bench"].properties.bridged).toBe(false);
    expect(bridge.complete(heroOnly)).toBe(false);
    expect(bridge.execute?.(heroOnly, action("hero", "move", "07-v2-5-bank"))?.outcome).toBe("failure");
  });

  it("requires the latch before the keeper can stop holding and leave", () => {
    const last = QUIET_THEATRE_STAGE.segments[5];
    const initial = last.enter(null);
    const early = last.execute?.(initial, action("keeper", "move", "07-v2-6-exit"));
    expect(early?.outcome).toBe("blocked");
    expect(early?.world.actors.keeper.holding).toBe("07-v2-6-curtain");
    expect(last.complete(early!.world)).toBe(false);
  });
});

describe("quiet middle authored scene state", () => {
  const stages = [QUIET_GARDEN_STAGE, QUIET_STOREHOUSE_STAGE, QUIET_THEATRE_STAGE];

  it("has six revisioned segments, no onboarding, and reuses the first segment as practice", () => {
    for (const stage of stages) {
      expect(stage.contentRevision).toBe("quiet-v1");
      expect(stage.segments).toHaveLength(6);
      expect(stage.onboarding).toBeUndefined();
      expect(stage.practice).toBe(stage.segments[0]);
    }
  });

  it("keeps each fixed scene in bounds with two to four authored entities", () => {
    for (const stage of stages) for (const current of stage.segments) {
      const world = current.enter(null);
      const authored = Object.values(world.entities).filter((entity) => entity.id !== "letter");
      expect(authored.length, current.id).toBeGreaterThanOrEqual(2);
      expect(authored.length, current.id).toBeLessThanOrEqual(4);
      expect(current.description).toBe(authored.map((entity) => entity.name).join(" · "));
      expect(current.scene?.floors.length, current.id).toBeGreaterThan(0);
      for (const entity of authored) {
        expect(entity.description).toBe(entity.name);
        expect(entity.location.x).toBeGreaterThanOrEqual(0);
        expect(entity.location.x).toBeLessThanOrEqual(10);
        expect(entity.location.y).toBeGreaterThanOrEqual(0);
        expect(entity.location.y).toBeLessThanOrEqual(4);
      }
      for (const floor of current.scene!.floors) {
        expect(floor.from).toBeGreaterThanOrEqual(0);
        expect(floor.to).toBeLessThanOrEqual(10);
        expect(floor.y).toBeGreaterThanOrEqual(0);
        expect(floor.y).toBeLessThanOrEqual(4);
      }
    }
  });

  it("records gravity, hook, bridge, and two-actor positions in world state", () => {
    const gravity = play(probes[4]);
    expect(gravity.actors.hero.capabilities).toContain("gravity:up");
    expect(gravity.actors.hero.location).toEqual(gravity.entities["05-v2-5-exit"].location);

    const shelf = play(probes[7]);
    expect(shelf.entities["06-v2-lantern"].parent).toBe("06-v2-2-hook");
    expect(shelf.entities["06-v2-lantern"].location).toEqual(shelf.entities["06-v2-2-hook"].location);

    const bridge = play(probes[16]);
    expect(bridge.entities["07-v2-5-bench"].location).toEqual(bridge.entities["07-v2-5-gap"].location);
    expect(bridge.entities["07-v2-5-gap"].properties.passageBlocked).toBe(false);
    expect(bridge.actors.hero.location).toEqual(bridge.entities["07-v2-5-bank"].location);
    expect(bridge.actors.keeper.location).toEqual(bridge.entities["07-v2-5-bank"].location);
  });

  it("resolves public action references before applying custom execution", () => {
    const current = QUIET_STOREHOUSE_STAGE.segments[0];
    const world = current.enter(null);
    world.facts.push({ entity: "06-v2-1-alcove", property: "through", value: "06-v2-lantern", attempt: world.attempt, tick: world.tick });
    const result = current.execute?.(world, {
      ...action("hero", "take", "06-v2-lantern"),
      references: { target: { entity: "06-v2-1-alcove", property: "through", source: "remembered" } },
    });
    expect(result?.outcome).toBe("done");
    expect(result?.world.entities["06-v2-lantern"].parent).toBe("hero");
  });
});
