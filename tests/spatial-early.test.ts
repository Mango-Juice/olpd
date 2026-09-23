import { describe, expect, it } from 'vitest';
import { createCursor, stepProgram } from '../src/campaign/program';
import { SPATIAL_EARLY_STAGES } from '../src/campaign/spatial/early';
import { SPATIAL_EARLY_CASES } from './fixtures/spatial-intents/early';
import type { PhysicalAction, WorldState } from '../src/campaign/types';

function play(stageId: number, segmentId: string, body: (typeof SPATIAL_EARLY_CASES)[number]['body']): { world: WorldState; outcome: string | null; reason: string | null } {
  const stage = SPATIAL_EARLY_STAGES.find((item) => item.id === stageId);
  const segment = stage?.segments.find((item) => item.id === segmentId);
  if (!segment?.execute) throw new Error(`Missing spatial scene ${segmentId}`);
  const previous = segmentId === '04-v2-6'
    ? play(4, '04-v2-5', SPATIAL_EARLY_CASES.find((item) => item.segmentId === '04-v2-5')!.body).world
    : null;
  let world = segment.enter(previous);
  let cursor = createCursor();
  let lastOutcome: string | null = null;
  let lastReason: string | null = null;
  for (let boundary = 0; boundary < 160 && !segment.complete(world); boundary += 1) {
    const stepped = stepProgram(world, body, cursor, segment.execute, world);
    world = stepped.world;
    cursor = stepped.cursor;
    lastOutcome = stepped.outcome;
    lastReason = stepped.reason ?? null;
    if (['failure', 'blocked', 'clarification'].includes(stepped.outcome)) break;
    if (segment.complete(world)) break;
    if (stepped.outcome === 'done' && stepped.actions.length === 0) break;
    const environment = segment.advance(world);
    if (environment.failure) { lastOutcome = 'failure'; lastReason = environment.failure; break; }
    world = environment.world;
  }
  return { world, outcome: lastOutcome, reason: lastReason };
}

const move = (target: string): PhysicalAction => ({kind:'action',actor:'hero',verb:'move',target});

describe('spatial chapters 2–4', () => {
  it('keeps eighteen authored scenes, short goals, and visible geometry', () => {
    expect(SPATIAL_EARLY_STAGES.map((stage) => stage.segments.length)).toEqual([6,6,6]);
    expect(SPATIAL_EARLY_CASES).toHaveLength(18);
    for (const stage of SPATIAL_EARLY_STAGES) for (const segment of stage.segments) {
      const world = segment.enter(null);
      expect(world.entities.letter.parent).toBe('hero');
      expect(world.visible.filter((id) => id !== 'letter').length, segment.id).toBeLessThanOrEqual(4);
      expect(segment.goal, segment.id).not.toMatch(/\d|밀고|돌리고|기다렸다/);
      expect(segment.scene?.floors.length, segment.id).toBeGreaterThan(0);
    }
  });

  it.each(SPATIAL_EARLY_CASES)('$segmentId intent reaches its physical goal', (case_) => {
    const segment = SPATIAL_EARLY_STAGES.find((stage) => stage.id === case_.stageId)?.segments.find((item) => item.id === case_.segmentId);
    if (!segment) throw new Error(`Missing ${case_.segmentId}`);
    const played = play(case_.stageId, case_.segmentId, case_.body);
    expect(segment.complete(played.world), `${case_.segmentId}: ${played.outcome} ${played.reason}`).toBe(true);
  });

  it('a box still in the corridor stops an ordinary walk after approach', () => {
    const segment = SPATIAL_EARLY_STAGES[0].segments[0];
    const initial = segment.enter(null);
    const played = play(2, segment.id, move('02-v2-1-exit'));
    expect(segment.complete(played.world)).toBe(false);
    expect(played.world.actors.hero.location.x).toBeGreaterThan(initial.actors.hero.location.x);
    expect(played.world.actors.hero.location.x).toBeLessThan(initial.entities['02-v2-1-box'].location.x);
  });

  it('a visible-box condition attempts the requested jump and collides with the scene', () => {
    const segment = SPATIAL_EARLY_STAGES[0].segments[0];
    const world = segment.enter(null);
    const jump: PhysicalAction = { kind: 'action', actor: 'hero', verb: 'jump', target: '02-v2-1-box' };
    const body = { kind: 'if' as const, condition: { kind: 'visible' as const, entity: jump.target }, then: jump };
    const stepped = stepProgram(world, body, createCursor(), segment.execute!);
    expect(stepped.actions).toEqual([jump]);
    expect(stepped.outcome, stepped.reason ?? '').toBe('blocked');
    expect(stepped.reason).toMatch(/몸이 닿아/);
    const physical = segment.execute!(world, jump);
    expect(physical.outcome).toBe('blocked');
    expect(physical.motion).toMatchObject({ actor: 'hero', kind: 'solid', target: jump.target });
    const unseen = structuredClone(world);
    unseen.visible = unseen.visible.filter((id) => id !== jump.target);
    const skipped = stepProgram(unseen, body, createCursor(), segment.execute!);
    expect(skipped.outcome).toBe('done');
    expect(skipped.actions).toEqual([]);
  });

  it('4-6 receives live wind state from the latched door', () => {
    const fifth = SPATIAL_EARLY_STAGES[2].segments[4];
    const sixth = SPATIAL_EARLY_STAGES[2].segments[5];
    const source = fifth.enter(null);
    expect(sixth.enter(source).entities['04-v2-6-duct'].properties.flowing).toBe(false);
    source.entities['04-v2-5-door'].properties.open = true;
    source.entities['04-v2-5-door'].properties.latched = true;
    source.entities['04-v2-5-door'].properties.flowing = true;
    const carried = sixth.enter(source);
    expect(carried.entities['04-v2-6-duct'].properties.flowing).toBe(true);
    expect(carried.entities['04-v2-6-lift'].properties.powered).toBe(true);
  });
});
