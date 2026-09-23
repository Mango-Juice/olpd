import { describe, expect, it } from 'vitest';
import { SPATIAL_LATE_DEFINITIONS, SPATIAL_LATE_STAGES } from '../src/campaign/spatial/late';
import { SPATIAL_LATE_CASES } from './fixtures/spatial-intents/late';
import { advanceSpatialWorld, executeSpatialAction, spatialCondition } from '../src/campaign/spatial/engine';
import type { PhysicalAction, WorldState } from '../src/campaign/types';
import type { SpatialChapterDefinition } from '../src/campaign/spatial/types';

const chapter = (id: number) => SPATIAL_LATE_DEFINITIONS.find((item) => item.id === id)!;
const enter = (id: number, index: number) => SPATIAL_LATE_STAGES.find((item) => item.id === id)!.segments[index - 1].enter(null);
const action = (actor: 'hero' | 'keeper', verb: PhysicalAction['verb'], target: string, destination?: string): PhysicalAction =>
  ({ kind: 'action', actor, verb, target, ...(destination ? { destination } : {}) });

function drive(initial: WorldState, definition: SpatialChapterDefinition, input: PhysicalAction, limit = 80) {
  let world = initial;
  let outcome = 'progress';
  let reason = '';
  for (let step = 0; step < limit && outcome === 'progress'; step++) {
    const result = executeSpatialAction(world, input, definition);
    world = result.world;
    outcome = result.outcome;
    reason = result.reason;
    if (outcome === 'progress') {
      const environment = advanceSpatialWorld(world, definition);
      world = environment.world;
      if (environment.failure) { outcome = 'failure'; reason = environment.failure; }
    }
  }
  return { world, outcome, reason };
}

describe('late spatial chapters use common geometry and state', () => {
  it('publishes 18 bounded v4 scenes under the stable chapter IDs', () => {
    expect(SPATIAL_LATE_STAGES.map((stage) => stage.id)).toEqual([8, 9, 10]);
    expect(SPATIAL_LATE_CASES).toHaveLength(18);
    for (const definition of SPATIAL_LATE_DEFINITIONS) {
      expect(definition.scenes).toHaveLength(6);
      for (const [index, scene] of definition.scenes.entries()) {
        expect(scene.id).toBe(`${String(definition.id).padStart(2, '0')}-v2-${index + 1}`);
        expect(scene.entities.length, scene.id).toBeLessThanOrEqual(4);
        expect(scene.entities.length, scene.id).toBeGreaterThanOrEqual(3);
        expect(scene.entities.some((entity) => entity.id === scene.defaultTarget), scene.id).toBe(true);
        for (const surface of scene.surfaces) {
          expect(surface.from, scene.id).toBeGreaterThanOrEqual(0);
          expect(surface.to, scene.id).toBeLessThanOrEqual(10);
          expect(surface.y, scene.id).toBeGreaterThanOrEqual(0);
          expect(surface.y, scene.id).toBeLessThanOrEqual(4);
          expect(surface.depth ?? 1.2, scene.id).toBeGreaterThanOrEqual(0.8);
        }
        for (const name of Object.keys(scene.routes ?? {})) expect(scene.entities.some((entity) => entity.id === name), scene.id).toBe(true);
      }
    }
  });

  it('8-1 default straight movement hits the railing even after looking; named bridge route follows physical stones', () => {
    const definition = chapter(8);
    const start = enter(8, 1);
    const straight = drive(start, definition, action('hero', 'move', 'exit'));
    expect(straight.outcome).toBe('blocked');
    expect(straight.world.actors.hero.location.x).toBeLessThan(2.2);

    const observed = executeSpatialAction(start, action('hero', 'observe', 'fog'), definition).world;
    const afterLooking = drive(observed, definition, action('hero', 'move', 'exit'));
    expect(afterLooking.outcome).toBe('blocked');
    expect(afterLooking.world.actors.hero.location.x).toBeLessThan(2.2);
    expect(drive(start, definition, action('hero', 'jump', 'exit')).outcome).toBe('blocked');

    const bridge = drive(start, definition, action('hero', 'move', 'bridge'));
    expect(bridge.outcome, bridge.reason).toBe('done');
    expect(spatialCondition(bridge.world, { kind: 'near', entity: 'hero', target: 'exit' })).toBe(true);
    expect(bridge.world.actors.hero.location.z).not.toBe(0);
  });

  it('8-2 and 8-5 require choosing a physically supported branch', () => {
    const fork = chapter(8).scenes[1];
    const symbols = chapter(8).scenes[4];
    expect(fork.routes?.rightBridge?.some((point) => (point.z ?? 0) > 0)).toBe(true);
    expect(fork.routes?.leftBridge?.some((point) => (point.z ?? 0) < 0)).toBe(true);
    expect(symbols.routes?.triangle?.some((point) => (point.z ?? 0) > 0)).toBe(true);
    expect(symbols.routes?.circle?.some((point) => (point.z ?? 0) < 0)).toBe(true);
    expect(8.2 - 4.7).toBeGreaterThan(2.6);
    expect(drive(enter(8, 2), chapter(8), action('hero', 'move', 'island')).outcome).toBe('failure');
    expect(drive(enter(8, 2), chapter(8), action('hero', 'move', 'rightBridge')).outcome).toBe('done');
    expect(drive(enter(8, 5), chapter(8), action('hero', 'move', 'exit')).outcome).toBe('failure');
    expect(drive(enter(8, 5), chapter(8), action('hero', 'move', 'triangle')).outcome).toBe('done');
  });

  it('8-3 strong wind pushes the hero back to the safe alcove before the visible lull', () => {
    const blocked = drive(enter(8, 3), chapter(8), action('hero', 'move', 'exit'));
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.world.actors.hero.location.x).toBeLessThan(2.1);
    expect(blocked.world.entities.flag.properties.phase).toBe('flat');
  });

  it('9-3 lift follows the continuous panel direction; it does not need pump actions', () => {
    const definition = chapter(9);
    let world = enter(9, 3);
    const initialY = world.entities.lift.location.y;
    const turned = drive(world, definition, action('hero', 'turn', 'panel', 'lift'));
    expect(turned.outcome, turned.reason).toBe('done');
    world = turned.world;
    expect(world.entities.panel.properties.direction).toBe('lift');
    for (let i = 0; i < 4; i++) world = advanceSpatialWorld(world, definition).world;
    expect(world.entities.lift.location.y).toBeGreaterThan(initialY);
    expect(world.entities.panel.properties.direction).toBe('lift');
  });

  it('unconditional movement meets the moving bell and guardian arm at their actual positions', () => {
    for (const [stageId, index, target] of [[9, 2, 'exit'], [9, 6, 'door'], [10, 1, 'platform']] as const) {
      const attempt = drive(enter(stageId, index), chapter(stageId), action('hero', 'move', target));
      expect(attempt.outcome, `${stageId}-${index}: ${attempt.reason}`).toBe('failure');
      expect(attempt.world.actors.hero.location.x).toBeGreaterThan(2);
    }
  });

  it('10-5 either partner can hold the same ring while the other releases the lowered latch', () => {
    const definition = chapter(10);
    for (const holder of ['hero', 'keeper'] as const) {
      const worker = holder === 'hero' ? 'keeper' : 'hero';
      let world = enter(10, 5);
      const held = drive(world, definition, action(holder, 'hold', 'ring'));
      expect(held.outcome, held.reason).toBe('done');
      world = held.world;
      expect(world.entities.latch.location.y).toBeLessThan(2);
      const released = drive(world, definition, action(worker, 'pull', 'latch'));
      expect(released.outcome, released.reason).toBe('done');
      expect(released.world.entities.chest.properties.open).toBe(true);
    }
  });

  it('10-6 both physical handles maintain one spring door through role handoff', () => {
    const definition = chapter(10);
    const closed = drive(enter(10, 6), definition, action('hero', 'move', 'exit'));
    expect(closed.outcome).toBe('blocked');
    expect(closed.world.actors.hero.location.x).toBeLessThan(5);
    for (const firstHolder of ['hero', 'keeper'] as const) {
      const firstMover = firstHolder === 'hero' ? 'keeper' : 'hero';
      let world = enter(10, 6);
      let step = drive(world, definition, action(firstHolder, 'hold', 'outer'));
      expect(step.outcome, step.reason).toBe('done');
      world = step.world;
      expect(world.entities.door.properties.open).toBe(true);
      step = drive(world, definition, action(firstMover, 'move', 'inner'));
      expect(step.outcome, step.reason).toBe('done');
      world = step.world;
      expect(world.actors[firstMover].location.x).toBeGreaterThan(5.5);
      step = drive(world, definition, action(firstMover, 'hold', 'inner'));
      expect(step.outcome, step.reason).toBe('done');
      world = step.world;
      step = drive(world, definition, action(firstHolder, 'release', 'outer'));
      expect(step.outcome, step.reason).toBe('done');
      world = step.world;
      expect(world.entities.door.properties.open).toBe(true);
      step = drive(world, definition, action(firstHolder, 'move', 'exit'));
      expect(step.outcome, step.reason).toBe('done');
      world = step.world;
      expect(world.actors[firstHolder].location.x).toBeGreaterThan(7.5);
    }
  });
});
