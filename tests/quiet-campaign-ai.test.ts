import { describe, expect, it } from 'vitest';
import { deepSeekPublicWorld } from '../server/campaign-deepseek';
import { makeEntity, makeWorld } from '../src/campaign/level';

describe('compact scene interpreter context', () => {
  it('omits unused numeric physics and hidden answer metadata while retaining actual visible states', () => {
    const world = makeWorld(2, '02-v2-1', [makeEntity('box', '상자', '02-v2-1', 4, {
      weight: 73, capacity: 91, reach: 22,
      properties: { open: false, _solution: 'secret-answer', recipient: 'secret-recipient' },
    })]);
    const context = deepSeekPublicWorld(world);
    const box = context.entities.find((entity) => entity.id === 'box')!;
    expect(box).not.toHaveProperty('weight');
    expect(box).not.toHaveProperty('capacity');
    expect(box).not.toHaveProperty('reach');
    expect(box.properties).toEqual({ open: false });
    expect(JSON.stringify(context)).not.toContain('secret-');
    expect(context.propertySchema?.open).toHaveProperty('booleanMeanings');
  });
  it('does not strip physics context from historical interpreter fixtures', () => {
    const world = makeWorld(2, '02-1', [makeEntity('box', '상자', '02-1', 4, { weight: 3 })]);
    expect(deepSeekPublicWorld(world).entities.find((entity) => entity.id === 'box')).toHaveProperty('weight', 3);
  });
});
