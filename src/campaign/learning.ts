import type { StageRun } from "./run";
import type { StageId, WorldEvent } from "./types";

interface LearningStep {
  first: string;
  afterAction: string;
}

const LEARNING_STEPS: Partial<Record<StageId, LearningStep>> = {
  2: {
    first: "먼저 물건 하나를 살펴보고, 무엇이 움직이거나 물에 뜰 수 있는지 확인해 보세요.",
    afterAction: "첫 움직임 뒤에는 물건의 위치와 물길이 어떻게 달라졌는지 한 번 확인해 보세요.",
  },
  3: {
    first: "먼저 움직이는 장치 하나를 살펴보고, 반복되는 순서가 있는지 확인해 보세요.",
    afterAction: "첫 행동 뒤에는 장면이 바뀌는 박자를 한 번 지켜보세요.",
  },
  4: {
    first: "먼저 장치 하나를 살펴보고, 힘이 어디로 이어지는지 확인해 보세요.",
    afterAction: "첫 행동 뒤에도 남아 있는 상태가 무엇인지 한 가지만 확인해 보세요.",
  },
  5: {
    first: "먼저 현재 방의 방향 표시 하나를 살펴보세요.",
    afterAction: "첫 행동 뒤에는 방이 달라질 때 같은 지침이 어떻게 적용되는지 살펴보세요.",
  },
  6: {
    first: "먼저 물건 하나를 살펴보고, 들거나 다시 회수할 수 있는지 확인해 보세요.",
    afterAction: "첫 행동 뒤에는 손과 보관 자리에 무엇이 남았는지 확인해 보세요.",
  },
  7: {
    first: "먼저 용사와 등지기가 각각 닿을 수 있는 장치 하나를 살펴보세요.",
    afterAction: "첫 행동 뒤에는 누가 장치를 유지하고 있는지 확인해 보세요.",
  },
  8: {
    first: "먼저 눈으로 확인할 수 있는 상태 하나를 골라 관찰해 보세요.",
    afterAction: "첫 행동 뒤에는 직접 본 사실과 아직 모르는 상태를 구분해 보세요.",
  },
  9: {
    first: "먼저 장치 하나를 살펴보고, 연결된 다른 장치가 있는지 확인해 보세요.",
    afterAction: "첫 행동 뒤에는 한 변화가 어느 장치까지 이어졌는지 확인해 보세요.",
  },
  10: {
    first: "먼저 지금 보이는 장치 하나를 살펴보고, 익숙한 원리가 있는지 떠올려 보세요.",
    afterAction: "첫 행동 뒤에는 바뀐 상태 하나만 확인하고 다음 판단을 직접 정해 보세요.",
  },
};

function isActualAction(event: WorldEvent) {
  return event.instructionId !== null
    && event.actor !== null
    && event.target !== null
    && (event.outcome === "safe"
      || event.outcome === "observed"
      || event.outcome === "failure");
}

/**
 * Shows one stage concept at a time without deriving a solution from the event.
 * Historical events from another segment or attempt do not advance the note.
 */
export function campaignLearningNote(run: StageRun): string {
  const step = LEARNING_STEPS[run.stageId] ?? {
    first: "먼저 궁금한 물건 하나를 골라 살펴보세요.",
    afterAction: "첫 행동 뒤에는 달라진 상태 하나만 확인해 보세요.",
  };
  const actedHere = run.events.some((event) =>
    event.segmentId === run.world.segmentId
    && event.attempt === run.world.attempt
    && isActualAction(event));
  return actedHere ? step.afterAction : step.first;
}
