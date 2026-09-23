import { describe, expect, it } from 'vitest';
import { makeEntity } from '../src/campaign/level';
import { advanceSpatialWorld, createSpatialStage, executeSpatialAction, spatialCondition } from '../src/campaign/spatial/engine';
import type { SpatialChapterDefinition, SpatialSceneDefinition } from '../src/campaign/spatial/types';
import type { PhysicalAction, WorldState } from '../src/campaign/types';

function scene(partial: Partial<SpatialSceneDefinition> = {}): SpatialSceneDefinition {
  const region = '02-test';
  return { id: region, title: 'test', goal: 'reach', entities: [makeEntity('exit', 'exit', region, 9)],
    surfaces: [{ from: 0, to: 10, y: 0 }], bodies: [], goals: [], defaultTarget: 'exit', ...partial };
}
function chapter(definition: SpatialSceneDefinition): SpatialChapterDefinition {
  return { id: 2, title: 'test', objective: 'test', scenes: [definition], story: { afterSegment: definition.id, object: 'exit', text: '' } };
}
function worldOf(definition: SpatialSceneDefinition): WorldState {
  return createSpatialStage(chapter(definition)).segments[0].enter(null);
}
function act(verb: PhysicalAction['verb'], target: string, destination?: string): PhysicalAction {
  return { kind: 'action', actor: 'hero', verb, target, ...(destination ? { destination } : {}) };
}
function untilSettled(start: WorldState, definition: SpatialChapterDefinition, action: PhysicalAction, limit = 40) {
  let result = executeSpatialAction(start, action, definition);
  for (let i = 1; i < limit && result.outcome === 'progress'; i++) result = executeSpatialAction(result.world, action, definition);
  return result;
}

describe('shared spatial engine', () => {
  it('approaches a solid before blocking and records the actual endpoint', () => {
    const wall = makeEntity('wall', 'wall', '02-test', 4);
    const definition = chapter(scene({ entities: [wall, makeEntity('exit', 'exit', '02-test', 9)],
      bodies: [{ entity: 'wall', width: 0.5, height: 2, kind: 'solid' }] }));
    const result = untilSettled(worldOf(definition.scenes[0]), definition, act('move', 'exit'));
    expect(result.outcome).toBe('blocked');
    expect(result.world.actors.hero.location.x).toBeGreaterThan(2);
    expect(result.world.actors.hero.location.x).toBeLessThan(4);
    expect(result.motion?.points.at(-1)?.x).toBeCloseTo(result.world.actors.hero.location.x);
    expect(result.motion?.contact?.x).toBeCloseTo(result.world.actors.hero.location.x);
  });

  it('falls from unsupported walking and keeps a jump within one global range', () => {
    const definition = chapter(scene({ surfaces: [{ from: 0, to: 3, y: 0 }, { from: 5.7, to: 10, y: 0 }] }));
    const fallen = untilSettled(worldOf(definition.scenes[0]), definition, act('move', 'exit'));
    expect(fallen.outcome).toBe('failure');
    expect(fallen.motion?.kind).toBe('fall');
    const tooFar = executeSpatialAction({ ...worldOf(definition.scenes[0]), actors: {
      hero: { ...worldOf(definition.scenes[0]).actors.hero, location: { region: '02-test', x: 2.2, y: 0 } },
    } }, act('jump', 'exit'), definition);
    expect(tooFar.world.actors.hero.location.x).toBeLessThanOrEqual(2.2 + 2.6 + 0.001);
  });

  it('traces an attempted jump into a low ceiling and a jump beyond its landing floor', () => {
    const low = chapter(scene({ ceiling: 1.25 }));
    const ceiling = executeSpatialAction(worldOf(low.scenes[0]), act('jump', 'exit'), low);
    expect(ceiling.outcome).toBe('blocked');
    expect(ceiling.motion?.points.length).toBeGreaterThan(1);
    expect(ceiling.world.actors.hero.location.y).toBeGreaterThan(0);
    expect(ceiling.motion?.contact?.y).toBeCloseTo(ceiling.world.actors.hero.location.y);

    const gap = chapter(scene({ surfaces: [{ from: 0, to: 2.5, y: 0 }, { from: 6, to: 10, y: 0 }] }));
    const start = worldOf(gap.scenes[0]);
    start.actors.hero.location.x = 2.3;
    const fall = executeSpatialAction(start, act('jump', 'exit'), gap);
    expect(fall.outcome).toBe('failure');
    expect(fall.motion?.kind).toBe('fall');
    expect(fall.motion?.points.length).toBeGreaterThan(12);
    expect(fall.world.actors.hero.location.x).toBeCloseTo(4.9);
    expect(fall.motion?.points.at(-1)?.x).toBeCloseTo(fall.world.actors.hero.location.x);
  });

  it('derives a mechanism from a held handle and restores it on release', () => {
    const handle = makeEntity('handle', 'handle', '02-test', 1.5);
    const door = makeEntity('door', 'door', '02-test', 4, { properties: { open: false } });
    const definition = chapter(scene({ entities: [handle, door, makeEntity('exit', 'exit', '02-test', 9)],
      bodies: [{ entity: 'door', width: 0.5, height: 2, kind: 'solid', active: { kind: 'property', entity: 'door', property: 'open', value: false } }],
      interactions: [{ kind: 'handle', entity: 'handle' }], rules: [{ when: { kind: 'holding', actor: 'hero', entity: 'handle' },
        effects: [{ entity: 'door', property: 'open', value: true, otherwise: false }] }] }));
    const held = untilSettled(worldOf(definition.scenes[0]), definition, act('hold', 'handle'));
    expect(held.outcome).toBe('done');
    expect(held.world.entities.door.properties.open).toBe(true);
    const released = executeSpatialAction(held.world, act('release', 'handle'), definition);
    expect(released.world.entities.door.properties.open).toBe(false);
  });

  it('keeps a fixed handle within reach during walking, jumping, and another interaction', () => {
    const handle = makeEntity('handle', 'handle', '02-test', 1.5);
    const marker = makeEntity('marker', 'marker', '02-test', 1.8);
    const switchEntity = makeEntity('switch', 'switch', '02-test', 4);
    const definition = chapter(scene({ entities: [handle, marker, switchEntity, makeEntity('exit', 'exit', '02-test', 9)],
      interactions: [{ kind: 'handle', entity: 'handle' }, { kind: 'control', entity: 'switch', property: 'on', value: true }] }));
    const held = untilSettled(worldOf(definition.scenes[0]), definition, act('hold', 'handle'));
    expect(held.outcome).toBe('done');

    const nearby = untilSettled(held.world, definition, act('move', 'marker'));
    expect(nearby.outcome).toBe('done');
    expect(nearby.world.actors.hero.holding).toBe('handle');
    const walked = untilSettled(nearby.world, definition, act('move', 'exit'));
    expect(walked.outcome).toBe('blocked');
    expect(walked.motion?.issue).toBe('out-of-reach');
    expect(walked.motion?.points.at(-1)?.x).toBeCloseTo(walked.world.actors.hero.location.x);
    expect(walked.world.actors.hero.location.x).toBeLessThanOrEqual(2.101);
    expect(walked.world.actors.hero.holding).toBe('handle');

    const jumped = executeSpatialAction(nearby.world, act('jump', 'exit'), definition);
    expect(jumped.outcome).toBe('blocked');
    expect(jumped.motion?.issue).toBe('out-of-reach');
    expect(jumped.motion?.points.at(-1)?.x).toBeCloseTo(jumped.world.actors.hero.location.x);
    expect(jumped.world.actors.hero.location.x).toBeLessThanOrEqual(2.101);

    const approached = untilSettled(nearby.world, definition, act('turn', 'switch'));
    expect(approached.outcome).toBe('blocked');
    expect(approached.motion?.issue).toBe('out-of-reach');
    expect(approached.world.entities.switch.properties.on).not.toBe(true);
    expect(approached.world.actors.hero.location.x).toBeLessThanOrEqual(2.101);
  });

  it('cannot pass through a spring door while holding the fixed door open', () => {
    const door = makeEntity('door', 'door', '02-test', 4, { properties: { open: false } });
    const definition = chapter(scene({ entities: [door, makeEntity('exit', 'exit', '02-test', 9)],
      hero: { location: { region: '02-test', x: 3.5, y: 0 } },
      bodies: [{ entity: 'door', width: 0.5, height: 2, kind: 'solid', active: { kind: 'property', entity: 'door', property: 'open', value: false } }],
      interactions: [{ kind: 'door', entity: 'door', spring: true }] }));
    const opened = executeSpatialAction(worldOf(definition.scenes[0]), act('open', 'door'), definition);
    expect(opened.outcome).toBe('done');
    const walked = untilSettled(opened.world, definition, act('move', 'exit'));
    expect(walked.outcome).toBe('blocked');
    expect(walked.motion?.issue).toBe('out-of-reach');
    expect(walked.world.actors.hero.location.x).toBeLessThanOrEqual(4.601);
    expect(walked.world.actors.hero.holding).toBe('door');
    expect(walked.world.entities.door.properties.open).toBe(true);
    const remote = structuredClone(opened.world);
    remote.actors.hero.location.x = 8;
    const turned = executeSpatialAction(remote, act('turn', 'door'), definition);
    expect(turned.outcome).toBe('blocked');
    expect(turned.motion?.issue).toBe('out-of-reach');
    expect(turned.world.entities.door.properties.latched).not.toBe(true);
  });

  it('cannot bypass fixed-handle reach through a ladder or boarding snap', () => {
    const handle = makeEntity('handle', 'handle', '02-test', 1.5);
    const ladder = makeEntity('ladder', 'ladder', '02-test', 1.5);
    const shelf = makeEntity('shelf', 'shelf', '02-test', 2.5, { location: { region: '02-test', x: 2.5, y: 1 } });
    const platform = makeEntity('platform', 'platform', '02-test', 3);
    const definition = chapter(scene({ entities: [handle, ladder, shelf, platform],
      hero: { location: { region: '02-test', x: 1.5, y: 0 } },
      bodies: [{ entity: 'platform', width: 3, height: 0.2, kind: 'solid' }],
      interactions: [{ kind: 'handle', entity: 'handle' }, { kind: 'ladder', entity: 'ladder', destination: 'shelf' },
        { kind: 'transport', entity: 'platform', from: { x: 3, y: 0 }, to: { x: 4, y: 0 }, period: 2 }] }));
    const held = executeSpatialAction(worldOf(definition.scenes[0]), act('hold', 'handle'), definition);
    expect(held.outcome).toBe('done');
    const climb = executeSpatialAction(held.world, act('climb', 'ladder'), definition);
    expect(climb.outcome).toBe('blocked');
    expect(climb.motion?.issue).toBe('out-of-reach');
    expect(climb.world.actors.hero.location.x).toBe(1.5);
    const board = executeSpatialAction(held.world, act('board', 'platform'), definition);
    expect(board.outcome).toBe('blocked');
    expect(board.motion?.issue).toBe('out-of-reach');
    expect(board.world.actors.hero.riding).toBeNull();
    expect(board.world.actors.hero.location.x).toBe(1.5);
  });

  it('releases a fixed handle when a ridden transport carries its holder away', () => {
    const handle = makeEntity('handle', 'handle', '02-test', 1.5);
    const platform = makeEntity('platform', 'platform', '02-test', 1.5);
    const door = makeEntity('door', 'door', '02-test', 4, { properties: { open: false } });
    const definition = chapter(scene({ entities: [handle, platform, door],
      hero: { location: { region: '02-test', x: 1.5, y: 0 } },
      interactions: [{ kind: 'handle', entity: 'handle' },
        { kind: 'transport', entity: 'platform', from: { x: 1.5, y: 0 }, to: { x: 3.5, y: 0 }, period: 2 }],
      rules: [{ when: { kind: 'holding', actor: 'hero', entity: 'handle' },
        effects: [{ entity: 'door', property: 'open', value: true, otherwise: false }] }] }));
    const held = executeSpatialAction(worldOf(definition.scenes[0]), act('hold', 'handle'), definition);
    const boarded = executeSpatialAction(held.world, act('board', 'platform'), definition);
    expect(boarded.outcome).toBe('done');
    expect(boarded.world.entities.door.properties.open).toBe(true);
    const advanced = advanceSpatialWorld(boarded.world, definition).world;
    expect(advanced.actors.hero.location.x).toBeCloseTo(2.5);
    expect(advanced.actors.hero.holding).toBeNull();
    expect(advanced.entities.handle.properties.held).toBe(false);
    expect(advanced.entities.door.properties.open).toBe(false);
  });

  it('moves a crate to an explicitly supported depth lane', () => {
    const crate = makeEntity('crate', 'crate', '02-test', 3.5, { movable: true });
    const definition = chapter(scene({ entities: [crate, makeEntity('exit', 'exit', '02-test', 9)],
      surfaces: [{ from: 0, to: 10, y: 0, z: 0, depth: 1.2 }, { from: 2, to: 5, y: 0, z: 1.4, depth: 1 }],
      bodies: [{ entity: 'crate', width: 1.2, height: 1, depth: 0.8, kind: 'solid', support: true }],
      interactions: [{ kind: 'movable', entity: 'crate', pushTo: { x: 3.5, y: 0, z: 1.4 } }] }));
    const result = untilSettled(worldOf(definition.scenes[0]), definition, act('push', 'crate'));
    expect(result.outcome).toBe('done');
    expect(result.world.entities.crate.location.z).toBeCloseTo(1.4);
    expect(spatialCondition(result.world, { kind: 'near', entity: 'hero', target: 'crate', distance: 0.3 })).toBe(false);
  });

  it('advances a transport and its rider in deterministic ticks', () => {
    const platform = makeEntity('platform', 'platform', '02-test', 3);
    const definition = chapter(scene({ entities: [platform, makeEntity('exit', 'exit', '02-test', 9)],
      interactions: [{ kind: 'transport', entity: 'platform', from: { x: 3, y: 0 }, to: { x: 6, y: 1 }, period: 3 }] }));
    const world = worldOf(definition.scenes[0]);
    world.actors.hero.riding = 'platform'; world.actors.hero.location = { region: '02-test', x: 3, y: 0 };
    const one = advanceSpatialWorld(world, definition).world;
    expect(one.entities.platform.location.x).toBeCloseTo(4);
    expect(one.actors.hero.location.x).toBeCloseTo(4);
    const three = advanceSpatialWorld(advanceSpatialWorld(one, definition).world, definition).world;
    expect(three.entities.platform.properties.position).toBe('far');
    expect(three.actors.hero.location.y).toBeCloseTo(1);
  });

  it('pushes an actor back on wind contact without declaring an instant death', () => {
    const gust = makeEntity('gust', 'gust', '02-test', 4);
    const definition = chapter(scene({ entities: [gust, makeEntity('exit', 'exit', '02-test', 9)],
      bodies: [{ entity: 'gust', width: 1.2, height: 1.5, kind: 'wind' }] }));
    const hit = untilSettled(worldOf(definition.scenes[0]), definition, act('move', 'exit'));
    expect(hit.outcome).toBe('blocked');
    expect(hit.motion?.kind).toBe('wind');
    expect(hit.world.actors.hero.location.x).toBeLessThan(3);
  });

  it('reports a kinematic door closing onto an actor as crush', () => {
    const handle = makeEntity('handle', 'handle', '02-test', 1);
    const door = makeEntity('door', 'door', '02-test', 4, { properties: { open: true } });
    const definition = chapter(scene({ entities: [handle, door, makeEntity('exit', 'exit', '02-test', 9)],
      bodies: [{ entity: 'door', width: 0.5, height: 2, kind: 'solid', kinematic: true,
        active: { kind: 'property', entity: 'door', property: 'open', value: false } }],
      interactions: [{ kind: 'handle', entity: 'handle' }], rules: [{ when: { kind: 'holding', actor: 'hero', entity: 'handle' },
        effects: [{ entity: 'door', property: 'open', value: true, otherwise: false }] }] }));
    const world = worldOf(definition.scenes[0]);
    world.actors.hero.holding = 'handle'; world.actors.hero.location.x = 4;
    world.entities.handle.properties.held = true;
    world.entities.door.properties.open = true;
    const closed = executeSpatialAction(world, act('release', 'handle'), definition);
    expect(closed.outcome).toBe('failure');
    expect(closed.motion?.kind).toBe('crush');
    expect(closed.motion?.contact?.x).toBe(4);
  });
});
