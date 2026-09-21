import { describe, expect, it } from "vitest";
import {
  FLOOR_Y,
  START_X,
  detourPathPoint,
  eventDuration,
  eventHeroFrame,
  reviveHeroFrame,
  soundCuesBetween,
} from "../src/render/animation";
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

    const revived = reviveHeroFrame(finalDeath, 0.5);
    expect(revived.pose).toBe("revive");
    expect(revived.x).toBe(START_X);
    expect(revived.y).toBeLessThan(FLOOR_Y);
    expect(revived.facing).toBe(1);

    const settled = reviveHeroFrame(finalDeath, 1);
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
});
