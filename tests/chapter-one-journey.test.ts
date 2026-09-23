import { describe, expect, it } from "vitest";
import { ROOMS, OBSERVATIONS } from "../src/game/content";
import { newChapterRun, addInstruction, startRun, step, retry, moveInstruction, deleteInstruction } from "../src/game/core";
import type { Action, ObservationId, RunState } from "../src/game/types";

const write = (run: RunState, action: Action, appliesTo: ObservationId[]) =>
  addInstruction(run, action, { action, appliesTo, uncertainty: 0, model: "fixture", rulesVersion: "1" });
const finishLife = (run: RunState) => {
  for (let i = 0; run.phase === "running" && i < 30; i++) run = step(run);
  expect(run.phase).not.toBe("running");
  return run;
};

describe("six connected Chapter 1 scenes", () => {
  it("learns within one persistent notebook, then clears the short finale", () => {
    let run = newChapterRun();
    expect(run).toMatchObject({ layoutVersion: 2, tutorial: false, canWrite: true, erasers: 2 });
    expect(run.instructions).toEqual([]);
    expect(ROOMS.map(room => room.points)).toEqual([
      ["clear"], ["pit"], ["lowCeiling"], ["floorSpikes"], ["pitCeilingPath"], ["bridge", "spikesCeilingPath"],
    ]);
    run = write(run, "advance", Object.keys(OBSERVATIONS) as ObservationId[]);
    const firstId = run.instructions[0].id;
    run = finishLife(startRun(run));
    expect(run).toMatchObject({ phase: "dead", room: 1, deaths: 1 });
    run = write(run, "jump", ["pit", "bridge", "floorSpikes", "pitCeilingPath", "spikesCeilingPath"]);
    run = finishLife(startRun(retry(run)));
    expect(run).toMatchObject({ phase: "dead", room: 2, deaths: 2 });
    run = write(run, "duck", ["lowCeiling", "pitCeilingPath", "spikesCeilingPath"]);
    run = finishLife(startRun(retry(run)));
    expect(run).toMatchObject({ phase: "dead", room: 4, deaths: 3 });
    run = write(run, "detour", ["pitCeilingPath", "spikesCeilingPath"]);
    run = finishLife(startRun(retry(run)));
    expect(run).toMatchObject({ phase: "cleared", room: 5, point: 2, deaths: 3, erasers: 2, penaltyDeaths: 0 });
    expect(run.instructions[0].id).toBe(firstId);
    expect(run.instructions).toHaveLength(4);
    expect(new Set(run.events.filter(e => e.outcome === "safe").map(e => e.room)).size).toBe(6);
    expect(run.history?.entries.some(e => e.kind === "delete")).toBe(false);
  });

  it("still lets a higher unconditional rule shadow a condition, and uses real erasers", () => {
    let run = write(newChapterRun(), "advance", Object.keys(OBSERVATIONS) as ObservationId[]);
    run = finishLife(startRun(run));
    run = write(run, "jump", ["pit", "bridge"]);
    const advanceId = run.instructions[0].id;
    run = moveInstruction(run, advanceId, "up");
    run = finishLife(startRun(retry(run)));
    expect(run).toMatchObject({ phase: "dead", room: 1 });
    expect(run.lastEvent?.instructionId).toBe(advanceId);
    run = deleteInstruction(run, advanceId);
    expect(run.erasers).toBe(1);
    expect(run.instructions).toHaveLength(1);
    expect(run.penaltyDeaths).toBe(0);
    expect(retry(run)).toMatchObject({ room: 0, point: 0 });
  });
});
