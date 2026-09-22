import { expect, it } from "vitest";
import { RAIN_STAGE } from "../src/campaign/stages/rain";
import { stageDynamics } from "../src/campaign/level";
import { createStageRun, departStage, advanceStage, rewindStage } from "../src/campaign/run";
import { writeProgram } from "../src/campaign/notebook";
import { campaignAuthority } from "../src/campaign/authority";
// Historical runtime regression fixture; this chapter is not in the current registry.
const resolveStage = (id: number) => id === 2 ? RAIN_STAGE : null;
import type { PhysicalAction, ProgramNode } from "../src/campaign/types";
const act = (verb: PhysicalAction["verb"], target: string, rest: Partial<PhysicalAction> = {}): PhysicalAction => ({ kind: "action", actor: "hero", verb, target, ...rest });
const plans: Record<string, ProgramNode[]> = {
  "02-1": [act("place", "rain-cork", { destination: "rain-launch" }), act("board", "rain-cork"), act("dismount", "rain-cork", { destination: "rain-platform" })],
  "02-2": [act("open", "channels-gate"), { kind: "wait", until: { kind: "property", entity: "channels-tank", property: "level", comparison: "gte", value: 3, source: "visible" } }, act("close", "channels-gate"), act("board", "channels-bridge"), act("dismount", "channels-bridge", { destination: "channels-exit" })],
  "02-3": [act("pour", "reach-basin", { destination: "reach-barrel", amount: 2 }), act("climb", "reach-barrel"), act("pull", "reach-handle"), act("dismount", "reach-barrel", { destination: "reach-exit" })],
  "02-4": [act("tie", "boat-striped", { destination: "boat-dotted", instrument: "boat-short-rope" }), act("place", "boat-door-weight", { destination: "boat-dotted" }), act("board", "boat-striped"), act("dismount", "boat-striped", { destination: "boat-exit" }), act("place", "boat-door-weight", { destination: "boat-pedestal" })],
  "02-5": [act("turn", "organ-gutter", { amount: 1 }), act("place", "organ-stone-bag", { destination: "organ-hook" }), act("turn", "organ-gutter", { amount: 1 }), act("board", "organ-lift"), act("dismount", "organ-lift", { destination: "organ-exit" })],
};
it("plays the entire five-segment rain stage through notebook grants and serializable saved boundaries", () => {
  let run = createStageRun("rain-full", RAIN_STAGE.segments[0].enter(null));
  const authority = campaignAuthority(resolveStage);
  const dynamics = stageDynamics(RAIN_STAGE);
  let bookmarks = 0;
  for (let step = 0; step < 100 && run.phase !== "cleared"; step++) {
    if (run.phase === "bookmark") {
      bookmarks++;
      const id = run.world.segmentId;
      expect(run.notebook.canWrite).toBe(true);
      run = { ...run, revision: run.revision + 1, notebook: writeProgram(run.notebook, { version: 2, id, text: `${id} physical integration fixture`, model: "fixture-only", scope: {}, guard: false, body: { kind: "sequence", children: plans[id] } }) };
      run = departStage(run);
    }
    run = advanceStage(run, dynamics);
    expect(run.phase, run.statusReason ?? "").not.toBe("blocked");
    expect(run.notebook.bells, run.statusReason ?? "").toBe(0);
    const restored = authority.parse(JSON.parse(JSON.stringify({ kind: "world", run })));
    expect(restored, `saved boundary ${run.world.segmentId}:${run.revision}`).not.toBeNull();
    if (restored?.kind === "world") run = restored.run;
  }
  expect(run.phase).toBe("cleared");
  expect(bookmarks).toBe(5);
  expect(run.clearedSegments).toEqual(RAIN_STAGE.segments.map((segment) => segment.id));
  expect(run.notebook.instructions).toHaveLength(5);
});
it("a later room's notes do not block earlier literal-object procedures after rewinding", () => {
  let run = createStageRun("rain-rewind", RAIN_STAGE.segments[0].enter(null));
  for (const id of ["02-1", "02-2"]) {
    run.notebook.canWrite = true;
    run.notebook = writeProgram(run.notebook, { version: 2, id, text: id, model: "fixture", scope: {}, guard: false, body: { kind: "sequence", children: plans[id] } });
  }
  run = departStage(rewindStage(run));
  run = advanceStage(run, stageDynamics(RAIN_STAGE));
  expect(run.events[0].instructionId).toBe("02-1");
  expect(run.events[0].target).toBe("rain-cork");
});
