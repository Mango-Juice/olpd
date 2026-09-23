import { describe, expect, it } from "vitest";
import { makeEntity, makeWorld } from "../src/campaign/level";
import { parseStageRun } from "../src/campaign/run-validation";
import {
  acknowledgePresentation,
  abandonStage,
  advanceStage,
  createStageRun,
  departStage,
  retryStage,
  writeStageProgram,
  type StageDynamics,
} from "../src/campaign/run";
import type { InstructionProgram, WorldState } from "../src/campaign/types";

const line = (id = "line"): InstructionProgram => ({
  version: 2,
  id,
  text: "목표를 밀어",
  model: "fixture",
  scope: {},
  guard: false,
  body: { kind: "action", actor: "hero", verb: "push", target: "goal" },
});

const entrance = (): WorldState => makeWorld(2, "02-1", [
  makeEntity("goal", "목표", "02-1", 0, { movable: true, properties: { done: false } }),
]);

function dynamics(outcome: "done" | "blocked" | "failure" = "done"): StageDynamics {
  return {
    execute: (world) => {
      const next = structuredClone(world);
      if (outcome === "done") next.entities.goal.properties.done = true;
      return { world: next, outcome, reason: outcome };
    },
    advance: (world) => ({ world, events: [], canChange: false }),
    segmentComplete: (world) => world.entities.goal.properties.done === true,
    nextSegment: (world) => ({ ...structuredClone(world), segmentId: "02-2" }),
    sealAfter: () => null,
  };
}

function started() {
  return departStage(writeStageProgram(createStageRun("run", entrance()), line()));
}

describe("shared chapter run", () => {
  it("keeps the accumulated notebook through segment boundaries without a free grant", () => {
    const next = advanceStage(started(), dynamics());
    expect(next).toMatchObject({ phase: "running", world: { segmentId: "02-2" }, clearedSegments: ["02-1"] });
    expect(next.notebook).toMatchObject({ canWrite: false, instructions: [{ id: "line" }] });
    expect(next.presentation).toMatchObject({ outcome: "safe", completedSegmentId: "02-1", nextSegmentId: "02-2", life: 1 });
  });

  it("leaves failure in place, grants one line, then revives at the chapter entrance", () => {
    const dead = advanceStage(started(), dynamics("failure"));
    expect(dead).toMatchObject({ phase: "failed", world: { segmentId: "02-1", attempt: 1 }, notebook: { deaths: 1, canWrite: true } });
    expect(dead.presentation?.outcome).toBe("death");
    const written = writeStageProgram(dead, line("second"));
    const revived = retryStage(acknowledgePresentation(written));
    expect(revived).toMatchObject({ phase: "bookmark", world: { segmentId: "02-1", attempt: 2 }, notebook: { canWrite: false } });
    expect(revived.notebook.instructions.map((item) => item.id)).toEqual(["line", "second"]);
    expect(revived.presentation?.outcome).toBe("revive");
    expect(revived.clearedSegments).toEqual([]);
  });

  it("requires an explicit +1 death abandon before a blocked run can write", () => {
    const blocked = advanceStage(started(), dynamics("blocked"));
    expect(blocked).toMatchObject({ phase: "blocked", notebook: { deaths: 0, canWrite: false } });
    const dead = abandonStage(acknowledgePresentation(blocked));
    expect(dead).toMatchObject({ phase: "failed", notebook: { deaths: 1, canWrite: true } });
    expect(dead.history.entries.at(-1)?.kind).toBe("abandon");
  });

  it("persists v3 history and presentation evidence", () => {
    const next = advanceStage(started(), dynamics("failure"));
    expect(parseStageRun(next)).not.toBeNull();
    const damaged = structuredClone(next) as unknown as { presentationHistory: { id: string }[] };
    damaged.presentationHistory[0].id = "";
    expect(parseStageRun(damaged)).toBeNull();
  });
});
