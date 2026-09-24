import type { OnboardingProgress } from '../onboarding';
import type { RunState } from '../types';
import { latestDiscovery, type DiscoveryHint } from './discovery';

const GAP: DiscoveryHint = { key: 'gap', text: '이 정도 틈이면 뛰어넘을 수 있을 것 같아.' };
const LOW: DiscoveryHint = { key: 'low-clearance', text: '몸을 낮추면 아래로 지나갈 수 있겠어.' };
const SIDE: DiscoveryHint = { key: 'side-route', text: '벽 옆으로 길이 이어져 있네.' };
const onboardingHints: Readonly<Record<string, DiscoveryHint>> = { 'single-gap': GAP, 'low-arch': LOW, 'side-path': SIDE };

export function onboardingContactHint(progress: OnboardingProgress): string | null {
  return latestDiscovery(progress.attempts, attempt => {
    const hint = onboardingHints[attempt.stageId];
    return hint && attempt.applied && !attempt.succeeded ? [hint] : [];
  })?.text ?? null;
}

export function chapterOneContactHint(state: RunState, onboarding?: OnboardingProgress | null): DiscoveryHint | null {
  if (state.phase !== 'dead' || state.lastEvent?.outcome !== 'death' || state.events.at(-1)?.id !== state.lastEvent.id) return null;
  const learned = (onboarding?.completedStageIds ?? []).flatMap(id => onboardingHints[id] ? [onboardingHints[id].key] : []);
  return latestDiscovery(state.events, event => {
    if (event.outcome !== 'death') return [];
    if (event.observation === 'pit' || event.observation === 'bridge') return [GAP];
    if (event.observation === 'lowCeiling') return [LOW];
    if (event.observation === 'floorSpikes') return [{ key: 'floor-spikes', text: '가시 위쪽은 비어 있네. 바닥에 닿지 않게 건널 수 있을까?' }];
    if (event.observation === 'pitCeilingPath' || event.observation === 'spikesCeilingPath') return [{ key: 'combined-hazards', text: '위아래가 막혔네. 옆길로 우회할 수 있겠어.' }];
    return [];
  }, learned);
}

/** Visible first steps for the integrated chapter, including retries at the entrance. */
export function chapterOneLearningHint(state: RunState, room: number): string | null {
  if (state.tutorial || (state.layoutVersion !== 2 && state.layoutVersion !== 3) || state.phase === 'cleared') return null;
  if (room === 0 && state.instructions.length === 0) return '먼저 “앞으로 전진해”라고 적고 Enter를 눌러 보세요. 용사는 그 말을 계속 기억해요.';
  if (room === 0) return '메모는 다음 장면에서도 남아요. 조건이 있는 메모를 전진보다 위에 두면, 위험할 때 먼저 실행해요.';
  if (room === 1) return '끊긴 바닥은 뛰어넘어야 해요. “구덩이가 있으면 뛰어”를 전진보다 위에 두어 보세요. 죽은 뒤 한 줄을 더 쓸 수 있어요.';
  if (room === 2) return '천장이 낮으면 몸을 숙여야 해요. “천장이 낮으면 숙여”처럼 상황과 행동을 함께 적어 보세요.';
  return null;
}
