import { describe, expect, it } from 'vitest';
import { SPATIAL_MIDDLE_DEFINITIONS, SPATIAL_MIDDLE_STAGES } from '../src/campaign/spatial/middle';
import { SPATIAL_MIDDLE_CASES } from './fixtures/spatial-intents/middle';
import type { PhysicalAction, ProgramNode, WorldState } from '../src/campaign/types';
import type { SegmentDefinition } from '../src/campaign/level';

function actions(node: ProgramNode): PhysicalAction[] {
  if (node.kind === 'action') return [node];
  if (node.kind === 'sequence' || node.kind === 'parallel') return node.children.flatMap(actions);
  throw new Error(`이 사례에 아직 실행 순서를 정의하지 않은 노드: ${node.kind}`);
}

function runAction(segment: SegmentDefinition, source: WorldState, action: PhysicalAction) {
  let world = source;
  for (let step = 0; step < 100; step++) {
    const result = segment.execute!(world, action);
    if (result.outcome === 'progress') { world = result.world; continue; }
    return result;
  }
  throw new Error(`${segment.id}: ${action.actor} ${action.verb} ${action.target} 이동이 끝나지 않음`);
}

function play(segment: SegmentDefinition, body: ProgramNode, previous: WorldState | null = null) {
  let world = segment.enter(previous);
  for (const action of actions(body)) {
    const result = runAction(segment, world, action);
    expect(result.outcome, `${segment.id}: ${action.actor} ${action.verb} ${action.target}: ${result.reason}`).toBe('done');
    world = result.world;
  }
  return world;
}

describe('5–7장 공간 저작 데이터', () => {
  it('각 장에 여섯 장면과 실제 기하, 네 개 이하의 퍼즐 오브젝트를 둔다', () => {
    expect(SPATIAL_MIDDLE_STAGES.map((stage) => stage.id)).toEqual([5, 6, 7]);
    expect(SPATIAL_MIDDLE_CASES).toHaveLength(18);
    for (const chapter of SPATIAL_MIDDLE_DEFINITIONS) {
      expect(chapter.scenes).toHaveLength(6);
      for (const scene of chapter.scenes) {
        expect(scene.entities.length, scene.id).toBeLessThanOrEqual(4);
        expect(scene.entities.length, scene.id).toBeGreaterThan(0);
        expect(scene.surfaces.length, scene.id).toBeGreaterThan(0);
        expect(scene.entities.some((entity) => entity.id === scene.defaultTarget), scene.id).toBe(true);
        expect(new Set(scene.entities.map((entity) => entity.id)).size, scene.id).toBe(scene.entities.length);
        expect(SPATIAL_MIDDLE_CASES.some((item) => item.segmentId === scene.id), scene.id).toBe(true);
      }
    }
  });

  it.each(SPATIAL_MIDDLE_CASES)('$segmentId 의도된 경로가 실제 공간에서 목적을 이룬다', (item) => {
    const stage = SPATIAL_MIDDLE_STAGES.find((stage) => stage.id === item.stageId)!;
    const segment = stage.segments.find((segment) => segment.id === item.segmentId)!;
    const world = play(segment, item.body);
    expect(segment.complete(world), `${segment.id} 완료 위치와 장치 상태`).toBe(true);
  });

  it('6-2에 실제로 걸어 둔 등불의 소유와 위치를 6-3에 넘긴다', () => {
    const stage = SPATIAL_MIDDLE_STAGES.find((item) => item.id === 6)!;
    const upper = stage.segments[1];
    const first = play(upper, SPATIAL_MIDDLE_CASES.find((item) => item.segmentId === '06-v2-2')!.body);
    const next = stage.segments[2].enter(first);
    expect(next.entities['06-v2-lantern'].parent).toBe('06-v2-2-hook');
    expect(next.entities['06-v2-lantern'].location.x).toBe(first.entities['06-v2-lantern'].location.x);
    expect(next.entities['06-v2-lantern'].location.y).toBe(first.entities['06-v2-lantern'].location.y);
  });

  it('6-1은 등불을 손에 들지 않아도 비탈 위 벽감까지 밀어 빛을 전할 수 있다', () => {
    const scene = SPATIAL_MIDDLE_STAGES[1].segments[0];
    const result = runAction(scene, scene.enter(null), { kind: 'action', actor: 'hero', verb: 'push', target: '06-v2-lantern' });
    expect(result.outcome).toBe('done');
    expect(result.world.entities['06-v2-lantern'].parent).toBeNull();
    expect(result.world.entities['06-v2-lantern'].location.y).toBeGreaterThan(1);
    expect(scene.complete(result.world)).toBe(true);
  });

  it('6-6은 열쇠를 열린 문에 남겨도 등불과 함께 나가면 완료한다', () => {
    const stage = SPATIAL_MIDDLE_STAGES.find((item) => item.id === 6)!;
    const scene = stage.segments[5];
    const world = play(scene, SPATIAL_MIDDLE_CASES.find((item) => item.segmentId === '06-v2-6')!.body);
    expect(world.entities['06-v2-key'].parent).toBe('06-v2-6-door');
    expect(scene.complete(world)).toBe(true);
  });

  it('7-6의 줄 위로 평형추를 손에 들고만 가서는 장치가 유지되지 않는다', () => {
    const stage = SPATIAL_MIDDLE_STAGES.find((item) => item.id === 7)!;
    const scene = stage.segments[5];
    let world = scene.enter(null);
    world = runAction(scene, world, { kind: 'action', actor: 'hero', verb: 'take', target: '07-v2-6-weight' }).world;
    world = runAction(scene, world, { kind: 'action', actor: 'keeper', verb: 'release', target: '07-v2-6-rope' }).world;
    expect(world.entities['07-v2-6-curtain'].properties.open).toBe(false);
    expect(scene.complete(world)).toBe(false);
  });

  it('등지기 레일의 낮은 입구는 용사의 숙인 몸도 통과시키지 않는다', () => {
    const scene = SPATIAL_MIDDLE_STAGES[2].segments[1];
    const initial = scene.enter(null);
    const hero = runAction(scene, initial, { kind: 'action', actor: 'hero', verb: 'duck', target: '07-v2-2-handle' });
    expect(hero.outcome).toBe('blocked');
    expect(hero.world.actors.hero.location.x).toBeGreaterThan(4.2);
    const keeper = runAction(scene, initial, { kind: 'action', actor: 'keeper', verb: 'hold', target: '07-v2-2-handle' });
    expect(keeper.outcome).toBe('done');
    expect(keeper.world.entities['07-v2-2-curtain'].properties.open).toBe(true);
  });

  it('7-3에서 막 아래에 있을 때 손을 놓으면 실제 봉 접촉으로 사망한다', () => {
    const scene = SPATIAL_MIDDLE_STAGES[2].segments[2];
    const under = runAction(scene, scene.enter(null), { kind: 'action', actor: 'hero', verb: 'move', target: '07-v2-3-curtain' });
    expect(under.outcome).toBe('done');
    const released = runAction(scene, under.world, { kind: 'action', actor: 'keeper', verb: 'release', target: '07-v2-3-handle' });
    expect(released.outcome).toBe('failure');
    expect(released.motion?.kind).toBe('crush');
  });

  it.each(['05-v2-4', '05-v2-6', '06-v2-4', '07-v2-5', '07-v2-6'])('%s에서 범용 걷기는 퍼즐을 완성하지 못한다', (id) => {
    const chapter = Number(id.slice(0, 2));
    const stage = SPATIAL_MIDDLE_STAGES.find((item) => item.id === chapter)!;
    const segment = stage.segments.find((item) => item.id === id)!;
    let world = segment.enter(null);
    for (let n = 0; n < 30 && !segment.complete(world); n++) {
      const result = segment.execute!(world, { kind: 'action', actor: 'hero', verb: 'move', target: SPATIAL_MIDDLE_DEFINITIONS.find((item) => item.id === chapter)!.scenes.find((item) => item.id === id)!.defaultTarget });
      world = result.world;
      if (result.outcome === 'blocked' || result.outcome === 'failure') break;
    }
    expect(segment.complete(world)).toBe(false);
  });

  it.each(['05-v2-4', '05-v2-5', '05-v2-6'])('%s에서 처음부터 계속 뛰어서는 퍼즐을 완성하지 못한다', (id) => {
    const segment = SPATIAL_MIDDLE_STAGES[0].segments.find((item) => item.id === id)!;
    const target = SPATIAL_MIDDLE_DEFINITIONS[0].scenes.find((item) => item.id === id)!.defaultTarget;
    let world = segment.enter(null);
    for (let n = 0; n < 30 && !segment.complete(world); n++) {
      const result = segment.execute!(world, { kind: 'action', actor: 'hero', verb: 'jump', target });
      world = result.world;
      if (result.outcome === 'blocked' || result.outcome === 'failure') break;
    }
    expect(segment.complete(world)).toBe(false);
  });
});
