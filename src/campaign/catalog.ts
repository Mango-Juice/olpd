import type { StageId, StageSummary } from "./types";

export interface CampaignStageSummary extends StageSummary {
  /** Stable implemented puzzle count, excluding required onboarding. */
  coreSegments: number;
  onboardingSegments: number;
}
export const STAGES: readonly CampaignStageSummary[] = [
  { id: 1, slug: "memory-dungeon", title: "기억의 던전", subtitle: "한 줄의 기억으로 걷는 길", segments: 12, coreSegments: 8, onboardingSegments: 4 },
  { id: 2, slug: "rain-corridor", title: "비에 잠긴 회랑", subtitle: "물건과 물길을 이어서", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 3, slug: "clockwork-kitchen", title: "태엽 부엌", subtitle: "기다림에도 순서가 있어", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 4, slug: "wind-forge", title: "바람 대장간", subtitle: "힘을 옮기고 결과를 남겨", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 5, slug: "inverted-garden", title: "뒤집힌 정원", subtitle: "달라진 곳에 맞는 약속", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 6, slug: "lantern-storehouse", title: "등불 보관소", subtitle: "놓고, 되찾고, 다시 쓰기", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 7, slug: "counterweight-theatre", title: "평형 인형극장", subtitle: "함께 움직이는 두 역할", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 8, slug: "fog-signal-yard", title: "안개 신호장", subtitle: "본 것과 아직 모르는 것", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 9, slug: "inner-bell-tower", title: "종탑의 안쪽", subtitle: "지나온 관계를 하나로", segments: 6, coreSegments: 6, onboardingSegments: 0 },
  { id: 10, slug: "returnless-warden", title: "돌아오지 못한 문지기", subtitle: "세 봉인 너머의 편지", segments: 6, coreSegments: 6, onboardingSegments: 0 },
];

export function stageSummary(id: StageId): CampaignStageSummary {
  return STAGES[id - 1];
}
export function isStageId(value: unknown): value is StageId {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;
}
