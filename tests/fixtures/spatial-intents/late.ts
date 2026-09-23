import type { PhysicalAction, ProgramNode } from '../../../src/campaign/types';
import type { SpatialIntentCase } from './types';
const A = (actor: 'hero' | 'keeper', verb: PhysicalAction['verb'], target: string, destination?: string): PhysicalAction => ({ kind: 'action', actor, verb, target, ...(destination ? { destination } : {}) });
const S = (...children: ProgramNode[]): ProgramNode => ({ kind: 'sequence', children });
const P = (...children: ProgramNode[]): ProgramNode => ({ kind: 'parallel', children });
const W = (entity: string, propertyName: string, value: string | number | boolean): ProgramNode => ({ kind: 'wait', until: { kind: 'property', entity, property: propertyName, comparison: 'eq', value, source: 'visible' } });

export const SPATIAL_LATE_CASES: SpatialIntentCase[] = [
  { stageId: 8, segmentId: '08-v2-1', text: '드러난 돌을 따라 굽은 돌다리를 건너자', body: A('hero', 'move', 'bridge') },
  { stageId: 8, segmentId: '08-v2-2', text: '이어진 오른쪽 다리로 섬에 가자', body: A('hero', 'move', 'rightBridge') },
  { stageId: 8, segmentId: '08-v2-3', text: '깃발이 처지면 바람길을 건너자', body: S(W('flag', 'phase', 'drooped'), A('hero', 'move', 'exit')) },
  { stageId: 8, segmentId: '08-v2-4', text: '등불을 들고 계단을 따라 올라가자', body: S(A('hero', 'take', 'lantern'), A('hero', 'move', 'stairs')) },
  { stageId: 8, segmentId: '08-v2-5', text: '삼각 다리를 따라 출구로 가자', body: A('hero', 'move', 'triangle') },
  { stageId: 8, segmentId: '08-v2-6', text: '배가 닿을 때 타고 부두로 가자', body: S(A('hero', 'board', 'boat'), W('boat', 'docked', true), A('hero', 'move', 'dock')) },
  { stageId: 9, segmentId: '09-v2-1', text: '쐐기를 계단 홈에 밀어 끼우고 올라가자', body: S(A('hero', 'push', 'wedge', 'stairs'), A('hero', 'move', 'upper')) },
  { stageId: 9, segmentId: '09-v2-2', text: '종추가 멀어지면 그 틈을 지나자', body: S(W('bell', 'phase', 'far'), A('hero', 'move', 'exit')) },
  { stageId: 9, segmentId: '09-v2-3', text: '바람판을 승강대 풍로로 돌리고 타자', body: S(A('hero', 'turn', 'panel', 'lift'), A('hero', 'board', 'lift'), W('lift', 'arrived', true), A('hero', 'move', 'upper')) },
  { stageId: 9, segmentId: '09-v2-4', text: '등불을 들고 꺾인 계단으로 가자', body: S(A('hero', 'take', 'lantern'), A('hero', 'move', 'stairs')) },
  { stageId: 9, segmentId: '09-v2-5', text: '등지기가 손잡이를 잡는 동안 건너가 고정하고 함께 가자',
    body: S(P(A('keeper', 'hold', 'handle'), A('hero', 'move', 'ratchet')), A('keeper', 'release', 'handle'), A('keeper', 'move', 'meeting'), A('hero', 'move', 'meeting')) },
  { stageId: 9, segmentId: '09-v2-6', text: '종이 멀어진 사이 둘이 홈을 거쳐 문으로 가자',
    body: S(W('bell', 'phase', 'far'), P(A('hero', 'move', 'alcove'), A('keeper', 'move', 'alcove')),
      P(A('hero', 'move', 'door'), A('keeper', 'move', 'door'))) },
  { stageId: 10, segmentId: '10-v2-1', text: '팔이 비키면 둘이 홈을 거쳐 발판으로 가자',
    body: S(W('arm', 'phase', 'far'), P(A('hero', 'move', 'alcove'), A('keeper', 'move', 'alcove')),
      P(A('hero', 'move', 'platform'), A('keeper', 'move', 'platform'))) },
  { stageId: 10, segmentId: '10-v2-2', text: '걸쇠를 빼 갑옷판을 내리고 함께 건너자',
    body: S(A('hero', 'pull', 'latch'), P(A('hero', 'move', 'platform'), A('keeper', 'move', 'platform'))) },
  { stageId: 10, segmentId: '10-v2-3', text: '바람판을 갑옷길 쪽으로 돌리고 둘이 지나자',
    body: S(A('hero', 'turn', 'panel', 'path'), P(A('hero', 'move', 'platform'), A('keeper', 'move', 'platform'))) },
  { stageId: 10, segmentId: '10-v2-4', text: '바람을 날개 경첩으로 보내 접은 뒤 함께 올라가자',
    body: S(A('hero', 'turn', 'panel', 'wing'), P(A('hero', 'move', 'platform'), A('keeper', 'move', 'platform'))) },
  { stageId: 10, segmentId: '10-v2-5', text: '등지기가 고리를 잡는 동안 걸쇠를 풀자',
    body: P(A('keeper', 'hold', 'ring'), A('hero', 'pull', 'latch')) },
  { stageId: 10, segmentId: '10-v2-6', text: '등지기가 바깥 손잡이를 잡고 내가 안쪽으로 가서 받아 잡은 뒤 함께 나가자',
    body: S(P(A('keeper', 'hold', 'outer'), A('hero', 'move', 'inner')), A('hero', 'hold', 'inner'),
      A('keeper', 'release', 'outer'), A('keeper', 'move', 'exit'), A('hero', 'release', 'inner'), A('hero', 'move', 'exit')) },
];
