import { isOnboardingProgress, progressBelongsToRun, type OnboardingProgress } from "../game/onboarding";
import { loadSave } from "../game/storage";
import type { SaveData } from "../game/types";
import { allStageSegments, isOnboardingSegment, type CampaignStageDefinition } from "./level";
import type { RunCompletionAuthority } from "./progress";
import type { StageRun } from "./run";
import { parseStageRun } from "./run-validation";
import { stageSummary } from "./catalog";
import type { StageId } from "./types";

export type CampaignStoredRun = { kind: "legacy"; save: SaveData; onboarding?: OnboardingProgress } | { kind: "world"; run: StageRun };
export function campaignAuthority(resolveStage: (id: StageId) => CampaignStageDefinition | null): RunCompletionAuthority<CampaignStoredRun> {
  return {
    parse(value) {
      if (!value || typeof value !== "object") return null;
      const raw = value as Record<string, unknown>;
      if (raw.kind === "legacy") {
        const parsed = loadSave({ getItem: () => JSON.stringify(raw.save), setItem: () => undefined });
        if (!parsed.ok || !parsed.value) return null;
        if (raw.onboarding !== undefined && (!isOnboardingProgress(raw.onboarding) || !progressBelongsToRun(raw.onboarding, parsed.value.state.id))) return null;
        return { kind: "legacy", save: parsed.value, ...(raw.onboarding !== undefined ? { onboarding: structuredClone(raw.onboarding) as OnboardingProgress } : {}) };
      }
      if (raw.kind !== "world") return null;
      const run = parseStageRun(raw.run);
      if (!run) return null;
      const stage = resolveStage(run.stageId);
      if (!stage || stage.segments.length !== stageSummary(run.stageId).coreSegments) return null;
      const allSegments = allStageSegments(stage);
      if (new Set(allSegments.map((segment) => segment.id)).size !== allSegments.length) return null;
      // Content wording may change without invalidating a saved physical state.
      const labels = new Map([...allSegments, stage.practice].flatMap((segment) =>
        Object.values(segment.enter(null).entities).map((entity) => [entity.id, entity] as const)));
      for (const world of [run.world, run.checkpoint]) {
        for (const entity of Object.values(world.entities)) {
          const current = labels.get(entity.id);
          if (current) { entity.name = current.name; entity.description = current.description; }
        }
      }
      const ids = stage.segments.map((segment) => segment.id);
      const onboardingIds = (stage.onboarding ?? []).map((segment) => segment.id);
      if (run.clearedSegments.some((id) => !ids.includes(id))) return null;
      if (!run.learning) {
        // Version-2 core saves predate onboarding. Preserve them without inventing learning history.
        if (!ids.includes(run.world.segmentId) || !ids.includes(run.checkpoint.segmentId) || run.notebook.scratch || run.notebook.visitedBookmarks.some((id) => !ids.includes(id))) return null;
      } else {
        const completed = run.learning.completedSegmentIds;
        if (completed.length > onboardingIds.length || completed.some((id, index) => id !== onboardingIds[index])) return null;
        if (run.learning.attemptedSentences.some((attempt) => {
          const index = onboardingIds.indexOf(attempt.segmentId);
          const currentIndex = onboardingIds.indexOf(run.world.segmentId);
          return index < 0 || index > (currentIndex >= 0 ? currentIndex : onboardingIds.length - 1);
        })) return null;
        if (isOnboardingSegment(stage, run.world.segmentId)) {
          const currentIndex = onboardingIds.indexOf(run.world.segmentId);
          if (currentIndex !== completed.length || run.checkpoint.segmentId !== run.world.segmentId || run.notebook.scratch !== true || run.notebook.visitedBookmarks.length !== 1 || run.notebook.visitedBookmarks[0] !== run.world.segmentId) return null;
        } else if (!ids.includes(run.world.segmentId) || !ids.includes(run.checkpoint.segmentId) || completed.length !== onboardingIds.length || run.notebook.scratch || run.notebook.visitedBookmarks.some((id) => !ids.includes(id))) return null;
      }
      if (run.phase === "cleared" && (run.clearedSegments.length !== stage.segments.length || run.world.segmentId !== ids[ids.length - 1] || !stage.segments[stage.segments.length - 1].complete(run.world))) return null;
      return { kind: "world", run };
    },
    serialize: (run) => structuredClone(run),
    describe: (run) => run.kind === "legacy" ? { stageId: 1, runId: run.save.state.id } : { stageId: run.run.stageId, runId: run.run.id },
    isCleared: (run) => run.kind === "legacy" ? !run.save.state.tutorial && run.save.state.phase === "cleared" : run.run.phase === "cleared",
  };
}
