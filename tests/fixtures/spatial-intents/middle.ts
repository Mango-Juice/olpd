import type { PhysicalAction, ProgramNode } from '../../../src/campaign/types';
import type { SpatialIntentCase } from './types';
const id = (chapter: string, room: number, object: string) => `${chapter}-v2-${room}-${object}`;
const act = (actor: 'hero' | 'keeper', verb: PhysicalAction['verb'], target: string, destination?: string): PhysicalAction => ({ kind: 'action', actor, verb, target, ...(destination ? { destination } : {}) });
const seq = (...children: ProgramNode[]): ProgramNode => ({ kind: 'sequence', children });
const parallel = (...children: ProgramNode[]): ProgramNode => ({ kind: 'parallel', children });

export const SPATIAL_MIDDLE_CASES: readonly SpatialIntentCase[] = [
  { stageId: 5, segmentId: '05-v2-1', text: '천장길 끝의 출구까지 걸어가', body: act('hero', 'move', id('05', 1, 'exit')) },
  { stageId: 5, segmentId: '05-v2-2', text: '가시를 뛰어넘고 출구로 가', body: seq(act('hero', 'jump', id('05', 2, 'exit')), act('hero', 'move', id('05', 2, 'exit'))) },
  { stageId: 5, segmentId: '05-v2-3', text: '덩굴 아래를 걷고 출구로 가', body: act('hero', 'move', id('05', 3, 'exit')) },
  { stageId: 5, segmentId: '05-v2-4', text: '닫힌 꽃 아래는 걷고 가시꽃만 뛰어넘어', body: seq(act('hero', 'move', id('05', 4, 'closed-flower')), act('hero', 'jump', id('05', 4, 'exit')), act('hero', 'move', id('05', 4, 'exit'))) },
  { stageId: 5, segmentId: '05-v2-5', text: '아치를 걸어 넘어 천장 가시는 점프로 지나가', body: seq(act('hero', 'move', id('05', 5, 'arch')), act('hero', 'jump', id('05', 5, 'exit')), act('hero', 'move', id('05', 5, 'exit'))) },
  { stageId: 5, segmentId: '05-v2-6', text: '덩굴 아래는 걷고 바닥 가시 앞에서 뛰어', body: seq(act('hero', 'move', id('05', 6, 'vine')), act('hero', 'jump', id('05', 6, 'exit')), act('hero', 'move', id('05', 6, 'exit'))) },
  { stageId: 6, segmentId: '06-v2-1', text: '등불을 가져가 벽감을 밝혀', body: seq(act('hero', 'take', '06-v2-lantern'), act('hero', 'move', id('06', 1, 'alcove'))) },
  { stageId: 6, segmentId: '06-v2-2', text: '등불을 벽고리에 걸고 사다리로 올라가', body: seq(act('hero', 'move', id('06', 2, 'hook')), act('hero', 'place', '06-v2-lantern', id('06', 2, 'hook')), act('hero', 'climb', id('06', 2, 'ladder'))) },
  { stageId: 6, segmentId: '06-v2-3', text: '고리에 둔 등불을 챙겨 출구로 가', body: seq(act('hero', 'take', '06-v2-lantern'), act('hero', 'move', id('06', 3, 'exit'))) },
  { stageId: 6, segmentId: '06-v2-4', text: '열쇠를 꽂아 문을 열고 다시 챙겨 나가', body: seq(act('hero', 'take', '06-v2-key'), act('hero', 'open', id('06', 4, 'door')), act('hero', 'take', '06-v2-key'), act('hero', 'move', id('06', 4, 'exit'))) },
  { stageId: 6, segmentId: '06-v2-5', text: '열쇠로 첫 문을 열고 다시 빼서 다음 문도 열어', body: seq(act('hero', 'open', id('06', 5, 'lower-door')), act('hero', 'take', '06-v2-key'), act('hero', 'open', id('06', 5, 'upper-door')), act('hero', 'move', id('06', 5, 'exit'))) },
  { stageId: 6, segmentId: '06-v2-6', text: '등불을 챙기고 열쇠로 문을 연 다음 함께 나가', body: seq(act('hero', 'take', '06-v2-lantern'), act('hero', 'take', '06-v2-key'), act('hero', 'open', id('06', 6, 'door')), act('hero', 'move', id('06', 6, 'exit'))) },
  { stageId: 7, segmentId: '07-v2-1', text: '등지기가 합류 자리로 오게 해', body: seq(act('hero', 'move', id('07', 1, 'meeting')), act('keeper', 'move', id('07', 1, 'meeting'))) },
  { stageId: 7, segmentId: '07-v2-2', text: '등지기가 손잡이를 계속 잡아 막을 올려', body: act('keeper', 'hold', id('07', 2, 'handle')) },
  { stageId: 7, segmentId: '07-v2-3', text: '내가 도착 자리에 간 뒤 등지기는 손을 놓아', body: seq(act('hero', 'move', id('07', 3, 'arrival')), act('keeper', 'release', id('07', 3, 'handle'))) },
  { stageId: 7, segmentId: '07-v2-4', text: '이번에는 내가 손잡이를 잡고 등지기가 지나가', body: seq(act('hero', 'hold', id('07', 4, 'handle')), act('keeper', 'move', id('07', 4, 'arrival'))) },
  { stageId: 7, segmentId: '07-v2-5', text: '둘이 의자를 함께 틈에 놓고 올라 건너가', body: seq(parallel(act('hero', 'hold', id('07', 5, 'bench')), act('keeper', 'hold', id('07', 5, 'bench'))), act('hero', 'place', id('07', 5, 'bench'), id('07', 5, 'gap')), parallel(act('hero', 'climb', id('07', 5, 'bench')), act('keeper', 'climb', id('07', 5, 'bench'))), parallel(act('hero', 'move', id('07', 5, 'bank')), act('keeper', 'move', id('07', 5, 'bank')))) },
  { stageId: 7, segmentId: '07-v2-6', text: '평형추를 줄에 걸고 등지기가 놓으면 둘이 나가', body: seq(act('hero', 'take', id('07', 6, 'weight')), act('hero', 'place', id('07', 6, 'weight'), id('07', 6, 'rope')), act('keeper', 'release', id('07', 6, 'rope')), parallel(act('hero', 'move', id('07', 6, 'exit')), act('keeper', 'move', id('07', 6, 'exit')))) },
];
