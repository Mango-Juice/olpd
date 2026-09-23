import { expect, it } from "vitest";
import { campaignAuthority } from "../src/campaign/authority";
import { createCampaignRun, createStageRun, departStage, writeStageProgram } from "../src/campaign/run";
import { parseStageRun } from "../src/campaign/run-validation";
import { RAIN_INTRO, RAIN_PRACTICE } from "./fixtures/campaign-worlds/rain";
import type { CampaignStageDefinition } from "../src/campaign/level";
import { makeSave } from "../src/game/storage";
import { newRun } from "../src/game/core";
import { createCursor, stepProgram } from "../src/campaign/program";
import type { InstructionProgram } from "../src/campaign/types";
import { resolveStage } from "../src/campaign/registry";

const fixtureStage: CampaignStageDefinition = {
  id: 2, title: "validation fixture", contentRevision: "shared-v1", practice: RAIN_PRACTICE,
  segments: Array.from({ length: 5 }, (_, index) => ({ ...RAIN_INTRO, id: `02-${index + 1}` })),
  story: { afterSegment: "02-1", object: "fixture", text: "" },
};
const authority = campaignAuthority((id) => id === 2 ? fixtureStage : null);
it("refreshes old display wording without changing saved physics, identity, or the input snapshot", () => {
  const run = createStageRun("old-wording", RAIN_INTRO.enter(null));
  for (const world of [run.world, run.checkpoint]) {
    world.entities["rain-launch"].name = "옛날 물체 이름";
    world.entities["rain-launch"].description = "옛날 설명";
  }
  const before = structuredClone(run);
  const parsed = authority.parse({ kind: "world", run });
  expect(parsed?.kind).toBe("world");
  if (parsed?.kind !== "world") throw new Error("parse failed");
  const current = RAIN_INTRO.enter(null).entities["rain-launch"];
  expect(parsed.run.world.entities["rain-launch"].name).toBe(current.name);
  expect(parsed.run.checkpoint.entities["rain-launch"].description).toBe(current.description);
  for (const world of [parsed.run.world, parsed.run.checkpoint]) {
    world.entities["rain-launch"].name = "옛날 물체 이름";
    world.entities["rain-launch"].description = "옛날 설명";
  }
  expect(parsed.run).toEqual(before);
  expect(run).toEqual(before);
});
it("round-trips a detached world snapshot with execution and notebook state", () => {
  const run = createStageRun("run", RAIN_INTRO.enter(null));
  const parsed = authority.parse({ kind: "world", run });
  expect(parsed).toEqual({ kind: "world", run });
  expect(parsed?.kind === "world" && parsed.run).not.toBe(run);
});
it("accepts every registered chapter's initial ownership and cursor state", () => {
  for (const id of [2, 3, 4, 5, 6] as const) {
    const stage = resolveStage(id)!;
    const run = createCampaignRun(`chapter-${id}`, stage);
    expect(campaignAuthority(resolveStage).parse({ kind: "world", run })).not.toBeNull();
    expect(run.world.entities.letter.parent).toBe("hero");
  }
});
it("rejects parent cycles, orphan inventory, and an invalid program cursor", () => {
  const run = createStageRun("run", RAIN_INTRO.enter(null));
  run.world.entities["rain-cork"].parent = "rain-cork";
  expect(parseStageRun(run)).toBeNull();
  run.world.entities["rain-cork"].parent = "hero";
  expect(parseStageRun(run)).toBeNull();
  run.world.entities["rain-cork"].parent = null;
  run.execution.active = { instructionId: "missing", cursor: { path: [], status: "running", index: 0, children: [], branch: null, reason: null } };
  expect(parseStageRun(run)).toBeNull();
});
it("does not accept a cleared string without all segments and the actual final physical goal", () => {
  const run = createStageRun("run", RAIN_INTRO.enter(null));
  run.phase = "cleared";
  expect(authority.parse({ kind: "world", run })).toBeNull();
  run.clearedSegments = fixtureStage.segments.map((segment) => segment.id);
  run.world.segmentId = "02-5";
  run.notebook.canWrite = false;
  run.notebook.departed = true;
  run.notebook.editing = false;
  expect(authority.parse({ kind: "world", run })).toBeNull();
  run.world.actors.hero.location = { ...run.world.entities["rain-platform"].location };
  expect(authority.parse({ kind: "world", run })).not.toBeNull();
});
it("delegates legacy save semantics to the existing validated loader", () => {
  const save = makeSave(newRun(true), { writer: "test", savedAt: 1 });
  const parsed = authority.parse({ kind: "legacy", save });
  expect(parsed).not.toBeNull();
  expect(parsed && authority.isCleared(parsed)).toBe(false);
  expect(authority.parse({ kind: "legacy", save: { ...save, state: { ...save.state, erasers: 99 } } })).toBeNull();
});

it("validates saved execution positions against the corresponding instruction tree", () => {
  let run = createStageRun("cursor", RAIN_INTRO.enter(null));
  const program: InstructionProgram = { version: 2, id: "line", text: "상자를 관찰하고 발판을 관찰해", model: "fixture", scope: {}, guard: false, body: { kind: "sequence", children: [
    { kind: "action", actor: "hero", verb: "observe", target: "rain-cork" },
    { kind: "action", actor: "hero", verb: "observe", target: "rain-platform" },
  ] } };
  run = departStage(writeStageProgram(run, program));
  const first = stepProgram(run.world, program.body, createCursor(), (world) => ({ world, outcome: "done", reason: "관찰" }));
  run.execution.active = { instructionId: program.id, cursor: first.cursor };
  expect(parseStageRun(run)).not.toBeNull();
  const pastEnd = structuredClone(run);
  pastEnd.execution.active!.cursor.index = 99;
  expect(parseStageRun(pastEnd)).toBeNull();
  const wrongPath = structuredClone(run);
  wrongPath.execution.active!.cursor.children[0].path = [1];
  expect(parseStageRun(wrongPath)).toBeNull();
  const undonePrefix = structuredClone(run);
  undonePrefix.execution.active!.cursor.children[0].status = "pending";
  expect(parseStageRun(undonePrefix)).toBeNull();
});

it("keeps legacy onboarding with its owning save and rejects cross-run learning records", async () => {
  const { createOnboardingProgress } = await import("../src/game/onboarding");
  const save = makeSave(newRun(true), { writer: "learning-test", settings: { muted: true, reducedMotion: true }, tutorialCompleted: false });
  const onboarding = createOnboardingProgress(save.state.id);
  const parsed = authority.parse({ kind: "legacy", save, onboarding });
  expect(parsed?.kind).toBe("legacy");
  if (parsed?.kind === "legacy") expect(parsed.onboarding).toEqual(onboarding);
  expect(authority.parse({ kind: "legacy", save, onboarding: { ...onboarding, ownerRunId: "another-run" } })).toBeNull();
  expect(authority.parse({ kind: "legacy", save })).not.toBeNull();
});
