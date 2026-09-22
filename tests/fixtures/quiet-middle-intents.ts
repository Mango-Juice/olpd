import type { PhysicalAction, ProgramNode, StageId } from "../../src/campaign/types";

const action = (
  actor: "hero" | "keeper",
  verb: PhysicalAction["verb"],
  target: string,
  extra: Partial<Pick<PhysicalAction, "destination" | "instrument">> = {},
): PhysicalAction => ({ kind: "action", actor, verb, target, ...extra });

const sequence = (...children: ProgramNode[]): ProgramNode => children.length === 1
  ? children[0]
  : { kind: "sequence", children };

const parallel = (...children: ProgramNode[]): ProgramNode => ({ kind: "parallel", children });

export interface QuietMiddleIntentCase {
  stageId: StageId;
  segmentId: string;
  text: string;
  body: ProgramNode;
}

/** Shared parser probes. This module deliberately has no Vitest dependency. */
export const QUIET_MIDDLE_INTENT_CASES: readonly QuietMiddleIntentCase[] = [
  { stageId: 5, segmentId: "05-v2-1", text: "천장길을 따라 출구까지 걸어가", body: sequence(action("hero", "move", "05-v2-1-path"), action("hero", "move", "05-v2-1-exit")) },
  { stageId: 5, segmentId: "05-v2-2", text: "천장 가시에서 몸을 띄워 출구까지 뛰어", body: action("hero", "jump", "05-v2-2-exit") },
  { stageId: 5, segmentId: "05-v2-3", text: "낮은 덩굴 아래로 걸어서 출구로 가", body: action("hero", "move", "05-v2-3-exit") },
  { stageId: 5, segmentId: "05-v2-4", text: "닫힌 꽃까지 걷고 가시꽃만 뛰어넘어 출구로 가", body: sequence(action("hero", "move", "05-v2-4-closed"), action("hero", "jump", "05-v2-4-exit")) },
  { stageId: 5, segmentId: "05-v2-5", text: "아치를 지나 중력이 뒤집히면 가시밭을 뛰어 출구로 가", body: sequence(action("hero", "move", "05-v2-5-arch"), action("hero", "jump", "05-v2-5-exit")) },
  { stageId: 5, segmentId: "05-v2-6", text: "낮은 덩굴 아래로 간 다음 가시를 뛰어넘어", body: sequence(action("hero", "move", "05-v2-6-vine"), action("hero", "jump", "05-v2-6-thorns")) },
  { stageId: 6, segmentId: "06-v2-1", text: "등불을 들고 어두운 벽감으로 들어가", body: sequence(action("hero", "take", "06-v2-lantern"), action("hero", "move", "06-v2-1-alcove")) },
  { stageId: 6, segmentId: "06-v2-2", text: "등불을 벽고리에 걸고 두 손으로 사다리를 올라", body: sequence(action("hero", "place", "06-v2-lantern", { destination: "06-v2-2-hook" }), action("hero", "climb", "06-v2-2-ladder")) },
  { stageId: 6, segmentId: "06-v2-3", text: "벽고리의 등불을 다시 챙겨 출구로 가", body: sequence(action("hero", "take", "06-v2-lantern"), action("hero", "move", "06-v2-3-exit")) },
  { stageId: 6, segmentId: "06-v2-4", text: "열쇠로 문을 열고 열쇠를 가진 채 나가", body: sequence(action("hero", "open", "06-v2-4-door", { instrument: "06-v2-key" }), action("hero", "move", "06-v2-4-exit")) },
  { stageId: 6, segmentId: "06-v2-5", text: "같은 열쇠로 아래 문과 위 문을 차례로 열고 올라가", body: sequence(action("hero", "open", "06-v2-5-lower-door", { instrument: "06-v2-key" }), action("hero", "open", "06-v2-5-upper-door", { instrument: "06-v2-key" }), action("hero", "climb", "06-v2-5-upper-door")) },
  { stageId: 6, segmentId: "06-v2-6", text: "등불을 들고 열쇠로 문을 열어 그대로 나가", body: sequence(action("hero", "take", "06-v2-lantern"), action("hero", "open", "06-v2-6-door", { instrument: "06-v2-key" }), action("hero", "move", "06-v2-6-exit")) },
  { stageId: 7, segmentId: "07-v2-1", text: "등지기야, 합류 자리로 이리 와", body: action("keeper", "move", "07-v2-1-meeting") },
  { stageId: 7, segmentId: "07-v2-2", text: "등지기가 손잡이를 잡아 막을 올려", body: action("keeper", "hold", "07-v2-2-grip") },
  { stageId: 7, segmentId: "07-v2-3", text: "용사가 막 너머로 간 뒤 등지기는 손잡이를 놓아", body: sequence(action("hero", "move", "07-v2-3-curtain"), action("keeper", "release", "07-v2-3-grip")) },
  { stageId: 7, segmentId: "07-v2-4", text: "용사가 낮은 손잡이를 잡고 등지기는 막 너머로 가", body: sequence(action("hero", "hold", "07-v2-4-low-grip"), action("keeper", "move", "07-v2-4-arrival")) },
  { stageId: 7, segmentId: "07-v2-5", text: "둘이 긴 의자를 들어 틈에 놓고 함께 건너편으로 가", body: sequence(parallel(action("hero", "take", "07-v2-5-bench"), action("keeper", "take", "07-v2-5-bench")), parallel(action("hero", "place", "07-v2-5-bench", { destination: "07-v2-5-gap" }), action("keeper", "place", "07-v2-5-bench", { destination: "07-v2-5-gap" })), parallel(action("hero", "move", "07-v2-5-bank"), action("keeper", "move", "07-v2-5-bank"))) },
  { stageId: 7, segmentId: "07-v2-6", text: "막을 걸쇠로 고정하고 용사와 등지기가 함께 나가", body: sequence(action("hero", "tie", "07-v2-6-curtain", { destination: "07-v2-6-latch" }), parallel(action("hero", "move", "07-v2-6-exit"), action("keeper", "move", "07-v2-6-exit"))) },
];
