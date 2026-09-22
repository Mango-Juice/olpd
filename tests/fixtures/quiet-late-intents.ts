import { QUIET_LATE_REPRESENTATIVE_PROGRAMS } from "../../src/campaign/quiet/late";
import type { ProgramNode, StageId } from "../../src/campaign/types";

export interface QuietLateIntentCase {
  stageId: Extract<StageId, 8 | 9 | 10>;
  segmentId: string;
  text: string;
  body: ProgramNode;
}

/** Plain data shared by deterministic tests and opt-in live interpretation probes. */
export const QUIET_LATE_INTENT_CASES: readonly QuietLateIntentCase[] = Object.entries(
  QUIET_LATE_REPRESENTATIVE_PROGRAMS,
).map(([segmentId, instruction]) => ({
  stageId: Number(segmentId.slice(0, 2)) as QuietLateIntentCase["stageId"],
  segmentId,
  text: instruction.text,
  body: instruction.body,
}));

/** Exact bodies returned by the first live DeepSeek pass for runtime regressions. */
export const QUIET_LATE_LIVE_REGRESSION_CASES: readonly QuietLateIntentCase[] = [
  {
    stageId: 8,
    segmentId: "08-v2-1",
    text: "안개를 살펴보고 드러난 돌다리를 건너 출구로 가.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "observe", target: "08-v2-1-mist" },
      { kind: "action", actor: "hero", verb: "move", target: "08-v2-1-bridge" },
      { kind: "action", actor: "hero", verb: "move", target: "08-v2-1-exit" },
    ] },
  },
  {
    stageId: 8,
    segmentId: "08-v2-2",
    text: "두 다리를 살펴보고 이어진 쪽으로 가.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "observe", target: "08-v2-2-left-bridge" },
      { kind: "action", actor: "hero", verb: "observe", target: "08-v2-2-right-bridge" },
      {
        kind: "if",
        condition: { kind: "property", entity: "08-v2-2-left-bridge", property: "visibleState", comparison: "eq", value: "connected", source: "visible" },
        then: { kind: "action", actor: "hero", verb: "move", target: "08-v2-2-left-bridge" },
        otherwise: {
          kind: "if",
          condition: { kind: "property", entity: "08-v2-2-right-bridge", property: "visibleState", comparison: "eq", value: "connected", source: "visible" },
          then: { kind: "action", actor: "hero", verb: "move", target: "08-v2-2-right-bridge" },
        },
      },
    ] },
  },
  {
    stageId: 8,
    segmentId: "08-v2-2",
    text: "두 다리를 살펴보고 이어진 쪽으로 가.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "observe", target: "08-v2-2-left-bridge" },
      { kind: "action", actor: "hero", verb: "observe", target: "08-v2-2-right-bridge" },
      {
        kind: "if",
        condition: { kind: "property", entity: "08-v2-2-left-bridge", property: "visibleState", comparison: "eq", value: "connected", source: "visible" },
        then: { kind: "action", actor: "hero", verb: "move", target: "08-v2-2-island" },
        otherwise: {
          kind: "if",
          condition: { kind: "property", entity: "08-v2-2-right-bridge", property: "visibleState", comparison: "eq", value: "connected", source: "visible" },
          then: { kind: "action", actor: "hero", verb: "move", target: "08-v2-2-island" },
        },
      },
    ] },
  },
  {
    stageId: 8,
    segmentId: "08-v2-4",
    text: "등불로 계단을 비추고 올라가.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "turn", target: "08-v2-4-lantern", destination: "08-v2-4-stairs" },
      { kind: "action", actor: "hero", verb: "climb", target: "08-v2-4-stairs" },
    ] },
  },
  {
    stageId: 9,
    segmentId: "09-v2-1",
    text: "받침 블록을 계단에 놓고 계단을 올라.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "place", target: "09-v2-1-support", destination: "09-v2-1-stairs" },
      { kind: "action", actor: "hero", verb: "climb", target: "09-v2-1-stairs" },
    ] },
  },
  {
    stageId: 9,
    segmentId: "09-v2-4",
    text: "등불을 챙겨 계단으로 가.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "take", target: "09-v2-4-lantern" },
      { kind: "action", actor: "hero", verb: "move", target: "09-v2-4-stairs" },
    ] },
  },
  {
    stageId: 10,
    segmentId: "10-v2-2",
    text: "갑옷 걸쇠를 풀고 내려온 갑옷판을 건너.",
    body: { kind: "sequence", children: [
      { kind: "action", actor: "hero", verb: "untie", target: "10-v2-2-latch" },
      { kind: "action", actor: "hero", verb: "move", target: "10-v2-2-plate" },
    ] },
  },
  {
    stageId: 10,
    segmentId: "10-v2-5",
    text: "등지기는 고리를 잡고 나는 걸쇠를 풀어.",
    body: { kind: "parallel", children: [
      { kind: "action", actor: "keeper", verb: "hold", target: "10-v2-5-ring" },
      { kind: "action", actor: "hero", verb: "untie", target: "10-v2-5-latch" },
    ] },
  },
];
