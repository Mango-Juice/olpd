import { expect, it } from "vitest";
import {
  abandonStage,
  acknowledgePresentation,
  advanceStage,
  createStageRun,
  deleteStageProgram,
  departStage,
  retryStage,
  writeStageProgram,
  type StageDynamics,
} from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import { stageDynamics } from "../src/campaign/level";
import { RAIN_STAGE } from "./fixtures/campaign-worlds/rain";
import type { InstructionProgram } from "../src/campaign/types";

const instruction = (id: string, verb: "take" | "observe" = "take"): InstructionProgram => ({
  version: 2,
  id,
  text: verb === "take" ? "고정 돌턱을 집어" : "돌턱을 살펴봐",
  model: "fixture",
  scope: { stageId: 2, region: "02-1" },
  guard: false,
  body: { kind: "action", actor: "hero", verb, target: "rain-start" },
});

it("keeps impossible input blocked until the player accepts a death and retries from the entrance", () => {
  const entrance = RAIN_STAGE.segments[0].enter(null);
  let run = writeStageProgram(createStageRun("clarification", entrance), instruction("bad"));
  run = advanceStage(departStage(run), stageDynamics(RAIN_STAGE));

  expect(run).toMatchObject({ phase: "blocked", world: { attempt: 1 }, notebook: {
    deaths: 0, canWrite: false, canDelete: false, erasers: 2, penaltyDeaths: 0,
  } });
  expect(run.events.at(-1)?.outcome).toBe("clarification");
  expect(run.presentation?.outcome).toBe("blocked");
  expect(advanceStage(run, stageDynamics(RAIN_STAGE))).toBe(run);

  const blockedWorld = structuredClone(run.world);
  run = abandonStage(run);
  expect(run).toMatchObject({ phase: "failed", notebook: {
    deaths: 1, canWrite: true, canDelete: true, erasers: 2, penaltyDeaths: 0,
  } });
  expect(run.world).toEqual(blockedWorld);
  expect(run.presentation?.outcome).toBe("death");

  run = deleteStageProgram(run, "bad");
  expect(run.notebook).toMatchObject({ erasers: 1, penaltyDeaths: 0, canWrite: true });
  run = writeStageProgram(run, instruction("fixed", "observe"));
  expect(run.notebook.instructions.map((item) => item.id)).toEqual(["fixed"]);
  run = retryStage(acknowledgePresentation(run));
  expect(run).toMatchObject({ phase: "bookmark", world: { attempt: 2 }, notebook: {
    deaths: 1, canWrite: false, canDelete: false, erasers: 1, penaltyDeaths: 0,
  } });
  expect(run.world).toEqual({ ...entrance, attempt: 2 });
  expect(run.presentation?.outcome).toBe("revive");
  expect(parseStageRun(JSON.parse(JSON.stringify(run)))).not.toBeNull();
});

it("retains a fatal world until retry, grants one append, and never refunds an old edit", () => {
  const entrance = RAIN_STAGE.segments[0].enter(null);
  let run = writeStageProgram(createStageRun("fatal", entrance), instruction("fatal", "observe"));
  const fatalDynamics: StageDynamics = {
    ...stageDynamics(RAIN_STAGE),
    execute: (world) => {
      const failed = structuredClone(world);
      failed.actors.hero.location = { region: world.segmentId, x: 1, y: 0 };
      return { world: failed, outcome: "failure", reason: "실제 물리 충돌" };
    },
  };
  run = advanceStage(departStage(run), fatalDynamics);

  expect(run.phase).toBe("failed");
  expect(run.world.actors.hero.location.x).toBe(1);
  expect(run.notebook).toMatchObject({ deaths: 1, canWrite: true, canDelete: true, erasers: 2, penaltyDeaths: 0 });
  expect(run.presentation?.outcome).toBe("death");

  run = retryStage(acknowledgePresentation(run));
  expect(run.phase).toBe("bookmark");
  expect(run.world).toEqual({ ...entrance, attempt: 2 });
  expect(run.notebook).toMatchObject({ deaths: 1, canWrite: false, canDelete: false, erasers: 2, penaltyDeaths: 0 });
  expect(run.notebook.instructions.map((item) => item.id)).toEqual(["fatal"]);
});
