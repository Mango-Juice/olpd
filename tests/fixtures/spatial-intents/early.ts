import type { PhysicalAction, ProgramNode, Scalar } from '../../../src/campaign/types';
import type { SpatialIntentCase } from './types';
const id = (chapter: number, room: number, object: string) => `${String(chapter).padStart(2, '0')}-v2-${room}-${object}`;
const action = (verb: PhysicalAction['verb'], target: string, destination?: string): PhysicalAction => ({ kind: 'action', actor: 'hero', verb, target, ...(destination ? { destination } : {}) });
const sequence = (...children: ProgramNode[]): ProgramNode => ({ kind: 'sequence', children });
const waitFor = (target: string, key: string, value: Scalar): ProgramNode => ({ kind: 'wait', until: { kind: 'property', entity: target, property: key, comparison: 'eq', value, source: 'visible' } });
const intent = (stageId: 2 | 3 | 4, room: number, text: string, body: ProgramNode): SpatialIntentCase => ({ stageId, segmentId: id(stageId, room, '').slice(0, -1), text, body });

export const SPATIAL_EARLY_CASES: SpatialIntentCase[] = [
  intent(2,1,'상자를 옆 홈에 밀어 넣고 나가',sequence(action('push',id(2,1,'box')),action('move',id(2,1,'exit')))),
  intent(2,2,'상자를 창 아래 밀고 딛고 올라가',sequence(action('push',id(2,2,'box')),action('climb',id(2,2,'box')),action('jump',id(2,2,'window')))),
  intent(2,3,'널빤지를 틈의 두 돌턱에 걸치고 건너',sequence(action('push',id(2,3,'plank'),id(2,3,'gap')),action('move',id(2,3,'bank')))),
  intent(2,4,'코르크 발판을 딛고 건너',sequence(action('board',id(2,4,'cork')),action('jump',id(2,4,'bank')),action('move',id(2,4,'bank')))),
  intent(2,5,'덮개를 열어 물을 빼고 내려가',sequence(action('open',id(2,5,'drain')),action('move',id(2,5,'stairs')))),
  intent(2,6,'상자로 다리 중앙을 받치고 시작 턱으로 돌아와 건너',sequence(action('push',id(2,6,'box')),action('move',id(2,6,'entrance')),action('move',id(2,6,'exit')))),
  intent(3,1,'김이 멎으면 지나가',sequence(waitFor(id(3,1,'steam'),'active',false),action('move',id(3,1,'exit')))),
  intent(3,2,'오븐이 열리면 빵을 꺼내',sequence(waitFor(id(3,2,'oven'),'open',true),action('take',id(3,2,'bread')))),
  intent(3,3,'집게가 올라가면 지나가',sequence(waitFor(id(3,3,'claw'),'raised',true),action('move',id(3,3,'exit')))),
  intent(3,4,'반죽이 부풀면 딛고 선반에 올라가',sequence(waitFor(id(3,4,'dough'),'raised',true),action('climb',id(3,4,'dough')),action('jump',id(3,4,'shelf')))),
  intent(3,5,'쟁반이 가까이 오면 타고 먼 턱에서 내려',sequence(waitFor(id(3,5,'tray'),'position','near'),action('board',id(3,5,'tray')),waitFor(id(3,5,'tray'),'position','far'),action('move',id(3,5,'table')))),
  intent(3,6,'김이 멎으면 구덩이 턱에 서서 쟁반이 가까워질 때 타고 건너',sequence(waitFor(id(3,6,'steam'),'active',false),action('move',id(3,6,'gap')),waitFor(id(3,6,'tray'),'position','near'),action('board',id(3,6,'tray')),waitFor(id(3,6,'tray'),'position','far'),action('move',id(3,6,'exit')))),
  intent(4,1,'바람판을 풍차 쪽으로 돌려',action('turn',id(4,1,'vane'))),
  intent(4,2,'바람을 승강판에 보내고 타서 올라가',sequence(action('turn',id(4,2,'vane')),action('board',id(4,2,'lift')),waitFor(id(4,2,'lift'),'position','far'),action('move',id(4,2,'exit')))),
  intent(4,3,'송풍기로 철판을 식힌 뒤 건너',sequence(action('turn',id(4,3,'fan')),waitFor(id(4,3,'hotplate'),'cooled',true),action('move',id(4,3,'exit')))),
  intent(4,4,'바람을 우회시켜 날개가 멎으면 나가',sequence(action('turn',id(4,4,'vane')),waitFor(id(4,4,'blades'),'spinning',false),action('move',id(4,4,'exit')))),
  intent(4,5,'풍로문을 당긴 채 걸쇠를 걸어',sequence(action('open',id(4,5,'door')),action('turn',id(4,5,'latch')))),
  intent(4,6,'승강판을 타고 위층에서 내려',sequence(action('board',id(4,6,'lift')),waitFor(id(4,6,'lift'),'position','far'),action('move',id(4,6,'exit')))),
];
