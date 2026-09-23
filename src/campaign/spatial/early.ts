import type { CampaignStageDefinition } from '../level';
import type { Entity, Scalar } from '../types';
import { authoredEntity, all, atPosition, not, property } from './authored';
import { createSpatialStage } from './engine';
import type { SpatialBody, SpatialChapterDefinition, SpatialCondition, SpatialInteraction, SpatialSceneDefinition, SpatialSurface } from './types';

const floor = (from = 0, to = 10, y = 0): SpatialSurface => ({ from, to, y, z: 0, depth: 1.2 });
const id = (chapter: number, room: number, object: string) => `${String(chapter).padStart(2, '0')}-v2-${room}-${object}`;
const entity = (chapter: number, room: number, object: string, name: string, x: number, y: number, kind: string, props: Record<string, Scalar> = {}, patch: Partial<Entity> = {}) => {
  const region = id(chapter, room, '');
  return authoredEntity(id(chapter, room, object), name, region.slice(0, -1), x, y, { kind, ...props }, patch);
};
const body = (entityId: string, width: number, height: number, kind: SpatialBody['kind'], extra: Partial<SpatialBody> = {}): SpatialBody => ({ entity: entityId, width, height, kind, ...extra });
const movable = (entityId: string, x: number, y = 0): SpatialInteraction => ({ kind: 'movable', entity: entityId, pushTo: { x, y } });
const control = (entityId: string, key: string, value: Scalar, offValue?: Scalar): SpatialInteraction => ({ kind: 'control', entity: entityId, property: key, value, ...(offValue === undefined ? {} : { offValue }) });
const at = (entityId: string, x: number, y = 0, distance = .55): SpatialCondition => atPosition(entityId, x, y, distance);
const carrying = (entityId: string): SpatialCondition => ({ kind: 'carrying', actor: 'hero', entity: entityId });
const scene = (chapter: number, room: number, title: string, goal: string, entities: Entity[], surfaces: SpatialSurface[], bodies: SpatialBody[], goals: SpatialCondition[], rest: Partial<SpatialSceneDefinition> = {}): SpatialSceneDefinition => ({
  id: id(chapter, room, '').slice(0, -1), title, goal, entities, surfaces, bodies, goals,
  hero: { location: { region: id(chapter, room, '').slice(0, -1), x: .8, y: 0 } },
  defaultTarget: id(chapter, room, room === 2 && chapter === 3 ? 'bread' : 'exit'),
  ...rest,
});

const rain: SpatialChapterDefinition = {
  id: 2, title: '비에 잠긴 회랑', objective: '편지를 젖지 않게 지키며 회랑을 건너야 해요.',
  story: { afterSegment: '02-v2-6', object: id(2, 6, 'exit'), text: '회랑 끝의 낮은 우비 걸이 두 개. “왼쪽 고리는 늘 비워 뒀던 것 같은데.”' },
  scenes: [
    scene(2, 1, '막힌 빗길', '편지와 함께 회랑을 건너야 해요.', [
      entity(2,1,'box','짐상자',3.5,0,'crate',{}, { material: 'wood', movable: true, weight: 2, reach:2 }),
      entity(2,1,'exit','출구',9,0,'exit'),
    ], [{...floor(),depth:2}, {from:2.5,to:4.5,y:0,z:1.4,depth:1.5}], [body(id(2,1,'box'),1.25,1.1,'solid',{support:true,depth:.8})], [at('hero',9)], {
      ceiling: 1.25, interactions: [{kind:'movable',entity:id(2,1,'box'),pushTo:{x:3.5,y:0,z:1.4}}],
      hints: ['상자 옆의 마른 빈자리가 보여요.', '상자가 길의 폭을 막고 있어요.', '상자를 뒤쪽 빈자리로 밀어 길을 열어 보세요.'],
    }),
    scene(2, 2, '높은 창', '높은 창가에 올라가야 해요.', [
      entity(2,2,'box','나무상자',2,0,'crate',{}, { material:'wood', movable:true, weight:2 }),
      entity(2,2,'window','높은 창',8,2.35,'exit'),
    ], [floor(0,8), floor(8,10,2.35)], [body(id(2,2,'box'),1.1,1.2,'solid',{support:true}), body(id(2,2,'window'),.25,2.35,'solid',{offsetX:.5,offsetY:-2.35})], [at('hero',8,2.35,.8)], {
      defaultTarget: id(2,2,'window'), interactions: [movable(id(2,2,'box'),7.15)],
      hints: ['창 아래에는 상자만 한 마른 자국이 있어요.', '맨바닥에서는 창턱에 손이 닿지 않아요.', '상자를 창 아래 두고 발판으로 삼아 보세요.'],
    }),
    scene(2, 3, '끊긴 바닥', '편지와 함께 건너편으로 가야 해요.', [
      entity(2,3,'plank','긴 널빤지',1.8,0,'plank',{}, { material:'wood', movable:true, weight:2 }),
      entity(2,3,'gap','깊은 바닥 틈',4.9,-.3,'gap'),
      entity(2,3,'bank','건너편 돌턱',8.7,0,'exit'),
    ], [floor(0,3.25),floor(6.55,10),{from:3.25,to:6.55,y:.16,enabled:at(id(2,3,'plank'),4.9)}], [body(id(2,3,'plank'),3.9,.16,'solid',{support:true})], [at('hero',8.7)], {
      defaultTarget:id(2,3,'bank'), interactions:[{kind:'movable',entity:id(2,3,'plank'),pushTo:{x:4.9,y:0},placements:{[id(2,3,'gap')]:{x:4.9,y:0}}}],
      hints:['두 돌턱에 밝은 받침면이 있어요.','널빤지는 틈보다 길어요.','양 끝이 돌턱에 닿도록 널빤지를 놓아 보세요.'],
    }),
    scene(2, 4, '떠 있는 발판', '편지와 함께 물 건너로 가야 해요.', [
      entity(2,4,'cork','코르크 발판',5.2,0,'platform',{}, {material:'cork'}),
      entity(2,4,'pool','깊은 물길',5.2,-.1,'water',{}, {material:'water'}),
      entity(2,4,'bank','건너편 돌턱',8.7,0,'exit'),
    ], [floor(0,3),floor(7.4,10)], [body(id(2,4,'cork'),1.5,.15,'solid',{support:true}),body(id(2,4,'pool'),4.2,.18,'water')], [at('hero',8.7)], {
      defaultTarget:id(2,4,'bank'), hero:{location:{region:'02-v2-4',x:2.8,y:0}},
      hints:['발판이 가까운 턱과 먼 턱 사이를 흔들려요.','한 번에 건너뛰기에는 물길이 길어요.','가까워졌을 때 딛고 반대편에서 내려 보세요.'],
    }),
    scene(2, 5, '잠긴 아래 계단', '아래 계단으로 내려가야 해요.', [
      entity(2,5,'drain','배수 덮개',2.2,0,'handle',{open:false}, {material:'metal'}),
      entity(2,5,'pool','고인 물',6,0,'water',{drained:false}, {material:'water'}),
      entity(2,5,'stairs','아래 계단',8.6,-1,'exit'),
    ], [floor(0,5.2),{from:5.2,to:8.6,y:0,endY:-1,enabled:property(id(2,5,'pool'),'drained',true)},floor(8.6,10,-1)], [body(id(2,5,'pool'),3.4,1.1,'water',{active:not(property(id(2,5,'pool'),'drained',true))})], [at('hero',8.6,-1,.8)], {
      defaultTarget:id(2,5,'stairs'), interactions:[{kind:'handle',entity:id(2,5,'drain')}],
      rules:[{when:property(id(2,5,'drain'),'open',true),effects:[{entity:id(2,5,'pool'),property:'drained',value:true,otherwise:false}]}],
      hints:['배수 덮개 손잡이는 물 밖에 있어요.','물 아래에 계단이 이어져 있어요.','먼저 덮개를 열어 물을 빼 보세요.'],
    }),
    scene(2, 6, '처진 다리', '편지와 함께 회랑을 나가야 해요.', [
      entity(2,6,'box','받침 상자',1.9,0,'crate',{}, {material:'wood',movable:true,weight:2}),
      entity(2,6,'bridge','처진 목교',5,1,'bridge',{supported:false}, {material:'wood'}),
      entity(2,6,'entrance','다리 시작 턱',2,0,'path'),
      entity(2,6,'exit','출구',9,1.2,'exit'),
    ], [floor(0,5.6),{from:2.2,to:3.1,y:0,endY:1.2,enabled:property(id(2,6,'bridge'),'supported',true)},floor(7.1,10,1.2),{from:3.1,to:7.1,y:1.2,enabled:property(id(2,6,'bridge'),'supported',true)}], [body(id(2,6,'box'),1.05,1,'solid',{support:true}),body(id(2,6,'bridge'),3.6,.2,'solid',{offsetX:.2,support:true,active:property(id(2,6,'bridge'),'supported',true)})], [at('hero',9,1.2)], {
      defaultTarget:id(2,6,'exit'), interactions:[movable(id(2,6,'box'),5)],
      rules:[{when:at(id(2,6,'box'),5),effects:[{entity:id(2,6,'bridge'),property:'supported',value:true,otherwise:false}]}],
      hints:['다리 중앙 아래에 빈 받침 자국이 있어요.','상자의 높이가 다리 아래 공간과 비슷해요.','상자를 중앙 아래로 밀어 넣어 보세요.'],
    }),
  ],
};

const kitchen: SpatialChapterDefinition = {
  id:3,title:'태엽 부엌',objective:'멈춰 선 부엌을 지나 편지의 길을 찾아요.',
  story:{afterSegment:'03-v2-6',object:id(3,6,'exit'),text:'식탁 아래 반으로 접힌 낡은 냅킨. “누군가는 내가 천천히 먹을 때까지 늘 기다려 줬다.”'},
  scenes:[
    scene(3,1,'숨 쉬는 배출구','편지와 함께 부엌 안으로 가야 해요.',[
      entity(3,1,'steam','김 분출구',4.2,0,'vent',{active:true},{material:'metal'}),entity(3,1,'exit','출구',9,0,'exit'),
    ],[floor()],[body(id(3,1,'steam'),1.3,1.9,'steam',{active:property(id(3,1,'steam'),'active',true)})],[at('hero',9)],{
      ceiling:2.1,hero:{location:{region:'03-v2-1',x:2.7,y:0}},cycles:[{entity:id(3,1,'steam'),property:'active',values:[true,true,...Array(14).fill(false)],ticksPerValue:1}],
      hints:['관이 떨다 멎는 순간이 있어요.','분출구가 통로 전높이를 채워요.','김이 완전히 멎을 때 지나가 보세요.'],
    }),
    scene(3,2,'오븐의 박자','오븐 안의 빵을 꺼내야 해요.',[
      entity(3,2,'oven','태엽 오븐',7.8,0,'oven',{open:false},{material:'metal'}),entity(3,2,'bread','빵',8.2,.8,'object',{}, {material:'wood',movable:true,weight:.3}),
    ],[floor()],[body(id(3,2,'oven'),1.1,1.3,'solid',{active:not(property(id(3,2,'oven'),'open',true))})],[carrying(id(3,2,'bread'))],{
      hero:{location:{region:'03-v2-2',x:6.2,y:0}},cycles:[{entity:id(3,2,'oven'),property:'open',values:[false,false,...Array(12).fill(true)],ticksPerValue:1}],
      hints:['오븐 문이 일정한 간격으로 열려요.','빵은 열린 문 너머 손이 닿는 선반에 있어요.','문이 열린 동안 빵을 집어 보세요.'],
    }),
    scene(3,3,'오르내리는 집게','집게 너머로 가야 해요.',[
      entity(3,3,'claw','넓은 집게',4.7,.1,'claw',{raised:false},{material:'metal'}),entity(3,3,'exit','출구',9,0,'exit'),
    ],[floor()],[body(id(3,3,'claw'),1.5,1.9,'crush')],[at('hero',9)],{
      hero:{location:{region:'03-v2-3',x:3.1,y:0}},cycles:[{entity:id(3,3,'claw'),property:'raised',values:[false,false,...Array(12).fill(true)],locations:[{x:4.7,y:.1},{x:4.7,y:.1},...Array(12).fill({x:4.7,y:2.1})],ticksPerValue:1}],
      hints:['집게는 올라간 뒤 잠시 머물러요.','아래로 내려온 날은 바닥 가까이 닿아요.','집게가 위에 머무를 때 지나가 보세요.'],
    }),
    scene(3,4,'부푸는 디딤돌','위 선반에 올라가야 해요.',[
      entity(3,4,'dough','부푸는 반죽',5.8,0,'platform',{raised:false},{material:'cloth'}),entity(3,4,'shelf','위 선반',8,2.35,'exit'),
    ],[floor(0,8),floor(8,10,2.35)],[body(id(3,4,'dough'),1.5,.55,'solid',{support:true,active:not(property(id(3,4,'dough'),'raised',true))}),body(id(3,4,'dough'),1.5,1.2,'solid',{support:true,active:property(id(3,4,'dough'),'raised',true)})],[at('hero',8,2.35,.8)],{
      defaultTarget:id(3,4,'shelf'),hero:{location:{region:'03-v2-4',x:4.5,y:0}},cycles:[{entity:id(3,4,'dough'),property:'raised',values:[false,false,...Array(14).fill(true)],ticksPerValue:1}],
      hints:['반죽이 천천히 위로 부풀어요.','맨바닥에서는 선반 턱에 닿지 않아요.','부푼 반죽을 딛고 선반으로 올라가 보세요.'],
    }),
    scene(3,5,'다가오는 쟁반','건너편 식탁으로 가야 해요.',[
      entity(3,5,'tray','이동 쟁반',3.1,0,'platform',{position:'near'},{material:'metal'}),entity(3,5,'table','건너편 식탁',9,0,'exit'),
    ],[floor(0,3),floor(7.8,10)],[body(id(3,5,'tray'),1.6,.15,'solid',{support:true})],[at('hero',9)],{
      defaultTarget:id(3,5,'table'),hero:{location:{region:'03-v2-5',x:2.1,y:0}},interactions:[{kind:'transport',entity:id(3,5,'tray'),from:{x:3.1,y:0},to:{x:7.7,y:0},period:10}],
      hints:['쟁반이 양쪽 턱 앞에서 잠깐 멈춰요.','구덩이는 한 번에 넘기엔 길어요.','가까이 온 쟁반에 타고 반대편에서 내려 보세요.'],
    }),
    scene(3,6,'김 사이의 배달','편지와 함께 부엌을 나가야 해요.',[
      entity(3,6,'steam','김 분출구',2.05,0,'vent',{active:true},{material:'metal'}),entity(3,6,'tray','이동 쟁반',3.5,0,'platform',{position:'near'},{material:'metal'}),entity(3,6,'exit','출구',9,0,'exit'),
      entity(3,6,'gap','태엽 구덩이',3,-.3,'gap'),
    ],[floor(0,3.3),floor(7.8,10)],[body(id(3,6,'steam'),.85,1.9,'steam',{active:property(id(3,6,'steam'),'active',true)}),body(id(3,6,'tray'),1.6,.15,'solid',{support:true})],[at('hero',9)],{
      ceiling:2.3,hero:{location:{region:'03-v2-6',x:1.1,y:0}},cycles:[{entity:id(3,6,'steam'),property:'active',values:[true,true,...Array(28).fill(false)],ticksPerValue:1}],
      interactions:[{kind:'transport',entity:id(3,6,'tray'),from:{x:3.5,y:0},to:{x:7.7,y:0},period:6}],
      hints:['김과 쟁반은 서로 다른 박자로 움직여요.','김 뒤에서 쟁반이 출발해요.','김이 멎으면 가까운 쟁반에 타고 건너가 보세요.'],
    }),
  ],
};

const forge: SpatialChapterDefinition = {
  id:4,title:'바람 대장간',objective:'바람을 빌려 대장간 위쪽으로 올라가요.',
  story:{afterSegment:'04-v2-6',object:id(4,6,'exit'),text:'풍로 옆에 겹친 작은 두 손자국. “이건 혼자 들면 자꾸 기울었는데.”'},
  scenes:[
    scene(4,1,'잠든 풍차','잠든 풍차를 깨워야 해요.',[
      entity(4,1,'vane','바람판',2,0,'control',{route:'upper'},{material:'metal'}),
      entity(4,1,'windmill','잠든 풍차',7,2.3,'windmill',{spinning:false},{material:'metal'}),
    ],[floor()],[body(id(4,1,'windmill'),1.4,1.5,'solid',{offsetY:-.75})],[property(id(4,1,'windmill'),'spinning',true)],{
      defaultTarget:id(4,1,'windmill'),interactions:[control(id(4,1,'vane'),'route','windmill','upper')],
      rules:[{when:property(id(4,1,'vane'),'route','windmill'),effects:[{entity:id(4,1,'windmill'),property:'spinning',value:true,otherwise:false}]}],
      hints:['바람판에서 두 관선이 갈라져요.','풍차 쪽 관선의 천은 움직이지 않아요.','바람판을 풍차 관선으로 맞춰 보세요.'],
    }),
    scene(4,2,'바람 승강판','위층에 올라가야 해요.',[
      entity(4,2,'vane','바람판',4.2,0,'control',{route:'upper'},{material:'metal'}),
      entity(4,2,'lift','승강판',5.8,0,'platform',{powered:false},{material:'metal'}),
      entity(4,2,'exit','위층',8.7,3,'exit'),
    ],[floor(0,8.4),floor(8.4,10,3)],[body(id(4,2,'lift'),1.5,.15,'solid',{support:true})],[at('hero',8.7,3,.7)],{
      hero:{location:{region:'04-v2-2',x:3.5,y:0}},interactions:[control(id(4,2,'vane'),'route','lift','upper'),{kind:'transport',entity:id(4,2,'lift'),from:{x:5.8,y:0},to:{x:7.9,y:3},period:10,enabled:property(id(4,2,'lift'),'powered',true)}],
      rules:[{when:property(id(4,2,'vane'),'route','lift'),effects:[{entity:id(4,2,'lift'),property:'powered',value:true,otherwise:false}]}],
      hints:['바람판 아래 관선이 승강판 풍낭까지 이어져요.','바람이 없으면 승강판이 레일 아래에 머물러요.','바람길을 승강판에 맞추고 올라타 보세요.'],
    }),
    scene(4,3,'뜨거운 길','철판 너머로 가야 해요.',[
      entity(4,3,'fan','찬바람 송풍기',1.7,0,'control',{on:false},{material:'metal'}),
      entity(4,3,'hotplate','뜨거운 철판',5,0,'heat',{cooled:false},{material:'metal'}),
      entity(4,3,'exit','출구',9,0,'exit'),
    ],[floor()],[body(id(4,3,'hotplate'),3.4,.15,'heat',{active:not(property(id(4,3,'hotplate'),'cooled',true))})],[at('hero',9)],{
      ceiling:2,interactions:[control(id(4,3,'fan'),'on',true,false)],
      rules:[{when:property(id(4,3,'fan'),'on',true),delayTicks:3,effects:[{entity:id(4,3,'hotplate'),property:'cooled',value:true,otherwise:false}]}],
      hints:['송풍기의 천 리본은 늘어져 있어요.','철판의 붉은 빛이 길 전체를 덮어요.','송풍기를 켜고 붉은 기운이 사라질 때까지 기다려 보세요.'],
    }),
    scene(4,4,'회전날개 통로','날개 너머로 가야 해요.',[
      entity(4,4,'vane','바람판',1.7,0,'control',{route:'blades'},{material:'metal'}),
      entity(4,4,'blades','회전날개',5,0,'blades',{spinning:true},{material:'metal'}),
      entity(4,4,'exit','출구',9,0,'exit'),
    ],[floor()],[body(id(4,4,'blades'),1.4,2,'crush')],[at('hero',9)],{
      ceiling:2.2,interactions:[control(id(4,4,'vane'),'route','bypass','blades')],
      rules:[{when:property(id(4,4,'vane'),'route','bypass'),delayTicks:3,effects:[{entity:id(4,4,'blades'),property:'spinning',value:false,otherwise:true}],locations:[{entity:id(4,4,'blades'),x:5,y:2.1,otherwise:{x:5,y:0}}]}],
      hints:['우회 관선의 천은 멈춰 있어요.','날개는 통로 아래까지 훑어요.','바람을 우회시키고 날개가 완전히 멎을 때 지나가 보세요.'],
    }),
    scene(4,5,'붙잡아 둔 바람','다음 방으로 바람이 흐르게 해야 해요.',[
      entity(4,5,'door','풍로문',4.3,0,'door',{open:false,latched:false,flowing:false},{material:'metal'}),
      entity(4,5,'latch','걸쇠',5.15,0,'control',{engaged:false},{material:'metal'}),
    ],[floor()],[body(id(4,5,'door'),.5,1.8,'solid',{active:not(property(id(4,5,'door'),'open',true))})],[all(property(id(4,5,'door'),'open',true),property(id(4,5,'door'),'latched',true),property(id(4,5,'door'),'flowing',true))],{
      defaultTarget:id(4,5,'door'),interactions:[{kind:'door',entity:id(4,5,'door'),spring:true},control(id(4,5,'latch'),'engaged',true,false)],
      rules:[{when:all(property(id(4,5,'door'),'open',true),property(id(4,5,'latch'),'engaged',true)),effects:[{entity:id(4,5,'door'),property:'latched',value:true,otherwise:false},{entity:id(4,5,'door'),property:'flowing',value:true,otherwise:false}]}],
      hints:['문이 열린 자리의 벽 홈에 걸쇠가 있어요.','문을 놓으면 스프링이 되돌려요.','문을 당겨 연 자리에서 걸쇠를 맞물려 보세요.'],
    }),
    scene(4,6,'이어진 바람','편지와 함께 대장간을 나가야 해요.',[
      entity(4,6,'duct','고정 바람관',1.7,1,'vent',{flowing:true},{material:'metal'}),
      entity(4,6,'lift','승강판',5.8,0,'platform',{powered:false},{material:'metal'}),
      entity(4,6,'exit','출구',8.7,3,'exit'),
    ],[floor(0,8.4),floor(8.4,10,3)],[body(id(4,6,'lift'),1.5,.15,'solid',{support:true})],[at('hero',8.7,3,.7)],{
      hero:{location:{region:'04-v2-6',x:4.7,y:0}},
      carry:[{from:id(4,5,'door'),to:id(4,6,'duct'),properties:{flowing:'flowing'},location:false}],
      interactions:[{kind:'transport',entity:id(4,6,'lift'),from:{x:5.8,y:0},to:{x:7.9,y:3},period:10,enabled:property(id(4,6,'lift'),'powered',true)}],
      rules:[{when:property(id(4,6,'duct'),'flowing',true),effects:[{entity:id(4,6,'lift'),property:'powered',value:true,otherwise:false}]}],
      hints:['앞 방에서 이어진 관의 먼지가 이곳까지 흘러요.','바람이 승강판 아래 풍낭을 채워요.','승강판에 타서 위층 출구에서 내려 보세요.'],
    }),
  ],
};

export const SPATIAL_EARLY_STAGES: CampaignStageDefinition[] = [rain,kitchen,forge].map(createSpatialStage);
