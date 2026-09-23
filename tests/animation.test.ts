import { describe, expect, it } from "vitest";
import {
  FLOOR_Y,
  START_X,
  campaignActorVerb,
  campaignHeroFrame,
  campaignPresentationDuration,
  campaignSoundCuesBetween,
  detourPathPoint,
  eventDuration,
  eventHeroFrame,
  reviveHeroFrame,
  soundCuesBetween,
} from "../src/render/animation";
import { makeHero, makeWorld } from "../src/campaign/level";
import type { StagePresentation } from "../src/campaign/run";
import type { Action, ExecutionEvent, ObservationId } from "../src/game/types";

function fatalEvent(
  observation: ObservationId,
  action: Action,
): ExecutionEvent {
  return {
    id: `${observation}-${action}`,
    room: 4,
    point: 0,
    observation,
    action,
    instructionId: null,
    outcome: "death",
    reason: "fixture",
    repeated: false,
  };
}

describe("renderer animation contract", () => {
  it("matches combined-hazard death motifs to the action that failed", () => {
    expect(
      eventHeroFrame(fatalEvent("pitCeilingPath", "jump"), 1, false).fatalKind,
    ).toBe("bonk");
    expect(
      eventHeroFrame(fatalEvent("pitCeilingPath", "advance"), 1, false)
        .fatalKind,
    ).toBe("fall");
    expect(
      eventHeroFrame(fatalEvent("pitCeilingPath", "duck"), 1, false).fatalKind,
    ).toBe("fall");
    expect(
      eventHeroFrame(fatalEvent("spikesCeilingPath", "jump"), 1, false)
        .fatalKind,
    ).toBe("bonk");
    expect(
      eventHeroFrame(fatalEvent("spikesCeilingPath", "duck"), 1, false)
        .fatalKind,
    ).toBe("spikes");
  });

  it("plays remembered events at roughly three times normal speed", () => {
    const event = fatalEvent("pit", "advance");
    const normal = eventDuration(event);
    const repeated = eventDuration({ ...event, repeated: true });
    expect(normal).toBe(4200);
    expect(repeated).toBe(1400);
    expect(normal / repeated).toBe(3);
  });

  it("dissolves a fatal pose, then summons at the entrance", () => {
    const event = fatalEvent("floorSpikes", "advance");
    const finalDeath = eventHeroFrame(event, 1, false);
    expect(finalDeath.pose).toBe("death");
    expect(finalDeath.opacity).toBe(0);
    expect(finalDeath.rotation).toBe(0);

    const revived = reviveHeroFrame(0.5);
    expect(revived.pose).toBe("revive");
    expect(revived.x).toBe(START_X);
    expect(revived.y).toBeLessThan(FLOOR_Y);
    expect(revived.facing).toBe(1);

    const settled = reviveHeroFrame(1);
    expect(settled).toMatchObject({
      x: START_X,
      y: FLOOR_Y,
      pose: "idle",
      opacity: 1,
      rotation: 0,
    });
  });

  it("walks a three-part rear detour instead of tracing a jump arc", () => {
    const start = detourPathPoint(0);
    const lowerBranch = detourPathPoint(0.2);
    const upperBranch = detourPathPoint(0.32);
    const rear = detourPathPoint(0.5);
    const upperMerge = detourPathPoint(0.68);
    const lowerMerge = detourPathPoint(0.82);
    const end = detourPathPoint(1);

    expect(start).toMatchObject({ x: 430, y: FLOOR_Y, scale: 1 });
    expect(lowerBranch).toMatchObject({ x: 455, y: 320, scale: 0.86 });
    expect(upperBranch).toMatchObject({ x: 490, y: 252, scale: 0.72 });
    expect(rear).toMatchObject({ y: 252, scale: 0.72 });
    expect(upperMerge).toMatchObject({ x: 660, y: 252, scale: 0.72 });
    expect(lowerMerge).toMatchObject({ x: 695, y: 320, scale: 0.86 });
    expect(end).toMatchObject({ x: 720, y: FLOOR_Y, scale: 1 });
    const xs = [
      start.x,
      lowerBranch.x,
      upperBranch.x,
      rear.x,
      upperMerge.x,
      lowerMerge.x,
      end.x,
    ];
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("emits each event sound only when its progress marker is crossed", () => {
    const jump = { ...fatalEvent("pit", "jump"), outcome: "safe" as const };
    expect(soundCuesBetween(jump, 0, 0.3, false)).toEqual(["step", "step"]);
    expect(soundCuesBetween(jump, 0.3, 0.7, false)).toEqual(["jump", "land"]);
    expect(soundCuesBetween(jump, 0.7, 1, true)).toEqual(["win"]);
    expect(soundCuesBetween(jump, 1, 1, true)).toEqual([]);

    const repeated = { ...jump, repeated: true };
    expect(soundCuesBetween(repeated, 0, 0.3, false)).toEqual(["step"]);
    const fatalJump = fatalEvent("pitCeilingPath", "jump");
    expect(soundCuesBetween(fatalJump, 0.3, 0.65, false)).toEqual([
      "jump",
      "death",
    ]);
    expect(soundCuesBetween(fatalJump, 0.65, 1, false)).toEqual([]);
  });

  it("gives campaign actions the Chapter 1 playback lifecycle", () => {
    const before = makeWorld(2, "02-1", [], makeHero("02-1", 0));
    const after = makeWorld(2, "02-1", [], makeHero("02-1", 4));
    const presentation: StagePresentation = {
      id: "move-once",
      before,
      after,
      events: [{
        id: "move-event",
        segmentId: "02-1",
        tick: 1,
        attempt: 1,
        instructionId: "instruction",
        actor: "hero",
        target: "exit",
        verb: "move",
        outcome: "safe",
        reason: "걸어갔어요.",
        changes: [],
      }],
      outcome: "safe",
      repeated: false,
      life: 1,
      attempt: 1,
    };
    expect(campaignPresentationDuration(presentation)).toBe(4200);
    expect(
      campaignPresentationDuration({ ...presentation, repeated: true }),
    ).toBe(1400);
    expect(campaignHeroFrame({
      presentation,
      progress: 0.5,
      from: { x: 100, y: 400, rotation: 0 },
      to: { x: 700, y: 400, rotation: 0 },
    }).pose).toBe("walk");
    expect(campaignSoundCuesBetween(presentation, 0, 0.3)).toEqual([
      "step",
      "step",
    ]);
  });

  it("renders campaign contact, death, revive and clear as distinct poses", () => {
    const world = makeWorld(2, "02-1", [], makeHero("02-1", 1));
    const base: StagePresentation = {
      id: "interaction",
      before: world,
      after: structuredClone(world),
      events: [{
        id: "push-event",
        segmentId: "02-1",
        tick: 1,
        attempt: 1,
        instructionId: "instruction",
        actor: "hero",
        target: "crate",
        verb: "push",
        outcome: "safe",
        reason: "밀었어요.",
        changes: [],
      }],
      outcome: "safe",
      repeated: false,
      life: 1,
      attempt: 1,
    };
    const motion = {
      presentation: base,
      progress: 0.55,
      from: { x: 300, y: 400, rotation: 0 },
      to: { x: 450, y: 400, rotation: 0 },
      contact: { x: 380, y: 360 },
    };
    const contactFrame = campaignHeroFrame(motion);
    expect(contactFrame).toMatchObject({
      pose: "push",
      contact: { x: 380, y: 360 },
    });
    expect(Math.abs(contactFrame.contact!.x - contactFrame.x)).toBeLessThan(85);
    expect(campaignHeroFrame({ ...motion, progress: 0.1 }).pose).toBe("walk");
    expect(campaignHeroFrame({ ...motion, progress: 0.9 }).pose).toBe("idle");
    expect(campaignHeroFrame({
      ...motion,
      presentation: { ...base, outcome: "death" },
      progress: 0.9,
    }).pose).toBe("death");
    expect(campaignHeroFrame({
      ...motion,
      presentation: { ...base, outcome: "revive", events: [] },
      progress: 0.5,
    }).pose).toBe("revive");
    expect(campaignHeroFrame({
      ...motion,
      presentation: { ...base, outcome: "cleared" },
      progress: 0.95,
    }).pose).toBe("joy");

    const parallel: StagePresentation = {
      ...base,
      events: [
        ...base.events,
        {
          ...base.events[0],
          id: "keeper-hold",
          actor: "keeper",
          verb: "hold",
        },
      ],
    };
    expect(campaignActorVerb(parallel, "hero")).toBe("push");
    expect(campaignActorVerb(parallel, "keeper")).toBe("hold");
  });
});
