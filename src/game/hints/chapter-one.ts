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
