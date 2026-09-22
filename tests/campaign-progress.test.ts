import { describe, expect, it } from "vitest";
import {
  completeVerifiedRun,
  createCampaignState,
  setActiveRun,
  updateCampaignSettings,
  validateCampaignState,
  verifyRunCompletion,
  type RunCompletionAuthority,
} from "../src/campaign/progress";
import type { StageId } from "../src/campaign/types";

interface TestRun {
  id: string;
  stageId: StageId;
  phase: "active" | "cleared";
}

const authority: RunCompletionAuthority<TestRun> = {
  serialize: (run) => ({ ...run }),
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      !("stageId" in value) ||
      !("phase" in value) ||
      typeof value.id !== "string" ||
      !Number.isInteger(value.stageId) ||
      Number(value.stageId) < 1 ||
      Number(value.stageId) > 10 ||
      (value.phase !== "active" && value.phase !== "cleared")
    ) {
      return null;
    }
    return {
      id: value.id,
      stageId: Number(value.stageId) as StageId,
      phase: value.phase,
    };
  },
  describe: (run) => ({ runId: run.id, stageId: run.stageId }),
  isCleared: (run) => run.phase === "cleared",
};

describe("campaign progression", () => {
  it("starts with only stage 1 unlocked", () => {
    const state = createCampaignState("tab-a");
    expect(state.stages.map((stage) => stage.status)).toEqual([
      "unlocked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
    expect(validateCampaignState(state)).toEqual({ ok: true, value: state });
    expect(state.settings).toBeNull();
  });

  it("normalizes omitted v1 settings to null and validates explicit settings", () => {
    const current = createCampaignState("tab-a");
    const oldV1 = {
      version: current.version,
      writer: current.writer,
      revision: current.revision,
      stages: current.stages,
    };
    const normalized = validateCampaignState(oldV1);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.value.settings).toBeNull();

    expect(
      validateCampaignState({
        ...current,
        settings: { muted: "yes", reducedMotion: false },
      }).ok,
    ).toBe(false);

    const updated = updateCampaignSettings(
      current,
      { muted: true, reducedMotion: true },
      "tab-b",
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.settings).toEqual({
      muted: true,
      reducedMotion: true,
    });
    expect(updated.value.writer).toBe("tab-b");
    expect(updated.value.revision).toBe(1);
  });

  it("rejects skipped unlocks and cross-stage active references", () => {
    const state = createCampaignState("tab-a");
    const skipped = {
      ...state,
      stages: state.stages.map((stage) =>
        stage.stageId === 3 ? { ...stage, status: "unlocked" as const } : stage,
      ),
    };
    expect(validateCampaignState(skipped).ok).toBe(false);

    const crossed = {
      ...state,
      stages: state.stages.map((stage) =>
        stage.stageId === 1
          ? {
              ...stage,
              activeRun: { runId: "run-2", stageId: 2 as const },
            }
          : stage,
      ),
    };
    expect(validateCampaignState(crossed).ok).toBe(false);
  });

  it("never reuses one run ID across stage references", () => {
    let state = createCampaignState("tab-a");
    const first = setActiveRun(
      state,
      { runId: "shared", stageId: 1 },
      "tab-a",
    );
    if (!first.ok) return;
    const proof = verifyRunCompletion(
      { id: "shared", stageId: 1, phase: "cleared" },
      authority,
    );
    if (!proof.ok) return;
    const completed = completeVerifiedRun(first.value, proof.value, "tab-a", 1);
    if (!completed.ok) return;
    state = completed.value;
    const reused = setActiveRun(
      state,
      { runId: "shared", stageId: 2 },
      "tab-a",
    );
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.error.code).toBe("invalid-run");
  });

  it("requires a cleared, semantically parsed active run before unlocking", () => {
    let state = createCampaignState("tab-a");
    const active: TestRun = { id: "run-1", stageId: 1, phase: "active" };
    const uncleared = verifyRunCompletion(active, authority);
    expect(uncleared.ok).toBe(false);

    const locked = setActiveRun(
      state,
      { runId: "run-2", stageId: 2 },
      "tab-a",
    );
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe("locked");

    const withActive = setActiveRun(
      state,
      { runId: "run-1", stageId: 1 },
      "tab-a",
    );
    expect(withActive.ok).toBe(true);
    if (!withActive.ok) return;
    state = withActive.value;

    const other = verifyRunCompletion(
      { id: "other", stageId: 1, phase: "cleared" },
      authority,
    );
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const mismatch = completeVerifiedRun(state, other.value, "tab-a", 10);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("active-run-mismatch");

    const verified = verifyRunCompletion(
      { ...active, phase: "cleared" },
      authority,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const completed = completeVerifiedRun(state, verified.value, "tab-b", 10);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value.stages[0]).toMatchObject({
      status: "completed",
      activeRun: null,
      completion: { source: "campaign", completedAt: 10 },
    });
    expect(completed.value.stages[1].status).toBe("unlocked");
    expect(completed.value.writer).toBe("tab-b");
    expect(completed.value.revision).toBe(2);
  });

  it("cannot substitute an unbranded caller boolean for completion evidence", () => {
    const started = setActiveRun(
      createCampaignState("tab-a"),
      { runId: "run-1", stageId: 1 },
      "tab-a",
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const forged = {
      run: { id: "run-1", stageId: 1, phase: "cleared" },
      reference: { runId: "run-1", stageId: 1 },
      serialized: {},
      cleared: true,
    };
    const result = completeVerifiedRun(
      started.value,
      forged as never,
      "tab-a",
      1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-run");
  });

  it("advances all 10 stages sequentially and stops after stage 10", () => {
    let state = createCampaignState("tab-a");
    for (let number = 1; number <= 10; number += 1) {
      const stageId = number as StageId;
      const run: TestRun = {
        id: `run-${number}`,
        stageId,
        phase: "cleared",
      };
      const active = setActiveRun(
        state,
        { runId: run.id, stageId },
        "tab-a",
      );
      expect(active.ok).toBe(true);
      if (!active.ok) return;
      const verified = verifyRunCompletion(run, authority);
      expect(verified.ok).toBe(true);
      if (!verified.ok) return;
      const completed = completeVerifiedRun(
        active.value,
        verified.value,
        "tab-a",
        number,
      );
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;
      state = completed.value;
    }
    expect(state.stages.every((stage) => stage.status === "completed")).toBe(
      true,
    );
    expect(state.revision).toBe(20);
    expect(validateCampaignState(state).ok).toBe(true);
  });

  it("allows a completed stage replay without replacing its first completion", () => {
    const firstRun: TestRun = { id: "first", stageId: 1, phase: "cleared" };
    const started = setActiveRun(
      createCampaignState("tab-a"),
      { runId: firstRun.id, stageId: 1 },
      "tab-a",
    );
    const firstProof = verifyRunCompletion(firstRun, authority);
    expect(started.ok && firstProof.ok).toBe(true);
    if (!started.ok || !firstProof.ok) return;
    const first = completeVerifiedRun(
      started.value,
      firstProof.value,
      "tab-a",
      1,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replayRun: TestRun = {
      id: "replay",
      stageId: 1,
      phase: "cleared",
    };
    const replayStarted = setActiveRun(
      first.value,
      { runId: replayRun.id, stageId: 1 },
      "tab-a",
    );
    const replayProof = verifyRunCompletion(replayRun, authority);
    expect(replayStarted.ok && replayProof.ok).toBe(true);
    if (!replayStarted.ok || !replayProof.ok) return;
    const replayed = completeVerifiedRun(
      replayStarted.value,
      replayProof.value,
      "tab-a",
      2,
    );
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value.stages[0].completion?.run.runId).toBe("first");
    expect(replayed.value.stages[0].activeRun).toBeNull();
    expect(replayed.value.stages[1].status).toBe("unlocked");
    expect(validateCampaignState(replayed.value).ok).toBe(true);
  });
});
