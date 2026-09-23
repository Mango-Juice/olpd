import { EARLY_CONTACT_HINTS } from './early-copy';
import { LATE_CONTACT_HINTS } from './late-copy';
import type { DiscoveryHint } from '../../game/hints/discovery';

/** Contact with a named body, or an actual failed interaction after approaching it. */
export const CONTACT_HINTS: Readonly<Record<string, DiscoveryHint>> = { ...EARLY_CONTACT_HINTS, ...LATE_CONTACT_HINTS };

/** Stage-local observations prompted by an actual fall; no object contact is invented. */
export const FALL_HINTS: Readonly<Record<string, DiscoveryHint & { when?: { entity: string; property: string; value: boolean } }>> = {
  '02-v2-3': { key: 'plank-spans', text: '틈 양쪽에 무언가 걸칠 만한 돌턱이 있네.' },
  '03-v2-5': { key: 'moving-platform', text: '쟁반이 턱에 가까워질 때 발을 옮겨야겠어.' },
  '03-v2-6': { key: 'moving-platform', text: '쟁반이 턱에 가까워질 때 발을 옮겨야겠어.' },
  '08-v2-6': { key: 'boat-boarding', text: '배에 올라타면 물길을 건널 수 있겠어.' },
  '09-v2-1': { key: 'stairs-support', when: { entity: 'stairs', property: 'stable', value: false }, text: '기울어진 계단 아래에 받쳐 줄 자리가 보이네.' },
  '09-v2-5': { key: 'bridge-held', when: { entity: 'bridge', property: 'down', value: false }, text: '다리가 내려와 있어야 발을 디딜 수 있겠어.' },
};

/** Only emitted for typed failures recorded by the engine, never by matching Korean error text. */
export const INTERACTION_HINTS: Readonly<Record<string, DiscoveryHint>> = {
  '07-v2-5/07-v2-5-bench/needs-partner': { key: 'carry-together', text: '긴 의자는 양쪽을 함께 잡아야 들 수 있겠어.' },
  '10-v2-5/latch/out-of-reach': { key: 'lower-latch', text: '걸쇠가 너무 높네. 아래로 내려오게 할 수 있을까?' },
};
