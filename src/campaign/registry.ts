import type { CampaignStageDefinition } from './level';
import type { StageId } from './types';
import { SPATIAL_STAGES } from './spatial/catalog.js';

const CHAPTER_PURPOSE: Partial<Record<StageId, string>> = {
  2: '편지를 젖지 않게 지키며 회랑을 건너야 해요.',
  3: '멈춰 선 부엌을 지나 편지의 길을 찾아요.',
  4: '바람을 빌려 대장간 위쪽으로 올라가요.',
  5: '뒤집힌 정원을 지나 다음 문을 찾아요.',
  6: '등불을 챙겨 어두운 보관소를 빠져나가요.',
  7: '등지기와 함께 극장을 빠져나가야 해요.',
  8: '안개 속 길을 확인하며 건너편으로 가요.',
  9: '등지기와 함께 종탑 위로 올라가요.',
  10: '문지기를 구하고, 함께 편지를 전하러 가요.',
};
const DEFINITIONS: Partial<Record<StageId, CampaignStageDefinition>> = Object.fromEntries(
  SPATIAL_STAGES.map((stage) => [stage.id, { ...stage, objective: CHAPTER_PURPOSE[stage.id] ?? stage.objective }]),
);

/** Access is governed by verified completion; old worlds are recovery records, not live scenes. */
export function resolveStage(id: StageId): CampaignStageDefinition | null {
  return DEFINITIONS[id] ?? null;
}
