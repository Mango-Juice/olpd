import { describe, expect, it } from "vitest";
import type { SegmentDefinition } from "../src/campaign/level";
import { executePhysicalAction } from "../src/campaign/physics";
import { createCursor, stepProgram } from "../src/campaign/program";
import { ONBOARDING_STAGES } from "./fixtures/campaign-worlds/onboarding";
import type { PhysicalAction, Predicate, ProgramNode, StageId, WorldState } from "../src/campaign/types";

const action = (
  actor: "hero" | "keeper",
  verb: PhysicalAction["verb"],
  target: string,
  destination?: string,
): PhysicalAction => ({ kind: "action", actor, verb, target, ...(destination ? { destination } : {}) });

function segment(id: string): SegmentDefinition {
  for (const definitions of Object.values(ONBOARDING_STAGES)) {
    const found = definitions?.find((candidate) => candidate.id === id);
    if (found) return found;
  }
  throw new Error(`missing onboarding segment ${id}`);
}

function execute(definition: SegmentDefinition, world: WorldState, physical: PhysicalAction) {
  return (definition.execute ?? executePhysicalAction)(world, physical);
}

function advance(definition: SegmentDefinition, world: WorldState, times = 1): WorldState {
  let current = world;
  for (let index = 0; index < times; index += 1) current = definition.advance(current).world;
  return current;
}

function visibleProperty(entity: string, property: string, value: string | number | boolean): Predicate {
  return { kind: "property", entity, property, comparison: "eq", value, source: "visible" };
}

function playProgram(id: string, body: ProgramNode): WorldState {
  const definition = segment(id);
  let world = definition.enter(null);
  let cursor = createCursor();
  for (let step = 0; step < 32 && !definition.complete(world); step += 1) {
    const next = stepProgram(world, body, cursor, definition.execute ?? executePhysicalAction);
    world = next.world;
    cursor = next.cursor;
    expect(["blocked", "clarification", "failure"], `${id}: ${next.reason ?? next.outcome}`).not.toContain(next.outcome);
    if (next.actions.length > 0 || next.outcome === "waiting") world = definition.advance(world).world;
    if (next.outcome === "done" && !definition.complete(world)) break;
  }
  return world;
}

function completedSixOne(): WorldState {
  const definition = segment("06-learn-1");
  let world = definition.enter(null);
  world = execute(definition, world, action("hero", "take", "06-learn-key")).world;
  world = execute(definition, world, action("hero", "place", "06-learn-key", "06-learn-lock")).world;
  return advance(definition, world);
}

function completedNineOne(): WorldState {
  const definition = segment("09-learn-1");
  let world = definition.enter(null);
  world = execute(definition, world, action("hero", "push", "09-learn-support", "09-learn-shaft")).world;
  return advance(definition, world);
}

describe("chapter 2-10 onboarding content contract", () => {
  it("exports all 22 stable learn IDs with the documented chapter counts", () => {
    const counts: Partial<Record<StageId, number>> = { 2: 3, 3: 2, 4: 2, 5: 2, 6: 2, 7: 4, 8: 3, 9: 2, 10: 2 };
    expect(Object.fromEntries(Object.entries(ONBOARDING_STAGES).map(([id, definitions]) => [id, definitions?.length]))).toEqual({
      2: 3, 3: 2, 4: 2, 5: 2, 6: 2, 7: 4, 8: 3, 9: 2, 10: 2,
    });
    for (const [stage, count] of Object.entries(counts)) {
      expect(ONBOARDING_STAGES[Number(stage) as StageId]?.map((definition) => definition.id))
        .toEqual(Array.from({ length: count! }, (_, index) => `${stage.padStart(2, "0")}-learn-${index + 1}`));
    }
  });

  it("keeps each initial world sparse, counting movement goals and keeper bodies as targets", () => {
    const expected = new Map<string, number>([
      ["02-learn-1", 2], ["02-learn-2", 2], ["02-learn-3", 2],
      ["03-learn-1", 2], ["03-learn-2", 2], ["04-learn-1", 1], ["04-learn-2", 2],
      ["05-learn-1", 2], ["05-learn-2", 2], ["06-learn-1", 2], ["06-learn-2", 1],
      ["07-learn-1", 2], ["07-learn-2", 2], ["07-learn-3", 3], ["07-learn-4", 3],
      ["08-learn-1", 2], ["08-learn-2", 2], ["08-learn-3", 2],
      ["09-learn-1", 2], ["09-learn-2", 2], ["10-learn-1", 2], ["10-learn-2", 2],
    ]);
    for (const [id, count] of expected) {
      const world = segment(id).enter(null);
      const visibleObjects = world.visible.filter((entityId) => world.entities[entityId]?.properties.equipment !== true).length;
      const companionBodies = Object.keys(world.actors).filter((actorId) => actorId !== "hero").length;
      expect(visibleObjects + companionBodies, id).toBe(count);
      expect(world.entities.letter.properties.equipment, id).toBe(true);
    }
  });
});

describe("chapter 2 physical onboarding", () => {
  it("02-learn-1 only completes when the cork box physically reaches its outline", () => {
    const definition = segment("02-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "02-learn-box-spot")).world;
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("hero", "push", "02-learn-box", "02-learn-box-spot")).world;
    expect(definition.complete(world)).toBe(true);
  });

  it("02-learn-2 makes a buoyant box afloat only after it is moved into the basin", () => {
    const definition = segment("02-learn-2");
    let world = advance(definition, definition.enter(null));
    expect(world.entities["02-learn-floating-box"].properties.afloat).toBe(false);
    world = execute(definition, world, action("hero", "push", "02-learn-floating-box", "02-learn-basin")).world;
    world = advance(definition, world);
    expect(world.entities["02-learn-floating-box"].properties.afloat).toBe(true);
    expect(definition.complete(world)).toBe(true);
  });

  it("02-learn-3 distinguishes standing in the water from boarding the stable box", () => {
    const definition = segment("02-learn-3");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "02-learn-shallow-water")).world;
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("hero", "board", "02-learn-raft-box")).world;
    expect(world.actors.hero.riding).toBe("02-learn-raft-box");
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 3 physical onboarding", () => {
  it("03-learn-1 blocks the destination until the door reaches its open phase", () => {
    const definition = segment("03-learn-1");
    let world = definition.enter(null);
    expect(execute(definition, world, action("hero", "move", "03-learn-door-line")).outcome).toBe("blocked");
    world = advance(definition, world, 2);
    expect(world.entities["03-learn-door"].properties.open).toBe(true);
    world = execute(definition, world, action("hero", "move", "03-learn-door-line")).world;
    expect(definition.complete(world)).toBe(true);
  });

  it("03-learn-2 returns a physical failure in steam and permits passage after it stops", () => {
    const definition = segment("03-learn-2");
    let world = definition.enter(null);
    expect(execute(definition, world, action("hero", "move", "03-learn-steam-line")).outcome).toBe("failure");
    world = advance(definition, world, 2);
    expect(world.entities["03-learn-steam"].properties.active).toBe(false);
    world = execute(definition, world, action("hero", "move", "03-learn-steam-line")).world;
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 4 physical onboarding", () => {
  it("04-learn-1 closes after an early release but stays open after the latch engages", () => {
    const definition = segment("04-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "hold", "04-learn-lid")).world;
    world = execute(definition, world, action("hero", "release", "04-learn-lid")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);

    world = definition.enter(null);
    world = execute(definition, world, action("hero", "hold", "04-learn-lid")).world;
    world = advance(definition, world, 2);
    world = execute(definition, world, action("hero", "release", "04-learn-lid")).world;
    expect(world.entities["04-learn-lid"].properties).toMatchObject({ latched: true, open: true });
    expect(definition.complete(world)).toBe(true);
  });

  it("04-learn-2 propagates only a latched open state to the connected pinwheel", () => {
    const definition = segment("04-learn-2");
    let world = advance(definition, definition.enter(null));
    expect(world.entities["04-learn-pinwheel"].properties.spinning).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("hero", "hold", "04-learn-blower")).world;
    world = advance(definition, world, 2);
    world = execute(definition, world, action("hero", "release", "04-learn-blower")).world;
    expect(world.entities["04-learn-pinwheel"].properties.spinning).toBe(true);
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 5 physical onboarding", () => {
  it("05-learn-1 completes at the ceiling-walk destination rather than the gravity sign", () => {
    const definition = segment("05-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "05-learn-arrow")).world;
    expect(definition.complete(world)).toBe(false);
    world = execute(definition, world, action("hero", "move", "05-learn-ceiling-line")).world;
    expect(definition.complete(world)).toBe(true);
  });

  it("05-learn-2 rejects lifting the fixed hook and accepts rail movement", () => {
    const definition = segment("05-learn-2");
    let world = definition.enter(null);
    expect(execute(definition, world, action("hero", "take", "05-learn-planter")).outcome).toBe("clarification");
    expect(definition.complete(world)).toBe(false);
    world = execute(definition, world, action("hero", "push", "05-learn-planter", "05-learn-rail-end")).world;
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 6 direct physical handoff", () => {
  it("06-learn-1 opens only with the finite key left inside the lock", () => {
    const definition = segment("06-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "open", "06-learn-lock")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);

    world = definition.enter(null);
    world = execute(definition, world, action("hero", "take", "06-learn-key")).world;
    world = execute(definition, world, action("hero", "place", "06-learn-key", "06-learn-lock")).world;
    world = advance(definition, world);
    expect(world.entities["06-learn-key"].parent).toBe("06-learn-lock");
    expect(definition.complete(world)).toBe(true);
  });

  it("06-learn-2 preserves the exact key and door result, then completes on physical recovery", () => {
    const prior = completedSixOne();
    const keyBefore = structuredClone(prior.entities["06-learn-key"]);
    const lockBefore = structuredClone(prior.entities["06-learn-lock"]);
    const definition = segment("06-learn-2");
    let world = definition.enter(prior);
    expect(world.entities["06-learn-key"]).toEqual(keyBefore);
    expect(world.entities["06-learn-lock"]).toEqual(lockBefore);
    world = execute(definition, world, action("hero", "move", "06-learn-key")).world;
    expect(definition.complete(world)).toBe(false);
    world = execute(definition, world, action("hero", "take", "06-learn-key")).world;
    expect(world.entities["06-learn-lock"].properties.open).toBe(true);
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 7 two-body physical onboarding", () => {
  it("07-learn-1 completes for keeper movement, not the hero taking its place", () => {
    const definition = segment("07-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "07-learn-keeper-line")).world;
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("keeper", "move", "07-learn-keeper-line")).world;
    expect(definition.complete(world)).toBe(true);
  });

  it("07-learn-2 requires the keeper to physically keep holding for a beat", () => {
    const definition = segment("07-learn-2");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "hold", "07-learn-held-handle")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("keeper", "hold", "07-learn-held-handle")).world;
    world = advance(definition, world);
    expect(world.actors.keeper.holding).toBe("07-learn-held-handle");
    expect(definition.complete(world)).toBe(true);
  });

  it("07-learn-3 blocks the hero before the hold and completes only after crossing and release", () => {
    const definition = segment("07-learn-3");
    let world = definition.enter(null);
    expect(execute(definition, world, action("hero", "move", "07-learn-hero-line")).outcome).toBe("blocked");
    world = execute(definition, world, action("keeper", "hold", "07-learn-curtain-handle")).world;
    world = execute(definition, world, action("hero", "move", "07-learn-hero-line")).world;
    expect(definition.complete(world)).toBe(false);
    world = execute(definition, world, action("keeper", "release", "07-learn-curtain-handle")).world;
    expect(definition.complete(world)).toBe(true);
  });

  it("07-learn-4 requires the keeper hold while the hero wedges, then survives release", () => {
    const definition = segment("07-learn-4");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "take", "07-learn-wedge")).world;
    world = execute(definition, world, action("hero", "place", "07-learn-wedge", "07-learn-wedge-handle")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);
    expect(world.entities["07-learn-wedge"].parent).toBeNull();

    world = definition.enter(null);
    world = execute(definition, world, action("hero", "take", "07-learn-wedge")).world;
    world = execute(definition, world, action("keeper", "hold", "07-learn-wedge-handle")).world;
    expect(world.actors.keeper.holding).toBe("07-learn-wedge-handle");
    world = execute(definition, world, action("hero", "place", "07-learn-wedge", "07-learn-wedge-handle")).world;
    world = advance(definition, world);
    expect(world.actors.keeper.holding).toBe("07-learn-wedge-handle");
    expect(world.entities["07-learn-wedge-handle"].properties.support).toBe("07-learn-wedge");
    world = execute(definition, world, action("keeper", "release", "07-learn-wedge-handle")).world;
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 8 observation and connection physics", () => {
  it("08-learn-1 records the physical lens alignment rather than mere flag observation", () => {
    const definition = segment("08-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "observe", "08-learn-flag")).world;
    expect(definition.complete(world)).toBe(false);
    const throughLens: PhysicalAction = {
      kind: "action",
      actor: "hero",
      verb: "observe",
      target: "08-learn-flag",
      instrument: "08-learn-lens",
    };
    world = execute(definition, world, throughLens).world;
    expect(world.entities["08-learn-flag"].properties.connectionConfirmed).toBe(true);
    expect(world.facts).toContainEqual(expect.objectContaining({ entity: "08-learn-flag", property: "connectionConfirmed", value: true }));
    expect(definition.complete(world)).toBe(true);
  });

  it("08-learn-2 leaves observation incomplete and opens the door by pulling its physical handle", () => {
    const definition = segment("08-learn-2");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "observe", "08-learn-window")).world;
    expect(definition.complete(world)).toBe(false);
    world = execute(definition, world, action("hero", "pull", "08-learn-door-handle")).world;
    expect(world.entities["08-learn-door-handle"].properties).toMatchObject({ pulled: true, doorOpen: true });
    expect(definition.complete(world)).toBe(true);
  });

  it("08-learn-3 turns only the bolted route into windmill motion", () => {
    const definition = segment("08-learn-3");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "08-learn-windmill")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("hero", "turn", "08-learn-valve")).world;
    world = advance(definition, world);
    expect(world.entities["08-learn-windmill"].properties.decorativePipeActive).toBe(false);
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 9 direct physical handoff", () => {
  it("09-learn-1 completes only when the support and shaft occupy the load-bearing place", () => {
    const definition = segment("09-learn-1");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "09-learn-shaft")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("hero", "push", "09-learn-support", "09-learn-shaft")).world;
    world = advance(definition, world);
    expect(world.entities["09-learn-shaft"].properties.support).toBe("09-learn-support");
    expect(definition.complete(world)).toBe(true);
  });

  it("09-learn-2 preserves the lower mechanism exactly and uses it to open the upper door", () => {
    const prior = completedNineOne();
    const supportBefore = structuredClone(prior.entities["09-learn-support"]);
    const shaftBefore = structuredClone(prior.entities["09-learn-shaft"]);
    const definition = segment("09-learn-2");
    let world = definition.enter(prior);
    expect(world.entities["09-learn-support"]).toEqual(supportBefore);
    expect(world.entities["09-learn-shaft"]).toEqual(shaftBefore);
    world = execute(definition, world, action("hero", "move", "09-learn-upper-latch")).world;
    expect(definition.complete(world)).toBe(false);
    world = execute(definition, world, action("hero", "move", "09-learn-upper-line")).world;
    expect(world.entities["09-learn-upper-latch"].properties.open).toBe(true);
    expect(definition.complete(world)).toBe(true);
  });
});

describe("chapter 10 warden physical onboarding", () => {
  it("10-learn-1 physically blocks movement until the arm has withdrawn", () => {
    const definition = segment("10-learn-1");
    let world = definition.enter(null);
    const early = execute(definition, world, action("hero", "move", "10-learn-arm-line"));
    expect(early.outcome).toBe("blocked");
    expect(early.world.actors.hero.location.x).toBe(0);
    world = advance(definition, world, 2);
    expect(world.entities["10-learn-arm"].properties).toMatchObject({ position: "withdrawn", blocksPath: false });
    world = execute(definition, world, action("hero", "move", "10-learn-arm-line")).world;
    expect(definition.complete(world)).toBe(true);
  });

  it("10-learn-2 completes from the vent route and not from standing by the cloth", () => {
    const definition = segment("10-learn-2");
    let world = definition.enter(null);
    world = execute(definition, world, action("hero", "move", "10-learn-exit-cloth")).world;
    world = advance(definition, world);
    expect(definition.complete(world)).toBe(false);
    world = definition.enter(null);
    world = execute(definition, world, action("hero", "turn", "10-learn-wind-plate")).world;
    world = advance(definition, world);
    expect(world.entities["10-learn-wind-plate"].properties).toMatchObject({ route: "side-vent", ventActive: true });
    expect(world.entities["10-learn-exit-cloth"].properties.flapping).toBe(false);
    expect(definition.complete(world)).toBe(true);
  });
});

describe("model-shaped multi-action onboarding programs", () => {
  it.each([
    ["04-learn-1", "04-learn-lid"],
    ["04-learn-2", "04-learn-blower"],
  ])("%s holds through the visible latch event before releasing", (id, device) => {
    const world = playProgram(id, {
      kind: "sequence",
      children: [
        action("hero", "hold", device),
        { kind: "wait", until: visibleProperty(device, "latched", true) },
        action("hero", "release", device),
      ],
    });
    expect(segment(id).complete(world)).toBe(true);
    expect(world.entities[device].properties).toMatchObject({ latched: true, open: true });
  });

  it("07-learn-3 releases the keeper through an observed hero-arrival predicate", () => {
    const world = playProgram("07-learn-3", {
      kind: "parallel",
      children: [
        {
          kind: "until",
          condition: visibleProperty("07-learn-hero-line", "heroArrived", true),
          body: action("keeper", "hold", "07-learn-curtain-handle"),
        },
        action("hero", "move", "07-learn-hero-line"),
      ],
    });
    expect(world.entities["07-learn-hero-line"].properties.heroArrived).toBe(true);
    expect(world.actors.keeper.holding).toBeNull();
    expect(segment("07-learn-3").complete(world)).toBe(true);
  });

  it("07-learn-4 keeps the keeper holding while the hero physically seats the wedge", () => {
    const world = playProgram("07-learn-4", {
      kind: "parallel",
      children: [
        {
          kind: "until",
          condition: visibleProperty("07-learn-wedge-handle", "wedged", true),
          body: action("keeper", "hold", "07-learn-wedge-handle"),
        },
        action("hero", "place", "07-learn-wedge", "07-learn-wedge-handle"),
      ],
    });
    expect(world.entities["07-learn-wedge"].parent).toBe("07-learn-wedge-handle");
    expect(world.actors.keeper.holding).toBeNull();
    expect(segment("07-learn-4").complete(world)).toBe(true);
  });

  it("08-learn-1 accepts the model's explicit magnifier instrument", () => {
    const world = playProgram("08-learn-1", {
      kind: "action",
      actor: "hero",
      verb: "observe",
      target: "08-learn-flag",
      instrument: "08-learn-lens",
    });
    expect(segment("08-learn-1").complete(world)).toBe(true);
  });
});
