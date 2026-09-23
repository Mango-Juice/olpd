import type { CampaignStageDefinition } from '../level';
import { authoredEntity, all, near, not, property } from './authored';
import { createSpatialStage } from './engine';
import type { SpatialChapterDefinition, SpatialCondition, SpatialSceneDefinition } from './types';

const id = (chapter: string, room: number, object: string) => `${chapter}-v2-${room}-${object}`;
const object = (chapter: string, room: number, name: string, x: number, y: number, kind: string, extra: Record<string, string | number | boolean> = {}, movable = false) =>
  authoredEntity(id(chapter, room, kind), name, `${chapter}-v2-${room}`, x, y, { kind, ...extra }, { movable, publicKind: kind });
const exit = (chapter: string, room: number, x = 9, y = 0) => object(chapter, room, '출구', x, y, 'exit', { safe: true });
const floor = (from = 0, to = 10, y = 0, endY?: number) => ({ from, to, y, ...(endY === undefined ? {} : { endY }) });
const actorAt = (_actor: 'hero' | 'keeper', x: number, y = 0) => ({ location: { region: '', x, y } });
const touching = (actor: 'hero' | 'keeper', chapter: string, room: number, name: string, distance = 0.45): SpatialCondition => near(actor, id(chapter, room, name), distance);
const holding = (actor: 'hero' | 'keeper', entity: string): SpatialCondition => ({ kind: 'holding', actor, entity });
// A mounted object must be placed, not merely carried through the same coordinates.
const mounted = (entity: string, parent: string): SpatialCondition => ({ kind: 'parent', entity, parent });

const garden: SpatialSceneDefinition[] = [
  {
    id: '05-v2-1', title: '천장의 산책', goal: '천장 길 끝으로 가야 해요.',
    entities: [object('05', 1, '거꾸로 난 길', 4.5, 4, 'path'), exit('05', 1, 9, 4)],
    hero: { ...actorAt('hero', 1.1, 4), capabilities: ['weight:1', 'gravity:up'] },
    surfaces: [floor(0, 10, 4)], bodies: [], ceiling: 4,
    goals: [touching('hero', '05', 1, 'exit')], defaultTarget: id('05', 1, 'exit'),
  },
  {
    id: '05-v2-2', title: '천장의 가시', goal: '가시 너머로 가야 해요.',
    entities: [object('05', 2, '가시덤불', 5, 4, 'thorns', { danger: true }), exit('05', 2, 9, 4)],
    hero: { ...actorAt('hero', 1.2, 4), capabilities: ['weight:1', 'gravity:up'] },
    surfaces: [floor(0, 10, 4)], ceiling: 4,
    bodies: [{ entity: id('05', 2, 'thorns'), width: 0.85, height: 0.65, offsetY: -0.65, kind: 'spikes' }],
    goals: [touching('hero', '05', 2, 'exit')], defaultTarget: id('05', 2, 'exit'),
  },
  {
    id: '05-v2-3', title: '낮은 덩굴', goal: '덩굴 너머로 가야 해요.',
    entities: [object('05', 3, '낮은 덩굴', 5, 1.35, 'vine', { danger: true }), object('05', 3, '안전 통로', 5, 0, 'path'), exit('05', 3, 9)],
    hero: actorAt('hero', 1), surfaces: [floor()],
    bodies: [{ entity: id('05', 3, 'vine'), width: 2.15, height: 0.7, kind: 'spikes' }],
    goals: [touching('hero', '05', 3, 'exit')], defaultTarget: id('05', 3, 'exit'),
  },
  {
    id: '05-v2-4', title: '잠든 꽃', goal: '꽃밭을 지나가야 해요.',
    entities: [object('05', 4, '닫힌 꽃', 3, 0, 'closed-flower'), object('05', 4, '낮은 돌시렁', 3.15, 1.55, 'shelf'), object('05', 4, '가시꽃', 6.8, 0, 'thorn', { danger: true }), exit('05', 4, 9.2)],
    hero: actorAt('hero', 1), surfaces: [floor()],
    bodies: [
      { entity: id('05', 4, 'shelf'), width: 2.1, height: 0.6, kind: 'solid' },
      { entity: id('05', 4, 'thorn'), width: 0.75, height: 0.8, kind: 'spikes' },
    ],
    goals: [touching('hero', '05', 4, 'exit')], defaultTarget: id('05', 4, 'exit'),
  },
  {
    id: '05-v2-5', title: '중력 문턱', goal: '아치 너머의 길 끝으로 가야 해요.',
    entities: [object('05', 5, '뒤집힘 아치', 5, 2, 'arch', { gravity: 'up' }), object('05', 5, '천장 가시', 7.2, 4, 'thorns', { danger: true }), exit('05', 5, 9.2, 4)],
    hero: actorAt('hero', 1), ceiling: 4,
    surfaces: [floor(0, 4, 0), floor(4, 4.5, 0, 0.55), floor(4.5, 5, 0.55, 2), floor(5, 5.5, 2, 3.45), floor(5.5, 6, 3.45, 4), floor(6, 10, 4)],
    bodies: [
      { entity: id('05', 5, 'arch'), width: 0.2, height: 0.3, offsetX: -1, offsetY: -0.45, kind: 'solid' },
      { entity: id('05', 5, 'thorns'), width: 0.85, height: 0.65, offsetY: -0.65, kind: 'spikes' },
    ],
    interactions: [{ kind: 'gravity', entity: id('05', 5, 'arch'), gravity: 'up', destinationY: 4 }],
    goals: [touching('hero', '05', 5, 'exit')], defaultTarget: id('05', 5, 'exit'),
  },
  {
    id: '05-v2-6', title: '정원의 출구', goal: '편지와 함께 정원을 나가야 해요.',
    entities: [object('05', 6, '낮은 가시덩굴', 3.6, 1, 'vine', { danger: true }), object('05', 6, '바닥 가시', 7, 0, 'thorns', { danger: true }), exit('05', 6, 9.4)],
    hero: actorAt('hero', 1), surfaces: [floor()],
    bodies: [
      { entity: id('05', 6, 'vine'), width: 1.8, height: 0.7, offsetY: 0.35, kind: 'spikes' },
      { entity: id('05', 6, 'thorns'), width: 0.8, height: 0.8, kind: 'spikes' },
    ],
    goals: [touching('hero', '05', 6, 'exit')], defaultTarget: id('05', 6, 'exit'),
  },
];

const lamp = (room: number, x: number, y: number, parent: string | null = null) => authoredEntity('06-v2-lantern', '등불', `06-v2-${room}`, x, y, { kind: 'lantern', lit: true, lightRadius: 1.1 }, { movable: true, material: 'light', weight: 0.2, publicKind: 'lantern', parent });
const key = (room: number, x: number, y: number, parent: string | null = null) => authoredEntity('06-v2-key', '놋쇠 열쇠', `06-v2-${room}`, x, y, { kind: 'key', fits: 'square' }, { movable: true, material: 'metal', weight: 0.1, publicKind: 'key', parent });
const door = (room: number, name: string, x: number, y: number, suffix = 'door') => authoredEntity(id('06', room, suffix), name, `06-v2-${room}`, x, y, { kind: 'door', open: false, locked: true, keyShape: 'square' }, { material: 'metal', publicKind: 'door' });
const lampAtExit = (room: number): SpatialCondition => all(touching('hero', '06', room, 'exit'), near('06-v2-lantern', id('06', room, 'exit'), 0.9));
const doorBody = (room: number, suffix: string, width = 0.35, height = 4) => ({ entity: id('06', room, suffix), width, height, kind: 'solid' as const, active: not(property(id('06', room, suffix), 'open', true)) });
const storehouse: SpatialSceneDefinition[] = [
  {
    id: '06-v2-1', title: '어둠에 가져가기', goal: '벽감을 밝혀야 해요.',
    entities: [lamp(1, 2.2, 0), object('06', 1, '어두운 벽감', 8.2, 1.3, 'alcove', { illuminated: false })],
    hero: actorAt('hero', 1), surfaces: [floor(0, 3, 0), floor(3, 8.5, 0, 1.3), floor(8.5, 10, 1.3)], bodies: [],
    interactions: [{ kind: 'movable', entity: '06-v2-lantern', pushTo: { x: 8.2, y: 1.3 } }],
    rules: [{ when: near('06-v2-lantern', id('06', 1, 'alcove'), 1.1), effects: [{ entity: id('06', 1, 'alcove'), property: 'illuminated', value: true, otherwise: false }] }],
    goals: [property(id('06', 1, 'alcove'), 'illuminated', true)], defaultTarget: id('06', 1, 'alcove'),
  },
  {
    id: '06-v2-2', title: '두 손으로 오르기', goal: '위 선반에 올라가야 해요.',
    entities: [lamp(2, 2.2, 0, 'hero'), object('06', 2, '벽고리', 4.5, 1, 'hook', { accepts: 'lantern' }), object('06', 2, '사다리', 5.3, 0, 'ladder'), object('06', 2, '위 선반', 5.8, 2, 'shelf')],
    hero: { ...actorAt('hero', 2.2), carrying: ['06-v2-lantern'] },
    surfaces: [floor(0, 5.5, 0), floor(5.7, 10, 2)], bodies: [],
    interactions: [
      { kind: 'movable', entity: '06-v2-lantern', placements: { [id('06', 2, 'hook')]: { x: 4.5, y: 1 } } },
      { kind: 'ladder', entity: id('06', 2, 'ladder'), destination: id('06', 2, 'shelf'), freeHands: true },
    ],
    goals: [touching('hero', '06', 2, 'shelf'), mounted('06-v2-lantern', id('06', 2, 'hook'))], defaultTarget: id('06', 2, 'shelf'),
  },
  {
    id: '06-v2-3', title: '두고 가지 않기', goal: '등불과 함께 다음 방으로 가야 해요.',
    entities: [lamp(3, 4.5, 1), authoredEntity(id('06', 2, 'hook'), '벽고리', '06-v2-3', 4.5, 1, { kind: 'hook', accepts: 'lantern' }, { publicKind: 'hook' }), object('06', 3, '선반 받침', 4.8, 2, 'shelf'), exit('06', 3, 9.1, 2)],
    hero: actorAt('hero', 7.5, 2), surfaces: [floor(0, 10, 2)], bodies: [],
    interactions: [{ kind: 'movable', entity: '06-v2-lantern' }], carry: [{ from: '06-v2-lantern', to: '06-v2-lantern', location: true }],
    goals: [lampAtExit(3)], defaultTarget: id('06', 3, 'exit'),
  },
  {
    id: '06-v2-4', title: '빌리는 열쇠', goal: '열쇠를 가지고 문 너머로 가야 해요.',
    entities: [key(4, 2.5, 0.5), door(4, '자물쇠문', 5.3, 0), exit('06', 4, 9)],
    hero: actorAt('hero', 1), surfaces: [floor()], bodies: [doorBody(4, 'door')], ceiling: 4,
    interactions: [{ kind: 'movable', entity: '06-v2-key' }, { kind: 'door', entity: id('06', 4, 'door'), key: '06-v2-key' }],
    goals: [touching('hero', '06', 4, 'exit'), property(id('06', 4, 'door'), 'open', true), near('06-v2-key', id('06', 4, 'exit'), 0.8)], defaultTarget: id('06', 4, 'exit'),
  },
  {
    id: '06-v2-5', title: '같은 열쇠', goal: '두 문 너머로 가야 해요.',
    entities: [key(5, 1, 0, 'hero'), door(5, '아래문', 3.7, 0.4, 'lower-door'), door(5, '위문', 7, 1.3, 'upper-door'), exit('06', 5, 9.3, 2)],
    hero: { ...actorAt('hero', 1), carrying: ['06-v2-key'] },
    surfaces: [floor(0, 2.5, 0), floor(2.5, 9, 0, 2), floor(9, 10, 2)], ceiling: 4,
    bodies: [doorBody(5, 'lower-door', 0.4, 3.6), doorBody(5, 'upper-door', 0.4, 2.7)],
    interactions: [{ kind: 'movable', entity: '06-v2-key' }, { kind: 'door', entity: id('06', 5, 'lower-door'), key: '06-v2-key' }, { kind: 'door', entity: id('06', 5, 'upper-door'), key: '06-v2-key' }],
    goals: [touching('hero', '06', 5, 'exit'), property(id('06', 5, 'lower-door'), 'open', true), property(id('06', 5, 'upper-door'), 'open', true)], defaultTarget: id('06', 5, 'exit'),
  },
  {
    id: '06-v2-6', title: '불빛을 챙겨서', goal: '등불과 함께 보관소를 나가야 해요.',
    entities: [lamp(6, 2.1, 0), key(6, 4.1, 0.5), door(6, '자물쇠문', 6.1, 0), exit('06', 6, 9.3)],
    hero: actorAt('hero', 1), surfaces: [floor()], bodies: [doorBody(6, 'door')], ceiling: 4,
    interactions: [
      { kind: 'movable', entity: '06-v2-lantern', placements: { [id('06', 6, 'door')]: { x: 5.6, y: 0 } } },
      { kind: 'movable', entity: '06-v2-key' }, { kind: 'door', entity: id('06', 6, 'door'), key: '06-v2-key' },
    ],
    goals: [lampAtExit(6), property(id('06', 6, 'door'), 'open', true)], defaultTarget: id('06', 6, 'exit'),
  },
];

const curtain = (room: number, x: number) => object('07', room, '무대막', x, 0, 'curtain', { open: false, raised: false });
const handle = (room: number, x: number, y = 0, name = 'handle', held = false) => object('07', room, '당김 손잡이', x, y, name, { held, ...(held ? { heldBy: 'keeper' } : {}) });
const curtainBody = (room: number, height = 4) => ({ entity: id('07', room, 'curtain'), width: 0.4, height, kind: 'solid' as const, active: not(property(id('07', room, 'curtain'), 'open', true)), kinematic: true });
const opensWhileHeld = (room: number, holder: 'hero' | 'keeper', handleName = 'handle') => ({
  when: holding(holder, id('07', room, handleName)), effects: [{ entity: id('07', room, 'curtain'), property: 'open', value: true, otherwise: false }, { entity: id('07', room, 'curtain'), property: 'raised', value: true, otherwise: false }],
});
const theatre: SpatialSceneDefinition[] = [
  {
    id: '07-v2-1', title: '첫 동행', goal: '등지기와 만나야 해요.',
    entities: [object('07', 1, '등지기 레일', 3.5, 0, 'rail'), object('07', 1, '용사 무대', 8.5, 0, 'stage'), object('07', 1, '합류 자리', 7, 0, 'meeting')],
    hero: actorAt('hero', 8.5), keeper: actorAt('keeper', 1.5), surfaces: [floor()],
    bodies: [{ entity: id('07', 1, 'rail'), width: 0.45, height: 3.45, offsetX: 2.1, offsetY: 0.55, kind: 'solid' }],
    goals: [touching('hero', '07', 1, 'meeting', 0.7), touching('keeper', '07', 1, 'meeting', 0.7)], defaultTarget: id('07', 1, 'meeting'),
  },
  {
    id: '07-v2-2', title: '잡고 있기', goal: '등지기가 무대막을 들어 줘야 해요.',
    entities: [object('07', 2, '등지기 전용 레일', 2.5, 0, 'rail'), handle(2, 3.2), curtain(2, 6.2), object('07', 2, '통과 자리', 7.8, 0, 'passage')],
    hero: actorAt('hero', 5), keeper: actorAt('keeper', 1.5), surfaces: [floor()],
    bodies: [curtainBody(2), { entity: id('07', 2, 'rail'), width: 0.45, height: 3.45, offsetX: 1.7, offsetY: 0.55, kind: 'solid' }], ceiling: 4,
    interactions: [{ kind: 'handle', entity: id('07', 2, 'handle') }], rules: [opensWhileHeld(2, 'keeper')],
    goals: [property(id('07', 2, 'curtain'), 'open', true), holding('keeper', id('07', 2, 'handle'))], defaultTarget: id('07', 2, 'passage'),
  },
  {
    id: '07-v2-3', title: '내가 지나간 뒤', goal: '용사도 건너가고, 등지기도 자유로워져야 해요.',
    entities: [handle(3, 2.5, 0, 'handle', true), curtain(3, 5.2), object('07', 3, '도착 자리', 8.4, 0, 'arrival')],
    hero: actorAt('hero', 4), keeper: { ...actorAt('keeper', 2.5), holding: id('07', 3, 'handle') },
    surfaces: [floor()], bodies: [curtainBody(3)], ceiling: 4,
    interactions: [{ kind: 'handle', entity: id('07', 3, 'handle') }], rules: [opensWhileHeld(3, 'keeper')],
    goals: [touching('hero', '07', 3, 'arrival'), not(holding('keeper', id('07', 3, 'handle')))], defaultTarget: id('07', 3, 'arrival'),
  },
  {
    id: '07-v2-4', title: '역할 바꾸기', goal: '이번엔 등지기를 막 너머로 보내야 해요.',
    entities: [handle(4, 2.5), curtain(4, 5.7), object('07', 4, '등지기 레일', 6, 0, 'rail'), object('07', 4, '도착 자리', 8.5, 0, 'arrival')],
    hero: actorAt('hero', 2.2), keeper: actorAt('keeper', 4), surfaces: [floor()],
    bodies: [curtainBody(4), { entity: id('07', 4, 'rail'), width: 0.45, height: 3.45, offsetX: 0.8, offsetY: 0.55, kind: 'solid' }], ceiling: 4,
    interactions: [{ kind: 'handle', entity: id('07', 4, 'handle') }], rules: [opensWhileHeld(4, 'hero')],
    goals: [touching('keeper', '07', 4, 'arrival'), holding('hero', id('07', 4, 'handle'))], defaultTarget: id('07', 4, 'arrival'),
  },
  {
    id: '07-v2-5', title: '함께 나르기', goal: '함께 건너편으로 가야 해요.',
    entities: [object('07', 5, '긴 의자', 3, 0.2, 'bench', { bridge: true }, true), object('07', 5, '넓은 틈', 5.8, 0, 'gap'), object('07', 5, '건너편 무대', 8.6, 0, 'bank')],
    hero: actorAt('hero', 4.2), keeper: actorAt('keeper', 1.8),
    surfaces: [floor(0, 4.4), floor(7.2, 7.75), floor(7.75, 8.2, 0.42, 0), floor(8.2, 10), { from: 4.4, to: 7.75, y: 0.42, enabled: mounted(id('07', 5, 'bench'), id('07', 5, 'gap')) }],
    bodies: [{ entity: id('07', 5, 'bench'), width: 3.3, height: 0.22, kind: 'solid', support: true, active: mounted(id('07', 5, 'bench'), id('07', 5, 'gap')) }],
    interactions: [{ kind: 'movable', entity: id('07', 5, 'bench'), placements: { [id('07', 5, 'gap')]: { x: 5.8, y: 0.2 } }, joint: true }],
    goals: [mounted(id('07', 5, 'bench'), id('07', 5, 'gap')), touching('hero', '07', 5, 'bank'), touching('keeper', '07', 5, 'bank')], defaultTarget: id('07', 5, 'bank'),
  },
  {
    id: '07-v2-6', title: '둘이 도착하기', goal: '등지기와 함께 극장을 나가야 해요.',
    entities: [curtain(6, 5.5), handle(6, 2.4, 0, 'rope', true), object('07', 6, '황동 평형추', 3.6, 0, 'weight', { heavy: true }, true), exit('07', 6, 9.2)],
    hero: actorAt('hero', 3.2), keeper: { ...actorAt('keeper', 2.4), holding: id('07', 6, 'rope') },
    surfaces: [floor()], bodies: [curtainBody(6)], ceiling: 4,
    interactions: [
      { kind: 'handle', entity: id('07', 6, 'rope') },
      { kind: 'movable', entity: id('07', 6, 'weight'), placements: { [id('07', 6, 'rope')]: { x: 2.4, y: 0.7 } } },
    ],
    rules: [{ when: { kind: 'any', conditions: [holding('keeper', id('07', 6, 'rope')), mounted(id('07', 6, 'weight'), id('07', 6, 'rope'))] }, effects: [{ entity: id('07', 6, 'curtain'), property: 'open', value: true, otherwise: false }, { entity: id('07', 6, 'curtain'), property: 'raised', value: true, otherwise: false }] }],
    goals: [mounted(id('07', 6, 'weight'), id('07', 6, 'rope')), not(holding('keeper', id('07', 6, 'rope'))), touching('hero', '07', 6, 'exit'), touching('keeper', '07', 6, 'exit')], defaultTarget: id('07', 6, 'exit'),
  },
];

export const SPATIAL_MIDDLE_DEFINITIONS: readonly SpatialChapterDefinition[] = [
  { id: 5, title: '뒤집힌 정원', objective: '익숙한 행동에 짧은 예외', scenes: garden, story: { afterSegment: '05-v2-6', object: '동행 자리의 벽화', text: '화분은 거꾸로 자라도, 곁에 있던 자리는 그대로다.' } },
  { id: 6, title: '등불 보관소', objective: '놓고 다시 챙긴다', scenes: storehouse, story: { afterSegment: '06-v2-6', object: '두 사람 몫의 낡은 찻잔', text: '하나는 늘 돌아올 사람 몫으로 비워 두었다.' } },
  { id: 7, title: '평형 인형극장', objective: '등지기와 한 역할씩', scenes: theatre, story: { afterSegment: '07-v2-6', object: '두 인형의 그림자극', text: '한 손이 막을 들면, 다른 손은 길을 건넜다.' } },
];
export const SPATIAL_MIDDLE_STAGES: readonly CampaignStageDefinition[] = SPATIAL_MIDDLE_DEFINITIONS.map(createSpatialStage);
