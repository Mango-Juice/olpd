import { expect, it } from "vitest";
import { copyArchivedProgram, createNotebook, deleteProgram, departNotebook, writeProgram } from "../src/campaign/notebook";
import { advanceStage, createStageRun, departStage, rewindStage } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import { stageDynamics } from "../src/campaign/level";
import { RAIN_STAGE } from "../src/campaign/stages/rain";
import type { InstructionProgram } from "../src/campaign/types";

const instruction = (id: string, verb: "take" | "observe" = "take"): InstructionProgram => ({ version: 2, id, text: verb === "take" ? "고정 돌턱을 집어" : "돌턱을 살펴봐", model: "fixture", scope: {}, guard: false, body: { kind: "action", actor: "hero", verb, target: "rain-start" } });
function invalidRun(editWith?: number) {
  let run = createStageRun("clarification", RAIN_STAGE.segments[0].enter(null));
  if (editWith !== undefined) {
    run.notebook = copyArchivedProgram(createNotebook("02-1"), instruction("original", "observe"));
    run.notebook.erasers = editWith;
    run.notebook.bells = 5;
  }
  run.notebook = writeProgram(run.notebook, instruction("bad"), editWith === undefined ? undefined : "original");
  return departStage(run);
}

it("persists free recovery of impossible input and restricts the refund to its own instruction", () => {
  const original = invalidRun();
  const corrected = advanceStage(original, stageDynamics(RAIN_STAGE));
  expect(corrected.phase).toBe("bookmark");
  expect(corrected.world.attempt).toBe(2);
  expect(corrected.notebook).toMatchObject({ bells: 0, erasers: 2, canWrite: true, clarificationId: "bad" });
  expect(corrected.events.at(-1)?.outcome).toBe("clarification");
  const restored = parseStageRun(JSON.parse(JSON.stringify(corrected)));
  expect(restored).not.toBeNull();
  expect(rewindStage(restored!)).toBe(restored);
  expect(() => departNotebook(restored!.notebook)).toThrow();
  expect(() => writeProgram(restored!.notebook, instruction("unrelated", "observe"))).toThrow();
  const repaired = writeProgram(restored!.notebook, instruction("fixed", "observe"), "bad");
  expect(repaired).toMatchObject({ bells: 0, erasers: 2, canWrite: false });
  expect(repaired.clarificationId).toBeUndefined();
  expect(repaired.instructions.map((item) => item.id)).toEqual(["fixed"]);
  expect(original.world.attempt).toBe(1);
});

it.each([2, 0])("refunds only the rejected edit charge with %i erasers available", (erasers) => {
  const begun = invalidRun(erasers);
  expect(begun.notebook.erasers).toBe(Math.max(0, erasers - 1));
  expect(begun.notebook.bells).toBe(erasers === 0 ? 8 : 5);
  const correction = advanceStage(begun, stageDynamics(RAIN_STAGE));
  expect(correction.notebook.erasers).toBe(erasers);
  expect(correction.notebook.bells).toBe(5);
  const removed = deleteProgram(correction.notebook, "bad");
  expect(removed.instructions).toHaveLength(0);
  expect(removed).toMatchObject({ erasers, bells: 5, canWrite: true });
  expect(removed.clarificationId).toBeUndefined();
});

it("does not refund valid physical failure or turn a safe deadlock into free editing", () => {
  const started = invalidRun();
  const dynamics = stageDynamics(RAIN_STAGE);
  const failed = advanceStage(started, { ...dynamics, execute: (world) => ({ world, outcome: "failure", reason: "실제 과적" }) });
  expect(failed.notebook.bells).toBe(1);
  expect(failed.notebook.clarificationId).toBeUndefined();
  const blocked = advanceStage(started, { ...dynamics, execute: (world) => ({ world, outcome: "blocked", reason: "문이 아직 닫힘" }) });
  expect(blocked.phase).toBe("blocked");
  expect(blocked.notebook.canWrite).toBe(false);
  expect(blocked.notebook.clarificationId).toBeUndefined();
});
