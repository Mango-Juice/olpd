import { describe, expect, it } from "vitest";
import { campaignAuthority } from "../src/campaign/authority";
import { STAGES } from "../src/campaign/catalog";
import { stageDynamics } from "../src/campaign/level";
import { resolveStage } from "../src/campaign/registry";
import {
  abandonStage,
  acknowledgePresentation,
  advanceStage,
  createCampaignRun,
  departStage,
  retryStage,
  writeStageProgram,
  type StageRun,
} from "../src/campaign/run";
import { QUIET_EARLY_INTENT_CASES } from "../src/campaign/quiet/early";
import type { InstructionProgram } from "../src/campaign/types";
import { QUIET_LATE_INTENT_CASES } from "./fixtures/quiet-late-intents";
import { QUIET_MIDDLE_INTENT_CASES } from "./fixtures/quiet-middle-intents";
const probes = [...QUIET_EARLY_INTENT_CASES, ...QUIET_MIDDLE_INTENT_CASES, ...QUIET_LATE_INTENT_CASES];
const authority = campaignAuthority(resolveStage);
function restore(run: StageRun): StageRun {
  const parsed = authority.parse(JSON.parse(JSON.stringify({ kind: 'world', run })));
  expect(parsed, `serialized ${run.world.segmentId}, revision ${run.revision}, ${run.phase}`).not.toBeNull();
  if (parsed?.kind !== "world") throw new Error("Unrestorable run");
  return parsed.run;
}

function authorize(run: StageRun): StageRun {
  const parsed = authority.parse({ kind: "world", run });
  expect(parsed, `authority ${run.world.segmentId}, revision ${run.revision}, ${run.phase}`).not.toBeNull();
  if (parsed?.kind !== "world") throw new Error("Unauthorized run");
  return parsed.run;
}

function accumulatedPrograms(stageId: number): InstructionProgram[] {
  return probes.filter((entry) => entry.stageId === stageId).map((probe) => ({
    version: 2,
    id: `accumulated-${probe.segmentId}`,
    text: probe.text,
    model: "fixture",
    scope: { stageId: probe.stageId, region: probe.segmentId },
    guard: false,
    body: probe.body,
  }));
}

function solutionProgram(stageId: number, segmentId: string): InstructionProgram {
  const probe = probes.find((entry) => entry.stageId === stageId && entry.segmentId === segmentId);
  if (!probe) throw new Error(`missing solution probe ${segmentId}`);
  return {
    version: 2,
    id: `learned-${segmentId}`,
    text: probe.text,
    model: "fixture",
    scope: { stageId: probe.stageId, region: probe.segmentId },
    guard: false,
    body: probe.body,
  };
}

function acknowledgeAndRestore(run: StageRun): StageRun {
  return run.presentation ? authorize(acknowledgePresentation(run)) : run;
}

describe("shared campaign accumulated notebook replay", () => {
  it.each(STAGES.slice(1))("finishes chapter $id from one entrance notebook across serialized boundaries", (summary) => {
    const stage = resolveStage(summary.id)!;
    const programs = accumulatedPrograms(stage.id);
    let run = createCampaignRun(`integration-${stage.id}`, stage);
    run = {
      ...run,
      notebook: { ...run.notebook, instructions: programs },
      history: { ...run.history, initialInstructions: structuredClone(programs) },
    };
    run = restore(departStage(run));
    const dynamics = stageDynamics(stage);
    let lastTick = run.world.tick;
    const attempt = run.world.attempt;
    for (let boundary = 0; boundary < 1_000 && run.phase !== "cleared"; boundary += 1) {
      expect(["running", "waiting"], `${run.world.segmentId}: ${run.statusReason}`).toContain(run.phase);
      run = restore(advanceStage(run, dynamics));
      expect(run.notebook.instructions).toHaveLength(programs.length);
      expect(run.world.tick).toBeGreaterThanOrEqual(lastTick);
      expect(run.world.attempt).toBe(attempt);
      lastTick = run.world.tick;
      if (run.presentation) run = restore(acknowledgePresentation(run));
    }
    expect(run.phase, run.statusReason ?? stage.title).toBe("cleared");
    expect(run.clearedSegments).toEqual(stage.segments.map((scene) => scene.id));
    expect(run.notebook.instructions.map((item) => item.id)).toEqual(programs.map((item) => item.id));
    expect(authority.isCleared({ kind: "world", run })).toBe(true);
  });

  it.each(STAGES.slice(1))("learns chapter $id one death-granted line at a time from the entrance", (summary) => {
    const stage = resolveStage(summary.id)!;
    const dynamics = stageDynamics(stage);
    let run = authorize(createCampaignRun(`learning-${stage.id}`, stage));

    for (const [index, scene] of stage.segments.entries()) {
      run = authorize(writeStageProgram(run, solutionProgram(stage.id, scene.id)));
      expect(run.notebook.instructions).toHaveLength(index + 1);
      expect(run.notebook.deaths).toBe(index);

      if (run.phase === "failed") {
        run = acknowledgeAndRestore(authorize(retryStage(run)));
        expect(run.phase).toBe("bookmark");
        expect(run.world.segmentId).toBe(stage.segments[0].id);
      }
      run = authorize(departStage(run));

      for (let boundary = 0; boundary < 1_000 && run.phase !== "cleared" && run.phase !== "failed" && run.phase !== "blocked"; boundary += 1) {
        run = acknowledgeAndRestore(authorize(advanceStage(run, dynamics)));
      }

      expect(run.clearedSegments, `${scene.id}: ${run.statusReason}`).toEqual(stage.segments.slice(0, index + 1).map((item) => item.id));
      expect(run.notebook.instructions).toHaveLength(index + 1);
      if (index === stage.segments.length - 1) {
        expect(run.phase, run.statusReason ?? scene.id).toBe("cleared");
        break;
      }

      expect(run.world.segmentId).toBe(stage.segments[index + 1].id);
      if (run.phase === "blocked") run = acknowledgeAndRestore(authorize(abandonStage(run)));
      expect(run.phase, `${scene.id}: ${run.statusReason}`).toBe("failed");
      expect(run.notebook.canWrite).toBe(true);
    }

    expect(run.notebook.instructions.map((item) => item.id)).toEqual(stage.segments.map((scene) => `learned-${scene.id}`));
    expect(run.notebook.deaths).toBe(5);
    expect(authority.isCleared({ kind: "world", run })).toBe(true);
  });
});
